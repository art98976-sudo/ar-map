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
import {html, onAction, render} from '../dom.js'
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
export function createMapTrip(host, {map, route, dest, onClose, watch = watchLocation, makeMarker = defaultMarker}) {
  let arrived = false
  let following = false
  let dot = null
  render(
    host,
    html`
      <div class="map-trip__top" data-map-trip-top>
        <div class="map-trip__pill" role="status" aria-live="polite">
          ${icon('footsteps', {size: 18})}<span data-map-trip-text>${tripPillText(dest.name, tripLengthM(route))}</span>
        </div>
        <button class="round-btn map-trip__close" type="button" data-action="end-map-trip" aria-label="End the trip">${icon('close', {size: 20})}</button>
      </div>
    `,
  )
  host.hidden = false
  const off = onAction(host, {'end-map-trip': () => onClose?.()})

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
    map.fitBounds(routeBounds(points), {padding, maxZoom: TRIP_VIEW.maxZoom, bearing: 0, pitch: 0, duration: animate ? 600 : 0})
  }

  /** Keep the dot in view: pan only once it would leave the free area, keeping the zoom. */
  function keepInView(fix) {
    if (!map?.project) return
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
      if (onRoute && mapTripArrived(route, fix)) {
        arrived = true
        if (text) text.textContent = `You’ve arrived · ${dest.name}`
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
