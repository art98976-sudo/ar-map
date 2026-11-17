// Gate C/D: a simulated walk of a network route through the map-constrained pose
// (src/ar/network-pose.js), with the errors a phone really has: the compass out by 25°, tracking
// drifting 2 m every 20 m, GPS jumping 30 m outdoors and 20-50 m off indoors. Headless: the
// simulator (simulate.js, ?simulate=1&network=1) and the unit tests run it.
import {along, createNetworkPose, routeModel} from '../ar/network-pose.js'

/** A small seeded random number generator, so a run can be repeated exactly. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rotate = ({x, y}, deg) => {
  const r = (deg * Math.PI) / 180
  return {x: x * Math.cos(r) + y * Math.sin(r), y: -x * Math.sin(r) + y * Math.cos(r)}
}

function closest(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}

/**
 * Walk the route. points: a network route's points (campus metres). Returns metrics and a trace
 * ({truth, pose} every step). onStep(step) is called for every step (the arrows use it).
 */
export function simulateNetworkWalk({
  points,
  crossesWall = () => false,
  insideBuilding = () => false,
  floorHeights = {},
  compassErrorDeg = 25,
  driftPer20M = 2,
  gpsJumpM = 30,
  jumpEveryM = 50,
  gpsEveryM = 1.5,
  gpsNoiseM = 3,
  gpsAccuracyM = 8,
  indoorGpsOffM = 35,
  stepM = 0.5,
  seed = 7,
  onStep = null,
}) {
  const random = rng(seed)
  const model = routeModel(points)
  const pose = createNetworkPose({points, crossesWall, insideBuilding, floorHeights})
  const heightOf = (z) => (z === 0 ? 0 : (floorHeights[z] ?? 0))
  const driftStepDeg = (Math.atan(driftPer20M / 20) * 180) / Math.PI // per 20 m, as a random walk
  let yawErr = compassErrorDeg
  pose.start({...points[0], z: points[0].z, accuracyM: gpsAccuracyM})
  pose.compass(compassErrorDeg)

  const trace = []
  let sTrue = 0
  let nextGps = 0
  let nextJump = jumpEveryM
  let nextDrift = 20
  let maxPosM = 0
  let maxAlongM = 0
  let maxLateralM = 0
  let floorMismatches = 0
  let wallCrossings = 0
  let minConfidence = 1
  // At a stair or lift, and at a door's threshold (outdoors and indoors at once), the floor is
  // between two values: those few metres are not counted as a wrong floor.
  const nearFloorChange = (s) => model.floorChanges.some((f) => s >= f.sBottom - 3 && s <= f.sTop + 3) || model.doors.some((d) => Math.abs(s - d.s) <= 1)

  while (sTrue < model.total) {
    // A stair or lift ahead: walk up to it, then climb it (its run can be shorter than a step).
    const vert = model.segs.find((g) => g.vertical && g.s1 > sTrue + 1e-6 && g.s0 < sTrue + stepM)
    if (vert && sTrue >= vert.s0 - 1e-6) {
      const g = vert
      const rise = heightOf(g.b.z) - heightOf(g.a.z)
      const steps = Math.max(5, Math.ceil(g.len / stepM))
      for (let k = 0; k < steps; k++) {
        const run = g.len / steps
        const dir = {x: (g.b.x - g.a.x) / (g.len || 1), y: (g.b.y - g.a.y) / (g.len || 1)}
        const d = rotate({x: dir.x * run, y: dir.y * run}, yawErr)
        pose.move({dx: d.x, dy: d.y, dh: rise / steps})
      }
      sTrue = g.s1 + 0.001
      continue
    }
    const next = Math.min(model.total, vert ? vert.s0 : sTrue + stepM)
    const a = along(model, sTrue)
    const b = along(model, next)
    const walked = next - sTrue
    sTrue = next
    if (sTrue >= nextDrift) {
      yawErr += (random() * 2 - 1) * driftStepDeg
      nextDrift += 20
    }
    const d = rotate({x: b.x - a.x, y: b.y - a.y}, yawErr)
    pose.move({dx: d.x, dy: d.y, dh: 0})
    // GPS once a second or so: outdoors noisy with jumps; indoors 20-50 m off, reported as good.
    if (sTrue >= nextGps) {
      nextGps += gpsEveryM
      const truthNow = along(model, sTrue)
      let fix
      if (truthNow.z === 0) {
        const jump = sTrue >= nextJump
        if (jump) nextJump += jumpEveryM
        const ang = random() * Math.PI * 2
        const off = jump ? gpsJumpM : random() * gpsNoiseM
        fix = {x: truthNow.x + Math.cos(ang) * off, y: truthNow.y + Math.sin(ang) * off, accuracyM: gpsAccuracyM}
      } else {
        const ang = random() * Math.PI * 2
        fix = {x: truthNow.x + Math.cos(ang) * indoorGpsOffM, y: truthNow.y + Math.sin(ang) * indoorGpsOffM, accuracyM: 12}
      }
      pose.gps(fix)
    }
    const truth = along(model, sTrue)
    const now = pose.current
    const posM = Math.hypot(now.x - truth.x, now.y - truth.y)
    const alongM = Math.abs(now.s - sTrue)
    // Lateral: how far the pose is from the route on the true floor (which corridor it is in).
    let lateralM = Infinity
    for (const g of model.segs) if (g.floors.includes(truth.z)) lateralM = Math.min(lateralM, closest(now, g.a, g.b))
    const wrongFloor = now.z !== truth.z && !nearFloorChange(sTrue)
    if (wrongFloor) floorMismatches += 1
    // The pose is never behind a wall: the step sideways from the route to it crosses none.
    const onRoute = along(model, now.s)
    if (crossesWall(now.z, onRoute, now)) wallCrossings += 1
    maxPosM = Math.max(maxPosM, posM)
    maxAlongM = Math.max(maxAlongM, alongM)
    if (!wrongFloor) maxLateralM = Math.max(maxLateralM, lateralM)
    minConfidence = Math.min(minConfidence, now.confidence)
    const step = {s: sTrue, walked, truth: {x: truth.x, y: truth.y, z: truth.z}, pose: now, posM, alongM, lateralM}
    trace.push(step)
    onStep?.(step)
  }
  const end = pose.current
  return {
    totalM: model.total,
    maxPositionErrorM: maxPosM,
    maxAlongErrorM: maxAlongM,
    maxLateralM,
    finalAlongErrorM: Math.abs(end.s - model.total),
    floorMismatches,
    wallCrossings,
    anchors: end.anchors,
    headingLocked: end.headingLocked,
    yawFixDeg: end.yawFixDeg,
    gpsUsed: end.gpsUsed,
    gpsRejected: end.gpsRejected,
    minConfidence,
    finalFloor: end.z,
    trace,
  }
}
