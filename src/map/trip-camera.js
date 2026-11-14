// Where the map trip's camera looks (item 1): the whole route framed between the top bar and any
// bottom panel, close enough to read, and the user's dot followed only when it is on the route.
// Pure, so the framing is tested without a map.
import {projectOntoPolyline, toLocal} from '../geo/geo.js'

export const TRIP_VIEW = {
  maxZoom: 18, // a short route is not blown up past street level
  edgePx: 24, // space between the route and the bar, panel or screen edge
  minRouteShare: 0.3, // the route always gets at least this share of the height (phone landscape)
  followWithinM: 40, // a fix this close to the route is the walker on it: the map follows...
  followAccuracyM: 50, // ...if the fix is this good. A laptop's Wi-Fi fix (often 1 km) is not.
}

/** [[west, south], [east, north]] around the route's points ({lat, lng}). */
export function routeBounds(points) {
  const lngs = points.map((p) => p.lng)
  const lats = points.map((p) => p.lat)
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

/**
 * Padding for fitting the route on a map of width x height px, with a bar covering the top
 * topPx and a panel covering the bottom bottomPx. When the bars would leave the route less than
 * minRouteShare of the height (a phone on its side), they are scaled back to keep that much.
 */
export function tripPadding({width, height, topPx = 0, bottomPx = 0}, view = TRIP_VIEW) {
  let top = Math.max(0, topPx) + view.edgePx
  let bottom = Math.max(0, bottomPx) + view.edgePx
  const keep = height * view.minRouteShare
  if (height - top - bottom < keep) {
    const scale = Math.max(0, height - keep) / (top + bottom)
    top *= scale
    bottom *= scale
  }
  const side = Math.min(view.edgePx * 2, Math.round(width * 0.08))
  return {top: Math.round(top), bottom: Math.round(bottom), left: side, right: side}
}

/**
 * Is a screen point (px, from map.project) inside the map's free area (the box less the padding)?
 * The trip keeps its framing while the dot stays in view, and only pans when it would leave.
 */
export function insideView(point, {width, height}, padding) {
  return point.x >= padding.left && point.x <= width - padding.right && point.y >= padding.top && point.y <= height - padding.bottom
}

/** Should the map follow this fix? Good enough, and on (near) the route. */
export function followsFix(route, fix, view = TRIP_VIEW) {
  const points = route?.points ?? []
  if (!fix || points.length < 2 || !(fix.accuracy <= view.followAccuracyM)) return false
  const origin = points[0]
  const along = projectOntoPolyline(points.map((p) => toLocal(origin, p)), toLocal(origin, fix))
  return along.offset <= view.followWithinM
}
