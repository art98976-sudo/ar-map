import {describe, expect, it} from 'vitest'
import {clampCorrection, createRouteMatcher, fitTrackToRoute, MATCH} from '../../src/ar/route-matcher.js'

const DEG = Math.PI / 180
const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

// 30 m north, then a right turn and 30 m east.
const L = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}]

function pointOnL(s) {
  return s <= 30 ? {x: 0, y: s} : {x: s - 30, y: 30}
}

const rotate = (p, yaw, about = {x: 0, y: 0}) => {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const x = p.x - about.x
  const y = p.y - about.y
  return {x: x * c - y * s + about.x, y: x * s + y * c + about.y}
}

/**
 * Walk along the L while the route is misplaced by `error`, updating every ~2.6 m like the
 * app does, and keep the corrections. `placed` is the running route placement: SLAM -> route.
 */
function walkWithMisplacement(error, walkTo = 42, stepM = 0.65) {
  const matcher = createRouteMatcher(L)
  let placed = (p) => p
  let yawTotal = 0
  let time = 0
  let sinceUpdate = 0
  for (let s = 0; s <= walkTo; s += stepM) {
    const slam = error(pointOnL(s))
    matcher.addSample(slam.x, slam.y, time)
    time += 0.5
    sinceUpdate += stepM
    if (sinceUpdate < 2.6) continue
    sinceUpdate = 0
    const before = placed
    const c = matcher.update((w) => before({x: w.x, y: w.z}))
    if (c) {
      placed = (p) => {
        const r = before(p)
        const turned = rotate(r, c.yaw, c.pivot)
        return {x: turned.x + c.dx, y: turned.y + c.dy}
      }
      yawTotal += c.yaw
    }
  }
  return {matcher, placed, yawTotal}
}

describe('route matcher', () => {
  it('corrects a walk shifted 6 m sideways and rotated 10° to within 0.5 m and 1°', () => {
    const error = (p) => {
      const r = rotate(p, 10 * DEG)
      return {x: r.x + 6, y: r.y}
    }
    const {matcher, placed, yawTotal} = walkWithMisplacement(error)
    near(yawTotal, -10 * DEG, 1 * DEG)
    for (const s of [14, 22, 28, 34, 40]) {
      const truth = pointOnL(s)
      const got = placed(error(truth))
      expect(Math.hypot(got.x - truth.x, got.y - truth.y)).toBeLessThan(0.5)
    }
    expect(matcher.confident).toBe(true)
    expect(matcher.residualM).toBeLessThan(0.5)
  })

  it('produces no correction for a user standing still, however long', () => {
    const matcher = createRouteMatcher(L)
    for (let t = 0; t < 600; t += 0.5) {
      // Hand jitter of a few centimetres, 8 m from the route.
      matcher.addSample(8 + Math.sin(t * 7) * 0.08, Math.cos(t * 11) * 0.08, t)
    }
    expect(matcher.walkedM).toBeLessThan(MATCH.minStepM)
    expect(matcher.moving(600)).toBe(false)
    expect(matcher.update((w) => ({x: w.x, y: w.z}))).toBeNull()
    expect(matcher.confident).toBe(false)
  })

  it('does nothing before 8 m of walking', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 10; i++) matcher.addSample(2, i * 0.7, i)
    expect(matcher.walkedM).toBeLessThan(MATCH.minWalkedM)
    expect(matcher.update((w) => ({x: w.x, y: w.z}))).toBeNull()
  })

  it('clamps a single update to 3 m and 8°', () => {
    const c = clampCorrection({dx: 8, dy: 6, yaw: 20 * DEG, pivot: {x: 0, y: 0}})
    near(Math.hypot(c.dx, c.dy), 3, 1e-9)
    near(c.yaw, 8 * DEG, 1e-9)
    near(c.dy / c.dx, 6 / 8, 1e-9) // same direction
    near(clampCorrection({dx: 0, dy: 0, yaw: -20 * DEG}).yaw, -8 * DEG, 1e-9)
  })

  it('clamps the trip total to 15 m and 25°', () => {
    const total = {dx: 14, dy: 0, yaw: 24 * DEG}
    const c = clampCorrection({dx: 3, dy: 0, yaw: 5 * DEG, pivot: {x: 0, y: 0}}, total)
    near(c.dx, 1, 1e-9)
    near(c.yaw, 1 * DEG, 1e-9)
    // Coming back towards zero is not held back.
    const back = clampCorrection({dx: -3, dy: 0, yaw: -5 * DEG}, total)
    near(back.dx, -3, 1e-9)
    near(back.yaw, -5 * DEG, 1e-9)
  })

  it('ignores samples far from the route', () => {
    const onRoute = []
    for (let y = 0; y <= 10; y++) onRoute.push({x: 0.5, y})
    const far = []
    for (let y = 0; y <= 10; y++) far.push({x: 60, y})
    const withFar = fitTrackToRoute([...far, ...onRoute], L, {pivot: onRoute.at(-1)})
    const alone = fitTrackToRoute(onRoute, L, {pivot: onRoute.at(-1)})
    near(withFar.dx, alone.dx, 1e-6)
    near(withFar.dy, alone.dy, 1e-6)
    near(withFar.yaw, alone.yaw, 1e-9)
    near(withFar.dx, -0.5, 1e-6)
    expect(fitTrackToRoute(far, L)).toBeNull()
  })

  it('keeps only the last 25 m of walking', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 200; i++) matcher.addSample(0, i * 0.65, i * 0.5)
    expect(matcher.walkedM).toBeLessThanOrEqual(MATCH.trackM + 0.65)
    expect(matcher.walkedM).toBeGreaterThanOrEqual(MATCH.trackM - 0.65)
  })

  it('starts the track again after a SLAM jump', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 20; i++) matcher.addSample(0, i * 0.65, i * 0.5)
    expect(matcher.walkedM).toBeGreaterThan(MATCH.minWalkedM)
    matcher.addSample(40, 40, 10)
    expect(matcher.walkedM).toBe(0)
  })
})
