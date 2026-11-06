// Map matching: lines up where the user has actually walked with the planned route.
//
// GPS is 5-15 m out sideways and the compass can rotate the route, even by 180°. SLAM, though,
// knows the SHAPE of the walk very accurately. So: keep the last ~30 m of camera positions,
// and find the move and turn (about the user) that lays that track onto the route,
// using a few iterations of point-to-segment ICP.
//
// Pure maths, no three.js. Corrections are in the route frame: x = east, y = north, angles
// counter-clockwise, applied as p' = R(yaw)(p - pivot) + pivot + (dx, dy).
import {findTurns, projectOntoPolyline, shortestTurn, toDeg, toRad} from '../geo/geo.js'

export const MATCH = {
  sampleEveryS: 0.5,
  minStepM: 0.25, // ignore smaller moves, so a user standing still builds up no fake "walk"
  trackM: 30, // keep this much of the walk
  minWalkedM: 5, // no correction before this
  gateM: 8, // samples further than this from the route are ignored by the fine fit
  coarseM: 16, // with too few samples in the gate, line up by direction if the user is this close
  iterations: 10,
  minInliers: 6,
  maxStepM: 3, // per update
  maxStepDeg: 10,
  maxTotalM: 20, // over the whole trip
  maxTotalDeg: 75, // more than the 60° Start allows, plus some drift, or a bad compass stays uncorrected
  confidentResidualM: 1,
  cornerArmM: 4, // a turn in the walk needs this much straight walking either side
  cornerMinDeg: 35, // same as a turn in the route (findTurns)
  cornerAgreeDeg: 30, // the walk and the route turn by a similar angle...
  cornerNearM: 12, // ...this close together
  wrongWayDeg: 90, // walking further than this from the route direction: the alignment is flipped
  wrongWayChecks: 2, // seen on this many updates in a row, so one stumble cannot flip the route
  straightRatio: 0.7, // straight-line distance over distance walked, to read a walking direction
  maxSpeedMps: 5, // faster than this is a SLAM jump, not walking: start the track again
  movingWithinS: 1.5,
  ignoreM: 0.02, // smaller corrections are not worth moving the arrows for
  ignoreDeg: 0.05,
}


function transform(p, {dx, dy, yaw}, pivot) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const x = p.x - pivot.x
  const y = p.y - pivot.y
  return {x: x * c - y * s + pivot.x + dx, y: x * s + y * c + pivot.y + dy}
}

function nearInliers(track, route, gateM) {
  return track.map((p) => {
    const hit = projectOntoPolyline(route, p)
    return hit.offset <= gateM ? {p, q: {x: hit.x, y: hit.y}, offset: hit.offset} : null
  })
}

/** Best rigid move of points onto their matches (weighted 2D Procrustes). */
function bestRigid(pairs) {
  let n = 0
  let px = 0
  let py = 0
  let qx = 0
  let qy = 0
  for (const {p, q, weight = 1} of pairs) {
    n += weight
    px += p.x * weight
    py += p.y * weight
    qx += q.x * weight
    qy += q.y * weight
  }
  px /= n
  py /= n
  qx /= n
  qy /= n
  let dot = 0
  let cross = 0
  for (const {p, q, weight = 1} of pairs) {
    const ax = p.x - px
    const ay = p.y - py
    const bx = q.x - qx
    const by = q.y - qy
    dot += (ax * bx + ay * by) * weight
    cross += (ax * by - ay * bx) * weight
  }
  return {yaw: Math.atan2(cross, dot), from: {x: px, y: py}, to: {x: qx, y: qy}}
}

/**
 * Which way the track runs compared with the route alongside it.
 * turn: signed radians from the walking direction to the route direction.
 */
export function walkVsRoute(track, route) {
  const first = track[0]
  const last = track.at(-1)
  let tx = 0
  let ty = 0
  for (const p of track) {
    const {segment} = projectOntoPolyline(route, p)
    const a = route[segment]
    const b = route[segment + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    tx += (b.x - a.x) / len
    ty += (b.y - a.y) / len
  }
  const cx = last.x - first.x
  const cy = last.y - first.y
  return {chordM: Math.hypot(cx, cy), turn: shortestTurn(Math.atan2(cy, cx), Math.atan2(ty, tx))}
}

/**
 * The sharpest turn in a walked track: {index, angle} with angle in degrees, > 0 for right
 * (the same as findTurns), or null. Compares the walk over a few metres either side of each sample.
 */
export function detectTrackTurn(track, armM = MATCH.cornerArmM, minDeg = MATCH.cornerMinDeg) {
  const along = [0]
  for (let i = 1; i < track.length; i++) along[i] = along[i - 1] + Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y)
  let best = null
  let back = 0
  let ahead = 0
  for (let i = 0; i < track.length; i++) {
    while (back < i && along[i] - along[back + 1] >= armM) back += 1
    ahead = Math.max(ahead, i)
    while (ahead < track.length - 1 && along[ahead] - along[i] < armM) ahead += 1
    if (along[i] - along[back] < armM || along[ahead] - along[i] < armM) continue
    const before = Math.atan2(track[i].x - track[back].x, track[i].y - track[back].y)
    const after = Math.atan2(track[ahead].x - track[i].x, track[ahead].y - track[i].y)
    const angle = toDeg(shortestTurn(before, after))
    if (Math.abs(angle) >= minDeg && (!best || Math.abs(angle) > Math.abs(best.angle))) best = {index: i, angle}
  }
  return best
}

