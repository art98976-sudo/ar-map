// The map trip (Group A, item 4): what "Go" does on a phone or browser that cannot run AR. The
// route stays drawn and framed between the top bar and the bottom panel (trip-camera.js); the map
// follows the user's dot only once it is on the route. One pill says place, distance left and
// time, with a close button. No error screen: the same button, a different way to follow.
import {ARRIVAL} from '../../config.js'
import {distanceM, polylineLength, projectOntoPolyline, toLocal} from '../../geo/geo.js'
import {watchLocation} from '../../geo/location.js'
import {followsFix, insideView, routeBounds, TRIP_VIEW, tripPadding} from '../../map/trip-camera.js'
import {tripPillText} from '../../route/card-text.js'
import {indoorRestM, tripLengthM} from '../../route/route.js'
import {createTripSteps} from '../../route/trip-steps.js'
import {html, onAction, raw, render} from '../dom.js'
import {icon} from '../icons.js'

/** Metres left along the route from this fix (the outdoor line, plus a room's indoor part). */
export function remainingAlong(route, fix, indoorAR = false) {
  const points = route?.points ?? []
  if (!fix || points.length < 2) return tripLengthM(route)
  const origin = points[0]
  const local = points.map((p) => toLocal(origin, p))
  const along = projectOntoPolyline(local, toLocal(origin, fix)).s
  return Math.max(0, polylineLength(local) - along) + indoorRestM(route, indoorAR)
}

/** Arrived: within ARRIVAL.arriveM of the end of the walk, along the route or in a straight line. */
export function mapTripArrived(route, fix) {
  if (!fix || !route?.points?.length) return false
  const left = remainingAlong({...route, totalM: null}, fix)
  return left <= ARRIVAL.arriveM || distanceM(fix, route.points.at(-1)) <= ARRIVAL.arriveM
}

/** The user's dot on the map (a DOM marker). */
function defaultMarker() {
  const element = document.createElement('div')
  element.className = 'map-trip__dot'
  element.setAttribute('aria-hidden', 'true')
  return new window.Mazemap.mapboxgl.Marker({element}).setLngLat([0, 0])
}

/**
 * @param host where the pill goes
 * @param o.map the campus map
 * @param o.route the planned route
 * @param o.dest the place
 * @param o.onClose the user closed the trip
 * @param o.watch GPS for the trip (location.js watchLocation): its own, so it runs all the walk
 * @param o.makeMarker the user's dot
 */
