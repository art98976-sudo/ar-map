// Which way the AR arrow points: at a spot a few metres further along the route, seen from where
// the user stands. Never straight at the destination, so the arrow turns at each corner and leads
// someone who has drifted off the path back on to it.
//
// Small pure functions. Points are {lat, lon}; route points also carry their floor level z.
// Bearings are degrees clockwise from north (0..360).
import {bearingDeg, distanceM, fromLocal, toLocal, wrap360} from '../geo/geo.js'

export const LOOK_AHEAD_M = 9
export const MAX_BACKWARDS_M = 5
// Nobody walks further than this between two updates. Without a limit, someone beside the path
// would be put on a later stretch of the route that happens to pass close by, and stay there.
export const MAX_AHEAD_M = 25

const ll = (p) => ({lat: p.lat, lng: p.lon ?? p.lng})
const sameSpot = (a, b) => a.lat === b.lat && a.lon === b.lon

/**
 * One ordered list of points for a whole MazeMap /routing/path response.
 * @returns {{points: {lat: number, lon: number, z: number|null}[], lengthMetres: number}}
 */
export function normaliseRoute(mazemapResponse) {
  const points = []
  for (const f of mazemapResponse?.path?.features ?? []) {
    const z = Number.isFinite(f?.properties?.z) ? f.properties.z : null
    for (const c of f?.geometry?.coordinates ?? []) {
      const [lon, lat] = c
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const p = {lat, lon, z}
      const last = points.at(-1)
      // A shared corner between two stretches: keep one point, with the floor the walk reaches.
      if (last && sameSpot(last, p)) last.z = z ?? last.z
      else points.push(p)
    }
  }
  const reported = mazemapResponse?.pathMetrics?.distanceWalkingMeters
  return {points, lengthMetres: Number.isFinite(reported) ? reported : measure(points)}
}

/** A route from points we already have ({lat, lng} or {lat, lon}), for footpath and direct routes. */
export function routeFromPoints(points) {
  const out = points.map((p) => ({lat: p.lat, lon: p.lon ?? p.lng, z: Number.isFinite(p.z) ? p.z : null}))
  return {points: out, lengthMetres: measure(out)}
}

// Flat metres around the first point, with the distance along the route at every point.
// Worked out once per route object.
const geometry = new WeakMap()
function geometryOf(route) {
  let g = geometry.get(route)
  if (g) return g
  const points = route?.points ?? []
  const origin = points.length ? ll(points[0]) : {lat: 0, lng: 0}
  const xy = points.map((p) => toLocal(origin, ll(p)))
  const at = [0]
  for (let i = 1; i < xy.length; i++) at.push(at[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y))
  g = {origin, xy, at, total: at.at(-1) ?? 0}
  geometry.set(route, g)
  return g
}

function measure(points) {
  return geometryOf({points}).total
}

/**
 * Where the user is along the route: their position projected on to the nearest route segment.
 * Pass the previous distanceAlong and it never jumps backwards more than 5 m between updates, nor
 * forwards more than 25 m (GPS noise, or another stretch of the same route passing close by).
 * @returns {{distanceAlong: number, distanceFromRoute: number, segmentIndex: number}}
 */
export function progressOnRoute(route, userLatLon, previousDistanceAlong = null, {maxAheadM = MAX_AHEAD_M} = {}) {
  const {origin, xy, at, total} = geometryOf(route)
  if (xy.length === 0) return {distanceAlong: 0, distanceFromRoute: Infinity, segmentIndex: 0}
  const u = toLocal(origin, ll(userLatLon))
  if (xy.length === 1) return {distanceAlong: 0, distanceFromRoute: Math.hypot(u.x - xy[0].x, u.y - xy[0].y), segmentIndex: 0}

  const known = Number.isFinite(previousDistanceAlong)
  const floor = known ? Math.min(total, Math.max(0, previousDistanceAlong - MAX_BACKWARDS_M)) : 0
  const ceil = known ? Math.max(floor, Math.min(total, previousDistanceAlong + maxAheadM)) : total
  // The user's true foot on a segment (or a corner) inside the window, or held at its back edge
  // when they have walked back. A point held at the front edge only counts when there is neither:
  // taking it would let the position creep, update after update, towards a later stretch of
  // route that passes closer.
  let free = null
  let back = null
  let ahead = {distanceAlong: floor, distanceFromRoute: Infinity, segmentIndex: 0}
  const nearer = (a, b) => (!a || b.distanceFromRoute < a.distanceFromRoute ? b : a)
  for (let i = 1; i < xy.length; i++) {
    const len = at[i] - at[i - 1]
    if (at[i] < floor || at[i - 1] > ceil) continue // wholly outside the window
    const a = xy[i - 1]
    const b = xy[i]
    const foot = (t) => {
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      return {distanceAlong: at[i - 1] + len * t, distanceFromRoute: Math.hypot(u.x - x, u.y - y), segmentIndex: i - 1}
    }
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((u.x - a.x) * (b.x - a.x) + (u.y - a.y) * (b.y - a.y)) / (len * len)))
    const own = foot(t)
    if (own.distanceAlong < floor) back = nearer(back, foot(len === 0 ? 0 : (floor - at[i - 1]) / len))
    else if (own.distanceAlong > ceil) ahead = nearer(ahead, foot(len === 0 ? 0 : (ceil - at[i - 1]) / len))
    else free = nearer(free, own)
  }
  if (free && back) return nearer(free, back)
  return free ?? back ?? ahead
}

/** The point lookAhead metres further along the route line. Near the end: the destination. */
export function lookAheadPoint(route, distanceAlong, lookAhead = LOOK_AHEAD_M) {
  const {origin, xy, at, total} = geometryOf(route)
  const points = route?.points ?? []
  if (!points.length) return null
  const s = Math.max(0, distanceAlong) + lookAhead
  if (s >= total) return {lat: points.at(-1).lat, lon: points.at(-1).lon ?? points.at(-1).lng}
  let i = 1
  while (i < at.length - 1 && at[i] < s) i++
  const len = at[i] - at[i - 1]
  const t = len ? (s - at[i - 1]) / len : 0
  const p = fromLocal(origin, {x: xy[i - 1].x + (xy[i].x - xy[i - 1].x) * t, y: xy[i - 1].y + (xy[i].y - xy[i - 1].y) * t})
  return {lat: p.lat, lon: p.lng}
}

/**
 * Compass bearing from the user to the look-ahead point, degrees from north.
 * The arrow's on-screen rotation is this minus the phone's compass heading.
 */
export function arrowBearing(userLatLon, lookAhead) {
  return wrap360(bearingDeg(ll(userLatLon), ll(lookAhead)))
}

/**
 * All of the above in one step, for the AR screen and the simulator.
 * @returns {{bearingDeg: number, progress: object, target: {lat, lon}}|null}
 */
export function arrowDirection(route, userLatLon, previousDistanceAlong = null, lookAhead = LOOK_AHEAD_M) {
  if (!route?.points?.length || !userLatLon) return null
  const progress = progressOnRoute(route, userLatLon, previousDistanceAlong)
  const target = lookAheadPoint(route, progress.distanceAlong, lookAhead)
  // Standing on the destination itself there is no direction to it: keep the route's last one.
  const from = distanceM(ll(userLatLon), ll(target)) < 0.5 ? lookAheadPoint(route, progressOnRoute(route, target).distanceAlong - 1, 0) : userLatLon
  return {bearingDeg: arrowBearing(from, target), progress, target}
}
