// The map trip (Group A, item 4): what "Go" does on a phone or browser that cannot run AR. The
// route stays drawn, the map follows the user's dot, and one pill says place, distance left and
// time, with a close button. No error screen: the same button, a different way to follow.
import {ARRIVAL} from '../../config.js'
import {distanceM, polylineLength, projectOntoPolyline, toLocal} from '../../geo/geo.js'
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

/**
 * @param host where the pill goes
 * @param o.map the campus map
 * @param o.route the planned route
 * @param o.dest the place
 * @param o.onClose the user closed the trip
 */
export function createMapTrip(host, {map, route, dest, onClose}) {
  let arrived = false
  render(
    host,
    html`
      <div class="map-trip__pill" role="status" aria-live="polite">
        ${icon('footsteps', {size: 18})}<span data-map-trip-text>${tripPillText(dest.name, tripLengthM(route))}</span>
      </div>
      <button class="round-btn map-trip__close" type="button" data-action="end-map-trip" aria-label="End the trip">${icon('close', {size: 20})}</button>
    `,
  )
  host.hidden = false
  const off = onAction(host, {'end-map-trip': () => onClose?.()})

  return {
    /** A new GPS fix: follow it and say what is left. */
    update(fix) {
      if (!fix || arrived) return
      const text = host.querySelector('[data-map-trip-text]')
      if (mapTripArrived(route, fix)) {
        arrived = true
        if (text) text.textContent = `You’ve arrived · ${dest.name}`
        return
      }
      if (text) text.textContent = tripPillText(dest.name, remainingAlong(route, fix))
      map.easeTo({center: [fix.lng, fix.lat], duration: 600})
    },
    destroy() {
      off()
      host.hidden = true
      render(host, '')
    },
  }
}
