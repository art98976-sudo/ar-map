// Map matching: lines up where the user has actually walked with the planned route.
//
// GPS is 5-15 m out sideways and the compass rotates the route a few degrees. SLAM, though,
// knows the SHAPE of the walk very accurately. So: keep the last ~25 m of camera positions,
// and find the small move and turn (about the user) that lays that track onto the route,
// using a few iterations of point-to-segment ICP.
//
// Pure maths, no three.js. Corrections are in the route frame: x = east, y = north, angles
// counter-clockwise, applied as p' = R(yaw)(p - pivot) + pivot + (dx, dy).
import {projectOntoPolyline} from '../geo/geo.js'

export const MATCH = {
  sampleEveryS: 0.5,
  minStepM: 0.25, // ignore smaller moves, so a user standing still builds up no fake "walk"
  trackM: 25, // keep this much of the walk
  minWalkedM: 8, // no correction before this
  gateM: 6, // samples further than this from the route are ignored
  iterations: 10,
  minInliers: 6,
  maxStepM: 3, // per update
  maxStepDeg: 8,
  maxTotalM: 15, // over the whole trip
  maxTotalDeg: 25,
  confidentResidualM: 1,
  maxSpeedMps: 5, // faster than this is a SLAM jump, not walking: start the track again
  movingWithinS: 1.5,
  ignoreM: 0.02, // smaller corrections are not worth moving the arrows for
  ignoreDeg: 0.05,
}

const DEG = Math.PI / 180

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

/** Best rigid move of points onto their matches (2D Procrustes). */
function bestRigid(pairs) {
  const n = pairs.length
  let px = 0
  let py = 0
  let qx = 0
  let qy = 0
  for (const {p, q} of pairs) {
    px += p.x
    py += p.y
    qx += q.x
    qy += q.y
  }
  px /= n
  py /= n
  qx /= n
  qy /= n
  let dot = 0
  let cross = 0
  for (const {p, q} of pairs) {
    const ax = p.x - px
    const ay = p.y - py
    const bx = q.x - qx
    const by = q.y - qy
    dot += ax * bx + ay * by
    cross += ax * by - ay * bx
  }
  return {yaw: Math.atan2(cross, dot), from: {x: px, y: py}, to: {x: qx, y: qy}}
}

/**
 * Fit a walked track onto the route. Returns {dx, dy, yaw, pivot} about the pivot (the user),
 * or null when too few samples are near the route.
 */
export function fitTrackToRoute(track, route, {pivot = track.at(-1), gateM = MATCH.gateM, iterations = MATCH.iterations, minInliers = MATCH.minInliers} = {}) {
  let moved = track
  let user = pivot
  let yaw = 0
  for (let i = 0; i < iterations; i++) {
    const pairs = nearInliers(moved, route, gateM).filter(Boolean)
    if (pairs.length < minInliers) {
      if (i === 0) return null
      break
    }
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
  let clampedYaw = clampAbs(yaw, MATCH.maxStepDeg * DEG)
  clampedYaw = clampAbs(total.yaw + clampedYaw, MATCH.maxTotalDeg * DEG) - total.yaw

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
 *                          Returns a clamped {dx, dy, yaw, pivot}, or null for nothing to do.
 */
export function createRouteMatcher(route) {
  let samples = []
  let walked = 0
  let lastAt = null
  let lastMovedAt = null
  const total = {dx: 0, dy: 0, yaw: 0}
  let residual = null
  let confident = false

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
      } else {
        samples.push({x, z})
        walked += step
        trim()
      }
      lastMovedAt = time
    },
    moving: (time) => lastMovedAt != null && time - lastMovedAt <= MATCH.movingWithinS,
    update(toRoute) {
      if (walked < MATCH.minWalkedM) return null
      const track = samples.map((s) => toRoute(s))
      const fit = fitTrackToRoute(track, route)
      if (!fit) {
        confident = false
        return null
      }
      const correction = clampCorrection(fit, total)
      const after = fitQuality(track.map((p) => transform(p, correction, fit.pivot)), route)
      residual = after.residual
      confident = residual != null && residual < MATCH.confidentResidualM && after.matchedM >= MATCH.minWalkedM
      if (Math.hypot(correction.dx, correction.dy) < MATCH.ignoreM && Math.abs(correction.yaw) < MATCH.ignoreDeg * DEG) return null
      total.dx += correction.dx
      total.dy += correction.dy
      total.yaw += correction.yaw
      return correction
    },
    get walkedM() {
      return walked
    },
    get samples() {
      return samples
    },
    get confident() {
      return confident
    },
    get residualM() {
      return residual
    },
    get totalOffsetM() {
      return Math.hypot(total.dx, total.dy)
    },
    get totalYawDeg() {
      return total.yaw / DEG
    },
  }
}