export function createMapTrip(host, {map, route, dest, onClose, arriveLabel = dest.name, destinations = [], onStep = () => {}, watch = watchLocation, makeMarker = defaultMarker}) {
  let arrived = false
  let following = false
  let dot = null
  let userS = 0
  let fittingUntil = 0 // the route framing animation runs until then (ms)
  let lastStep = null // the manoeuvre the banner shows: a new one is announced (and spoken)
  const steps = createTripSteps(route, {arriveLabel, destinations, destinationId: dest.id})
  render(
    host,
    html`
      <div class="map-trip__top" data-map-trip-top>
        <div class="map-trip__pill">
          ${icon('footsteps', {size: 18})}<span data-map-trip-text>${tripPillText(dest.name, tripLengthM(route))}</span>
        </div>
        <button class="round-btn map-trip__close" type="button" data-action="end-map-trip" aria-label="End the trip">${icon('close', {size: 20})}</button>
      </div>
      <section class="map-trip__bottom" data-map-trip-bottom aria-label="Directions">
        <div class="map-trip__next">
          <span class="map-trip__icon" data-map-trip-icon></span>
          <p class="map-trip__banner" data-map-trip-banner></p>
          <button class="map-trip__steps-btn" type="button" data-action="toggle-steps" aria-expanded="false" aria-controls="map-trip-steps">
            <span>All steps</span>${icon('chevronDown', {size: 18})}
          </button>
        </div>
        <ol class="map-trip__steps" id="map-trip-steps" data-map-trip-steps hidden></ol>
        <p class="sr-only" role="status" aria-live="polite" data-map-trip-announce></p>
      </section>
    `,
  )
  host.hidden = false

  /** The banner and the list for where the walker is now (userS). */
  function paintSteps() {
    const next = steps.banner(userS)
    host.querySelector('[data-map-trip-banner]').textContent = next.text
    const iconHost = host.querySelector('[data-map-trip-icon]')
    if (iconHost.dataset.icon !== next.icon) {
      iconHost.dataset.icon = next.icon
      render(iconHost, icon(next.icon, {size: 28}))
    }
    // Screen readers hear each step once, as it becomes the next one, not every metre.
    if (next.manoeuvre !== lastStep) {
      lastStep = next.manoeuvre
      host.querySelector('[data-map-trip-announce]').textContent = next.text
    }
    onStep(next) // every update: spoken directions decide for themselves what is new (voice.js)
    const list = host.querySelector('[data-map-trip-steps]')
    if (!list.hidden) paintList(list)
  }

  function paintList(list) {
    render(
      list,
      steps.list(userS).map(
        (s) => html`
          <li class="map-trip__step" ${s.current ? raw('aria-current="step"') : ''} ${s.done ? raw('data-done') : ''}>
            <span class="map-trip__step-icon">${icon(s.icon, {size: 20})}</span>
            <span class="map-trip__step-text">${s.text}</span>
            <span class="map-trip__step-walk">${s.walkText}</span>
          </li>
        `,
      ),
    )
  }

  function toggleSteps() {
    const list = host.querySelector('[data-map-trip-steps]')
    const button = host.querySelector('[data-action="toggle-steps"]')
    const open = list.hidden
    list.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) paintList(list)
    if (!following) fitRoute() // the panel changed height: keep the route clear of it
  }

  const off = onAction(host, {'end-map-trip': () => onClose?.(), 'toggle-steps': toggleSteps})
  const onKey = (event) => {
    const list = host.querySelector('[data-map-trip-steps]')
    if (event.key === 'Escape' && list && !list.hidden) {
      toggleSteps()
      host.querySelector('[data-action="toggle-steps"]')?.focus({preventScroll: true})
    }
  }
  host.addEventListener('keydown', onKey)
  paintSteps()

  /** The map's size and the padding that keeps the route clear of the top bar and bottom panel. */
  function frame() {
    const box = map.getContainer().getBoundingClientRect()
    const top = host.querySelector('[data-map-trip-top]')?.getBoundingClientRect()
    const bottom = host.querySelector('[data-map-trip-bottom]')?.getBoundingClientRect()
    const padding = tripPadding({
      width: box.width,
      height: box.height,
      topPx: top ? top.bottom - box.top : 0,
      bottomPx: bottom && bottom.height ? box.bottom - bottom.top : 0,
    })
    return {box, padding}
  }

  /** Frame the whole route between the top bar and the bottom panel, if there is one. */
  function fitRoute({animate = true} = {}) {
    const points = route?.points ?? []
    if (points.length < 2 || !map?.fitBounds) return
    const {padding} = frame()
    const duration = animate ? 600 : 0
    fittingUntil = Date.now() + duration + 100
    map.fitBounds(routeBounds(points), {padding, maxZoom: TRIP_VIEW.maxZoom, bearing: 0, pitch: 0, duration})
  }

  /** Keep the dot in view: pan only once it would leave the free area, keeping the zoom. */
  function keepInView(fix) {
    // While the route is being framed the dot's screen position is not final: a pan now would
    // cut the framing short (the first fix arrives the moment Go is pressed).
    if (!map?.project || Date.now() < fittingUntil) return
    const {box, padding} = frame()
    if (insideView(map.project([fix.lng, fix.lat]), box, padding)) return
    map.easeTo({center: [fix.lng, fix.lat], padding, duration: 600})
  }

  const onResize = () => {
    if (!following) fitRoute({animate: false})
  }
  window.addEventListener('resize', onResize)
  fitRoute()

  const trip = {
    /** A new GPS fix: on the route, follow it and say what is left; off it, keep the route framed. */
    update(fix) {
      if (!fix || arrived) return
      if (Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) {
        dot ??= makeMarker(map)?.addTo?.(map) ?? null
        dot?.setLngLat?.([fix.lng, fix.lat])
      }
      const onRoute = followsFix(route, fix)
      const text = host.querySelector('[data-map-trip-text]')
      if (onRoute) {
        userS = steps.along(fix)
        paintSteps()
      }
      if (onRoute && mapTripArrived(route, fix)) {
        arrived = true
        if (text) text.textContent = `You’ve arrived · ${dest.name}`
        host.querySelector('[data-map-trip-banner]').textContent = `You’ve arrived at ${arriveLabel}`
        host.querySelector('[data-map-trip-announce]').textContent = `You’ve arrived at ${arriveLabel}`
        onStep({type: 'arrived', text: `You’ve arrived at ${arriveLabel}`})
        return
      }
      if (text) text.textContent = tripPillText(dest.name, onRoute ? remainingAlong(route, fix) : tripLengthM(route))
      if (onRoute) keepInView(fix)
      else if (following) fitRoute() // walked off the route, or GPS got worse: show the whole walk again
      following = onRoute
    },
    /** Frame the route again (the bottom panel changed size). */
    fit: () => fitRoute(),
    get following() {
      return following
    },
    destroy() {
      off()
      host.removeEventListener('keydown', onKey)
      stopWatch()
      window.removeEventListener('resize', onResize)
      dot?.remove?.()
      dot = null
      host.hidden = true
      render(host, '')
    },
  }

  const stopWatch = watch({
    onFix: (pos) => trip.update({lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy}),
    onError: () => {}, // no GPS: the route stays framed and the pill shows the whole walk
  })
  return trip
}
