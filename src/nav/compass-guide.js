// "Map Compass" guidance: the maths behind the 3D arrow, the heading-up map and the dot on it.
// Pure logic, no GPS, no three.js. Bearings are degrees clockwise from north. Route points are
// the route frame's {x east, y north} metres, s is the distance along the route.
import {angleDiff, localBearing, pointAt, polylineLength, polylineSlice, projectOntoPolyline, shortestTurn, wrap360} from '../geo/geo.js'

export const COMPASS_GUIDE = {
  blendM: 12, // the arrow starts curving into a turn this far before it
  legAheadM: 5, // the current segment's direction is read over this much route...
  nextLegM: 8, // ...and the next segment's over this much, after the corner
  facingAwayDeg: 60, // further off the route than this at Start: turn first
  facingOkDeg: 30, // and guidance starts once within this
  aroundDeg: 135, // further off than this, "Turn around" says it better than left or right
  poorAccuracyDeg: 25, // iPhone's webkitCompassAccuracy worse than this: do not rely on the compass
  walkDirectionM: 6, // with no usable compass, walking this far shows which way the user faces
  walkStraightRatio: 0.7, // straight-line over walked: a wandering walk shows no direction
}

function chordBearing(route, fromS, toS) {
  return localBearing(pointAt(route, fromS), pointAt(route, toS))
}

/** How far the arrow turns from where the user faces: -180..180, > 0 to the right. */
export function arrowYawDeg(segmentBearing, headingDeg) {
  return angleDiff(headingDeg, segmentBearing)
}

/** From bearing a to bearing b the short way. t: 0 is a, 1 is b. */
export function blendBearing(a, b, t) {
  return wrap360(a + angleDiff(a, b) * Math.max(0, Math.min(1, t)))
}

/** The route's direction at s, not looking past the corner ahead. */
function legBearing(route, s, cornerS) {
  const total = polylineLength(route)
  if (s >= total - 0.5) return chordBearing(route, total - COMPASS_GUIDE.legAheadM, total)
  const end = Math.min(s + COMPASS_GUIDE.legAheadM, cornerS > s + 0.5 ? cornerS : Infinity, total)
  return chordBearing(route, s, end)
}

/** The direction of the leg after a corner, not looking past the next corner. */
function legAfter(route, turn, after) {
  const from = (turn.last ?? turn.s) + 0.5
  const to = Math.min(from + COMPASS_GUIDE.nextLegM, after ? after.first ?? after.s : Infinity, polylineLength(route))
  return chordBearing(route, from, Math.max(to, from + 0.5))
}

/**
 * Which way the 3D arrow should point at s: {bearingDeg, ringFill}.
 * ringFill goes 0..1 over the last 12 m before a turn. next: the manoeuvre guidance says is next.
 */
export function arrowTarget(route, manoeuvres, next, s) {
  if (next.type === 'arrive') return {bearingDeg: legBearing(route, s, Infinity), ringFill: 0}
  const corner = next.first ?? next.s
  const toCorner = Math.max(0, corner - s)
  const after = manoeuvres[manoeuvres.indexOf(next) + 1]
  const t = 1 - Math.min(1, toCorner / COMPASS_GUIDE.blendM)
  return {bearingDeg: blendBearing(legBearing(route, s, corner), legAfter(route, next, after), t), ringFill: t}
}

/** "Turn around", "Turn left" or "Turn right" for an arrow yaw; null within `withinDeg`. */
export function turnPrompt(yawDeg, withinDeg = COMPASS_GUIDE.facingAwayDeg) {
  const size = Math.abs(yawDeg)
  if (size <= withinDeg) return null
  if (size > COMPASS_GUIDE.aroundDeg) return 'Turn around'
  return yawDeg < 0 ? 'Turn left' : 'Turn right'
}

/** Ease a bearing towards a target, the short way, at no more than maxDegPerS. */
export function stepBearing(current, target, dt, maxDegPerS = 90) {
  const max = maxDegPerS * dt
  return wrap360(current + Math.max(-max, Math.min(max, angleDiff(current, target))))
}

