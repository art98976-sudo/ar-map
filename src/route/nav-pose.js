// One navigation pose per frame: where the user is along the route, how far to the side, which way
// the phone faces, and whether all that is trustworthy. The map dot, the map's rotation, the arrow,
// turn instructions, distance left, off-route detection and the stats all read this one pose, so
// two estimates of the user's position can never be on screen at once.
//
// Route frame: {x east, y north} metres; s is the distance along the route.
import {localBearing, pointAt, polylineLength, polylineSlice, projectOntoPolyline, toDeg, toLocal, wrap360} from '../geo/geo.js'
import {ARROW} from '../config.js'

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
 * The arrow's bearing (degrees from north): the PATH direction from routeS (blended through the
 * next turn by compass-guide.js arrowTarget), never aimed from the raw tracked position. Only when
 * walking has proved the placement (matcher confident) and the user is more than ARROW.steerAboveM
 * to one side does it lean back towards the route, by at most ARROW.maxSteerDeg.
 *   pathDeg: the path direction at routeS. lateralOffsetM: > 0 right of the route, < 0 left.
 */
export function steeredBearing(pathDeg, lateralOffsetM, matcherConfident) {
  if (!Number.isFinite(pathDeg)) return null
  if (!matcherConfident || !Number.isFinite(lateralOffsetM) || Math.abs(lateralOffsetM) <= ARROW.steerAboveM) return wrap360(pathDeg)
  const lean = Math.min(ARROW.maxSteerDeg, toDeg(Math.atan2(Math.abs(lateralOffsetM) - ARROW.steerAboveM, ARROW.aheadM)) + ARROW.minSteerDeg)
  // Right of the route: lean left (anticlockwise), and the other way round.
  return wrap360(pathDeg - Math.sign(lateralOffsetM) * lean)
}

/** Floor levels along a route: [{s, z}] from points that carry z (MazeMap levels; 0 outdoors). */
export function levelsAlong(points, origin) {
  if (!points?.length || !origin) return []
  let s = 0
  let prev = null
  return points.map((p) => {
    const q = toLocal(origin, p)
    if (prev) s += Math.hypot(q.x - prev.x, q.y - prev.y)
    prev = q
    return {s, z: Number.isFinite(p.z) ? p.z : 0}
  })
}

/** The floor level at s along the route (the level of the point at or before it). */
export function levelAt(levels, s) {
  if (!levels?.length || !Number.isFinite(s)) return null
  let z = levels[0].z
  for (const l of levels) {
    if (l.s > s) break
    z = l.z
  }
  return z
}

/** The route's own direction at s: from s to `aheadM` further on. */
export function routeBearingAt(route, s, aheadM = ARROW.aheadM) {
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
 *   floorLevel   the route's floor level at routeS (MazeMap z; 0 outdoors)
 *   confident    the position is good enough to guide from
 */
export function createNavPose() {
  let pose = {routeS: null, shownS: null, lateralOffsetM: null, headingDeg: null, floorLevel: null, confident: false, tracked: null}
  return {
    update({route, routeS, shownS = routeS, tracked = null, headingDeg = null, floorLevel = null, confident = false}) {
      pose = {
        routeS,
        shownS,
        lateralOffsetM: routeS == null ? null : signedOffset(route, routeS, tracked),
        headingDeg,
        floorLevel,
        confident: Boolean(confident && routeS != null),
        tracked,
      }
      return pose
    },
    reset() {
      pose = {routeS: null, shownS: null, lateralOffsetM: null, headingDeg: null, floorLevel: null, confident: false, tracked: null}
    },
    get current() {
      return pose
    },
  }
}
