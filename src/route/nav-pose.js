// One navigation pose per frame: where the user is along the route, how far to the side, which way
// the phone faces, and whether all that is trustworthy. The map dot, the map's rotation, the arrow,
// turn instructions, distance left, off-route detection and the stats all read this one pose, so
// two estimates of the user's position can never be on screen at once.
//
// Route frame: {x east, y north} metres; s is the distance along the route.
import {localBearing, pointAt, polylineLength, polylineSlice, projectOntoPolyline} from '../geo/geo.js'
import {LOOK_AHEAD_M} from './arrow-direction.js'

/** How far either side of routeS to look when measuring the sideways offset. */
export const OFFSET_WINDOW_M = 15

/**
 * Signed distance (m) from `point` to the route near `s`: > 0 right of the route (facing along
 * it), < 0 left. Searches only OFFSET_WINDOW_M either side of s, so another stretch of the same
 * route passing nearby is never measured instead.
 */
export function signedOffset(route, s, point, windowM = OFFSET_WINDOW_M) {
  if (!point || route.length < 2) return null
  const total = polylineLength(route)
  const from = Math.max(0, s - windowM)
  const to = Math.min(total, s + windowM)
  const slice = polylineSlice(route, from, Math.max(to, from + 0.01))
  const hit = projectOntoPolyline(slice, point)
  const hitS = from + hit.s
  const a = pointAt(route, Math.max(0, hitS - 0.5))
  const b = pointAt(route, Math.min(total, hitS + 0.5))
  // Cross product of the route direction and the offset: negative means the point is to the right.
  const cross = (b.x - a.x) * (point.y - hit.y) - (b.y - a.y) * (point.x - hit.x)
  return cross > 0 ? -hit.offset : hit.offset
}

/**
 * Bearing (degrees from north) from the tracked position to the route LOOK_AHEAD_M past routeS.
 * Step 1 keeps this rule but reads routeS from the pose instead of a second progress value.
 */
export function aimBearing(route, pose, aheadM = LOOK_AHEAD_M) {
  if (pose?.routeS == null) return null
  const total = polylineLength(route)
  const target = pointAt(route, Math.min(total, pose.routeS + aheadM))
  const from = pose.tracked && Math.hypot(target.x - pose.tracked.x, target.y - pose.tracked.y) >= 0.5 ? pose.tracked : pointAt(route, Math.max(0, Math.min(total, pose.routeS) - 1))
  return localBearing(from, target)
}

/** The route's own direction at s: from s to `aheadM` further on. */
export function routeBearingAt(route, s, aheadM = LOOK_AHEAD_M) {
  const total = polylineLength(route)
  const a = pointAt(route, Math.max(0, Math.min(total - 0.5, s)))
  const b = pointAt(route, Math.min(total, Math.max(s, 0) + aheadM))
  return localBearing(a, b)
}

/**
 * Holds the pose. update() once per frame with:
 *   route        route frame polyline
 *   routeS       the progress estimate (route tracker: walking, GPS nudges)
 *   shownS       the same estimate eased for display (the map dot)
 *   tracked      where motion tracking puts the user, route frame, or null before placement
 *   headingDeg   which way the phone faces, degrees from north, or null
 *   confident    the position is good enough to guide from
 */
export function createNavPose() {
  let pose = {routeS: null, shownS: null, lateralOffsetM: null, headingDeg: null, confident: false, tracked: null}
  return {
    update({route, routeS, shownS = routeS, tracked = null, headingDeg = null, confident = false}) {
      pose = {
        routeS,
        shownS,
        lateralOffsetM: routeS == null ? null : signedOffset(route, routeS, tracked),
        headingDeg,
        confident: Boolean(confident && routeS != null),
        tracked,
      }
      return pose
    },
    reset() {
      pose = {routeS: null, shownS: null, lateralOffsetM: null, headingDeg: null, confident: false, tracked: null}
    },
    get current() {
      return pose
    },
  }
}