/**
 * Where the walk turned the way the route turns: the one place that also fixes the position
 * ALONG the route, which a straight walk cannot. Returns {index, q} or null.
 */
export function findCornerAnchor(track, route) {
  const turn = detectTrackTurn(track)
  if (!turn) return null
  const at = track[turn.index]
  let best = null
  for (const corner of findTurns(route)) {
    if (Math.sign(corner.angle) !== Math.sign(turn.angle)) continue
    if (Math.abs(corner.angle - turn.angle) > MATCH.cornerAgreeDeg) continue
    const distance = Math.hypot(corner.x - at.x, corner.y - at.y)
    if (distance <= MATCH.cornerNearM && (!best || distance < best.distance)) best = {index: turn.index, q: {x: corner.x, y: corner.y}, distance}
  }
  return best
}

/** Too few samples near the route: turn the track to run along it, and step towards it. */
function coarseFit(track, route, pivot) {
  const hit = projectOntoPolyline(route, pivot)
  if (hit.offset > MATCH.coarseM) return null
  return {dx: hit.x - pivot.x, dy: hit.y - pivot.y, yaw: walkVsRoute(track, route).turn, pivot}
}

/**
 * Fit a walked track onto the route. Returns {dx, dy, yaw, pivot} about the pivot (the user),
 * or null when the track is too far from the route to say anything.
 */
export function fitTrackToRoute(track, route, {pivot = track.at(-1), gateM = MATCH.gateM, iterations = MATCH.iterations, minInliers = MATCH.minInliers, useCorners = true} = {}) {
  const corner = useCorners ? findCornerAnchor(track, route) : null
  let moved = track
  let user = pivot
  let yaw = 0
  for (let i = 0; i < iterations; i++) {
    const pairs = nearInliers(moved, route, gateM).filter(Boolean)
    if (pairs.length < minInliers) {
      if (i === 0) return coarseFit(track, route, pivot)
      break
    }
    // As strong as all the other samples together.
    if (corner) pairs.push({p: moved[corner.index], q: corner.q, weight: pairs.length})
    const step = bestRigid(pairs)
    const apply = (p) => transform(p, {dx: step.to.x - step.from.x, dy: step.to.y - step.from.y, yaw: step.yaw}, step.from)
    moved = moved.map(apply)
    user = apply(user)
    yaw += step.yaw
    if (Math.abs(step.yaw) < 1e-5 && Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y) < 1e-3) break
  }
  return {dx: user.x - pivot.x, dy: user.y - pivot.y, yaw, pivot}
}

/** Limit one correction, per update and so that the trip total stays in bounds. */
export function clampCorrection({dx, dy, yaw, pivot}, total = {dx: 0, dy: 0, yaw: 0}) {
  const clampAbs = (v, max) => Math.max(-max, Math.min(max, v))
  let clampedYaw = clampAbs(yaw, toRad(MATCH.maxStepDeg))
  clampedYaw = clampAbs(total.yaw + clampedYaw, toRad(MATCH.maxTotalDeg)) - total.yaw

  let scale = Math.min(1, MATCH.maxStepM / (Math.hypot(dx, dy) || 1))
  const next = Math.hypot(total.dx + dx * scale, total.dy + dy * scale)
  if (next > MATCH.maxTotalM) {
    // Only limit moves that push further out. A move back towards zero is always fine.
    const room = Math.max(0, MATCH.maxTotalM - Math.hypot(total.dx, total.dy))
    scale = Math.min(scale, room / (Math.hypot(dx, dy) || 1))
  }
  return {dx: dx * scale, dy: dy * scale, yaw: clampedYaw, pivot}
}

