// "Map Compass" guidance: the maths behind the way-to-walk direction, the heading-up map and the dot on it.
// Pure logic, no GPS, no three.js. Bearings are degrees clockwise from north. Route points are
// the route frame's {x east, y north} metres, s is the distance along the route.
import {angleDiff, localBearing, pointAt, polylineLength, polylineSlice, projectOntoPolyline, shortestTurn, wrap360} from '../geo/geo.js'
import {COMPASS_GUIDE, TRACK} from '../config.js'

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
 * Which way to walk at s: {bearingDeg, ringFill}.
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

/**
 * Where the user is along the route: GPS snapped on to it, smoothed, plus the distance SLAM has
 * measured since. Only a nudge from each fix, so GPS noise cannot make the dot jump.
 */
/**
 * The route's turns sharper than minTurnDeg: {s, inDir, outDir, turnDeg}, the legs as 3 m chords
 * either side (a curve of short segments is one turn), at most one per 3 m (the sharpest).
 */
export function sharpCorners(route, minTurnDeg = TRACK.corner.minTurnDeg, legM = 3) {
  const total = polylineLength(route)
  const unit = (p, q) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    return len > 1e-6 ? {x: (q.x - p.x) / len, y: (q.y - p.y) / len} : null
  }
  const found = []
  let at = 0
  for (let i = 1; i < route.length - 1; i++) {
    at += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y)
    const inDir = unit(pointAt(route, Math.max(0, at - legM)), route[i])
    const outDir = unit(route[i], pointAt(route, Math.min(total, at + legM)))
    if (!inDir || !outDir) continue
    const turnDeg = (Math.acos(Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y))) * 180) / Math.PI
    if (turnDeg >= minTurnDeg) found.push({s: at, inDir, outDir, turnDeg})
  }
  const out = []
  for (const c of found) {
    const prev = out.at(-1)
    if (prev && c.s - prev.s < legM) {
      if (c.turnDeg > prev.turnDeg) out[out.length - 1] = c
    } else out.push(c)
  }
  return out
}

export function createRouteTracker(route, startS = 0) {
  const total = polylineLength(route)
  let s = Math.max(0, Math.min(total, startS))
  let shown = s
  let last = null
  // Item 23, the corner gate (TRACK.corner): on while the trip says so (outdoors).
  const corners = sharpCorners(route)
  const passed = new Set()
  let gateOn = false
  let turnsSeen = 0 // corners the walk itself was seen to turn (each fixes the along position)
  let trail = [] // the walk in the route frame, the last TRACK.corner.trailM of it
  const nextCorner = () => corners.find((c) => !passed.has(c) && c.s > s - 1e-6)
  /** The furthest walking and GPS may carry the user: short of a corner the walk has not turned. */
  function cap(want) {
    if (!gateOn || want <= s) return want
    const c = nextCorner()
    if (!c) return want
    const limit = c.s - TRACK.corner.holdM
    return want > limit ? Math.max(Math.min(s, c.s), limit) : want
  }
  /** Has the walk turned the way the next corner goes? Then it is passed. */
  function checkTurned() {
    const c = nextCorner()
    if (!c || trail.length < 2) return
    const a = trail[0]
    const b = trail.at(-1)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < TRACK.corner.trailM * 0.8) return
    const d = {x: (b.x - a.x) / len, y: (b.y - a.y) / len}
    const toOut = d.x * c.outDir.x + d.y * c.outDir.y
    const toIn = d.x * c.inDir.x + d.y * c.inDir.y
    if (s < c.s - TRACK.corner.turnWindowM || toOut <= toIn) return // nearer the new leg than the old
    passed.add(c)
    turnsSeen += 1
    s = Math.max(s, Math.min(total, c.s)) // turning: the user is at the corner
  }

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
          trail.push(b)
          let walked = 0
          for (let i = trail.length - 1; i > 0; i--) {
            walked += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y)
            if (walked > TRACK.corner.trailM) {
              trail = trail.slice(i - 1)
              break
            }
          }
          if (gateOn) checkTurned()
          const dir = direction()
          const cos = ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / step
          along = cos >= TRACK.sidewaysCos ? step : cos <= TRACK.backwardsCos ? -step : 0
        }
        s = Math.max(0, Math.min(total, cap(s + along)))
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
      s = Math.max(0, Math.min(total, cap(s + (from + hit.s - s) * Math.min(1, (TRACK.gainAt5M * 5) / Math.max(5, accuracyM)))))
    },
    /** Walking has shown where the user really is: move there without easing the estimate. */
    set(value) {
      s = Math.max(0, Math.min(total, value))
      // An anchor or a match past a corner: it is passed.
      for (const c of corners) if (c.s <= s - 1e-6) passed.add(c)
    },
    /**
     * Follow the tracked position's progress (route-frame point p): the corner gate applies. Past a
     * corner, a point nearer the new leg than the old leg's straight line on means the user turned
     * (the placement is right); one still straight on means the placement is ahead (GPS), so hold.
     */
    follow(value, p = null) {
      const c = gateOn && value > s ? nextCorner() : null
      if (c && p && value > c.s - TRACK.corner.holdM) {
        const at = pointAt(route, c.s)
        const ax = p.x - at.x
        const ay = p.y - at.y
        const offStraight = Math.abs(ax * c.inDir.y - ay * c.inDir.x) // from the old leg, carried on
        const offNew = projectOntoPolyline(polylineSlice(route, c.s, Math.min(total, c.s + 15)), p).offset
        if (offNew < offStraight) {
          passed.add(c)
          turnsSeen += 1
        }
      }
      s = Math.max(0, Math.min(total, value > s ? cap(value) : value))
    },
    /** The corner gate (Item 23): on outdoors, where GPS leaves the along position metres out. */
    setCornerGate(on) {
      gateOn = Boolean(on)
    },
    /** Ease the dot towards the estimate. Call every frame. */
    tick(dt) {
      shown += (s - shown) * (1 - Math.exp(-dt / TRACK.easeS))
      return shown
    },
    get s() {
      return s
    },
    get turnsSeen() {
      return turnsSeen
    },
    get shownS() {
      return shown
    },
    get totalM() {
      return total
    },
  }
}