/**
 * The correction that lays a walked track (route frame) on to the route, once the walk is long and
 * straight enough to show a direction: {dx, dy, yaw (radians, counter-clockwise), pivot}, else null.
 */
export function walkingCorrection(track, route, s, walkedM) {
  if (track.length < 2 || walkedM < COMPASS_GUIDE.walkDirectionM) return null
  const first = track[0]
  const last = track.at(-1)
  const chordM = Math.hypot(last.x - first.x, last.y - first.y)
  if (chordM < walkedM * COMPASS_GUIDE.walkStraightRatio) return null
  const a = pointAt(route, Math.max(0, s - chordM))
  const b = pointAt(route, s)
  const yaw = shortestTurn(Math.atan2(last.y - first.y, last.x - first.x), Math.atan2(b.y - a.y, b.x - a.x))
  return {dx: b.x - last.x, dy: b.y - last.y, yaw, pivot: last}
}

const TRACK = {
  minStepM: 0.25, // smaller moves are SLAM noise: a user standing still must not creep along
  maxStepM: 5, // a bigger jump is SLAM recovering, not walking
  sidewaysCos: 0.3, // walking across the route does not move the user along it
  backwardsCos: -0.5,
  goodAccuracyM: 20,
  windowM: 15, // GPS can only move the user this far (plus its error) along the route
  gainAt5M: 0.35, // SLAM carries the distance: each fix only nudges it, less if it is poor
  easeS: 0.4,
}

/**
 * Where the user is along the route: GPS snapped on to it, smoothed, plus the distance SLAM has
 * measured since. Only a nudge from each fix, so GPS noise cannot make the dot jump.
 */
export function createRouteTracker(route, startS = 0) {
  const total = polylineLength(route)
  let s = Math.max(0, Math.min(total, startS))
  let shown = s
  let last = null

  function direction() {
    const a = pointAt(route, Math.max(0, s - 1))
    const b = pointAt(route, Math.min(total, s + 1))
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return {x: (b.x - a.x) / len, y: (b.y - a.y) / len}
  }

  return {
    /** SLAM camera position {x, z}. toRoute: world to route frame, null while direction is unknown. */
    walk(pos, toRoute = null) {
      if (!last) {
        last = {x: pos.x, z: pos.z}
        return
      }
      const step = Math.hypot(pos.x - last.x, pos.z - last.z)
      if (step < TRACK.minStepM) return
      if (step <= TRACK.maxStepM) {
        let along = step
        if (toRoute) {
          const a = toRoute(last)
          const b = toRoute(pos)
          const dir = direction()
          const cos = ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / step
          along = cos >= TRACK.sidewaysCos ? step : cos <= TRACK.backwardsCos ? -step : 0
        }
        s = Math.max(0, Math.min(total, s + along))
      }
      last = {x: pos.x, z: pos.z}
    },
    /** A new GPS fix in the route frame. */
    fix(point, accuracyM) {
      if (!Number.isFinite(accuracyM) || accuracyM > TRACK.goodAccuracyM) return
      const reach = TRACK.windowM + accuracyM
      const from = Math.max(0, s - reach)
      const hit = projectOntoPolyline(polylineSlice(route, from, s + reach), point)
      if (hit.offset > reach) return
      s = Math.max(0, Math.min(total, s + (from + hit.s - s) * Math.min(1, (TRACK.gainAt5M * 5) / Math.max(5, accuracyM))))
    },
    /** Walking has shown where the user really is: move there without easing the estimate. */
    set(value) {
      s = Math.max(0, Math.min(total, value))
    },
    /** Ease the dot towards the estimate. Call every frame. */
    tick(dt) {
      shown += (s - shown) * (1 - Math.exp(-dt / TRACK.easeS))
      return shown
    },
    get s() {
      return s
    },
    get shownS() {
      return shown
    },
    get totalM() {
      return total
    },
  }
}