/** Mean distance to the route of the samples near it, and how much of the walk they cover. */
function fitQuality(track, route) {
  const hits = nearInliers(track, route, MATCH.gateM)
  let sum = 0
  let count = 0
  let matchedM = 0
  hits.forEach((hit, i) => {
    if (!hit) return
    sum += hit.offset
    count += 1
    if (hits[i - 1]) matchedM += Math.hypot(hit.p.x - hits[i - 1].p.x, hit.p.y - hits[i - 1].p.y)
  })
  return {residual: count ? sum / count : null, matchedM}
}

/**
 * Keeps the walked track and works out corrections.
 *   addSample(x, z, time)  camera floor position in SLAM world metres
 *   update(toRoute)        toRoute({x, z}) -> {x, y} with the CURRENT route placement.
 *                          Returns {dx, dy, yaw, pivot, flipped?}, or null for nothing to do.
 *                          A flip is exempt from the clamps: it exists to fix a 180° error.
 */
export function createRouteMatcher(route) {
  let samples = []
  let walked = 0
  let everWalked = 0
  let lastAt = null
  let lastMovedAt = null
  const total = {dx: 0, dy: 0, yaw: 0}
  let residual = null
  let confident = false
  let everConfident = false
  let wrongWayCount = 0
  let flipped = false

  function trim() {
    while (samples.length > 2) {
      const first = Math.hypot(samples[1].x - samples[0].x, samples[1].z - samples[0].z)
      if (walked - first < MATCH.trackM) break
      walked -= first
      samples.shift()
    }
  }

  return {
    addSample(x, z, time) {
      if (lastAt != null && time - lastAt < MATCH.sampleEveryS) return
      const prev = samples.at(-1)
      if (!prev) {
        samples.push({x, z})
        lastAt = lastMovedAt = time
        return
      }
      lastAt = time
      const step = Math.hypot(x - prev.x, z - prev.z)
      if (step < MATCH.minStepM) return
      if (step > MATCH.maxSpeedMps * (time - lastMovedAt)) {
        samples = [{x, z}]
        walked = 0
        confident = false
        wrongWayCount = 0
      } else {
        samples.push({x, z})
        walked += step
        everWalked += step
        trim()
      }
      lastMovedAt = time
    },
    moving: (time) => lastMovedAt != null && time - lastMovedAt <= MATCH.movingWithinS,
    update(toRoute) {
      if (walked < MATCH.minWalkedM) return null
      const track = samples.map((s) => toRoute(s))
      const pivot = track.at(-1)

      // Walking against the route. Once a fit has been confident the placement is known to be
      // right, so someone turning back along the route is just turning back.
      const direction = walkVsRoute(track, route)
      const wrongWay =
        !everConfident &&
        direction.chordM >= MATCH.minWalkedM &&
        direction.chordM >= walked * MATCH.straightRatio &&
        Math.abs(direction.turn) > toRad(MATCH.wrongWayDeg)
      wrongWayCount = wrongWay ? wrongWayCount + 1 : 0
      if (wrongWay) {
        confident = false
        if (wrongWayCount < MATCH.wrongWayChecks) return null
        wrongWayCount = 0
        flipped = true
        return {dx: 0, dy: 0, yaw: direction.turn, pivot, flipped: true}
      }

      const fit = fitTrackToRoute(track, route, {pivot})
      if (!fit) {
        confident = false
        return null
      }
      const correction = clampCorrection(fit, total)
      const after = fitQuality(track.map((p) => transform(p, correction, pivot)), route)
      residual = after.residual
      confident = residual != null && residual < MATCH.confidentResidualM && after.matchedM >= MATCH.minWalkedM
      if (confident) everConfident = true
      if (Math.hypot(correction.dx, correction.dy) < MATCH.ignoreM && Math.abs(correction.yaw) < toRad(MATCH.ignoreDeg)) return null
      total.dx += correction.dx
      total.dy += correction.dy
      total.yaw += correction.yaw
      return correction
    },
    get walkedM() {
      return walked
    },
    /** Everything walked this trip, never trimmed: decides when to stop asking for a few steps. */
    get everWalkedM() {
      return everWalked
    },
    get samples() {
      return samples
    },
    get confident() {
      return confident
    },
    /** The fit has been confident at least once this trip. */
    get locked() {
      return everConfident
    },
    /** Walking proved the compass 90°+ wrong this trip, so the compass may no longer turn the route. */
    get flipped() {
      return flipped
    },
    get residualM() {
      return residual
    },
    get totalOffsetM() {
      return Math.hypot(total.dx, total.dy)
    },
    get totalYawDeg() {
      return toDeg(total.yaw)
    },
  }
}
