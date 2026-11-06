import {describe, expect, it} from 'vitest'
import {clampCorrection, createRouteMatcher, detectTrackTurn, findCornerAnchor, fitTrackToRoute, walkVsRoute} from '../../src/ar/route-matcher.js'
import {MATCH} from '../../src/config.js'

const DEG = Math.PI / 180
const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

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
function walkWithMisplacement(error, walkTo = 58, stepM = 0.65) {
  const matcher = createRouteMatcher(L)
  let placed = (p) => p
  let yawTotal = 0
  let time = 0
  let sinceUpdate = 0
  const corrections = []
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
      corrections.push(c)
      placed = (p) => {
        const turned = rotate(before(p), c.yaw, c.pivot)
        return {x: turned.x + c.dx, y: turned.y + c.dy}
      }
      yawTotal += c.yaw
    }
  }
  return {matcher, placed, yawTotal, corrections}
}

function expectOnRoute(placed, error, tolM = 0.5) {
  for (const s of [20, 34, 44, 52, 58]) {
    const truth = pointOnL(s)
    const got = placed(error(truth))
    expect(Math.hypot(got.x - truth.x, got.y - truth.y)).toBeLessThan(tolM)
  }
}

describe('route matcher', () => {
  it.each([
    ['clockwise, drifting away from the route', -30, 8],
    ['anticlockwise, drifting towards the route', 30, 8],
    ['clockwise, shifted the other side', -30, -8],
    ['anticlockwise, shifted the other side', 30, -8],
  ])('corrects a walk shifted 8 m sideways and rotated 30° (%s) to within 0.5 m and 2°', (_, deg, shift) => {
    const error = (p) => {
      const r = rotate(p, deg * DEG)
      return {x: r.x + shift, y: r.y}
    }
    const {matcher, placed, yawTotal, corrections} = walkWithMisplacement(error)
    near(wrap(yawTotal - -deg * DEG), 0, 2 * DEG)
    expectOnRoute(placed, error)
    expect(matcher.confident).toBe(true)
    expect(matcher.residualM).toBeLessThan(0.5)
    expect(matcher.flipped).toBe(false)
    expect(corrections.every((c) => Math.abs(c.yaw) <= MATCH.maxStepDeg * DEG + 1e-9)).toBe(true)
  })

  it('corrects an alignment flipped by 180°, trusting the walking', () => {
    const error = (p) => rotate(p, Math.PI)
    const {matcher, placed, yawTotal, corrections} = walkWithMisplacement(error)
    expect(matcher.flipped).toBe(true)
    expect(corrections.filter((c) => c.flipped)).toHaveLength(1)
    near(wrap(yawTotal - Math.PI), 0, 2 * DEG)
    expectOnRoute(placed, error)
    expect(matcher.confident).toBe(true)
  })

  it('does not flip on a single reading of the wrong way', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 12; i++) matcher.addSample(0, -i * 0.65, i * 0.5)
    expect(matcher.update((w) => ({x: w.x, y: w.z}))).toBeNull()
    expect(matcher.flipped).toBe(false)
  })

  it('does not flip someone turning back once the fit has been confident', () => {
    const matcher = createRouteMatcher(L)
    const toRoute = (w) => ({x: w.x, y: w.z})
    let t = 0
    for (let y = 0; y <= 15; y += 0.65) matcher.addSample(0, y, (t += 0.5))
    matcher.update(toRoute)
    expect(matcher.confident).toBe(true)
    for (let y = 15; y >= -20; y -= 0.65) matcher.addSample(0, y, (t += 0.5))
    matcher.update(toRoute)
    const c = matcher.update(toRoute)
    expect(c?.flipped).toBeUndefined()
    expect(matcher.flipped).toBe(false)
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

  it('does nothing before 5 m of walking', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 7; i++) matcher.addSample(2, i * 0.7, i)
    expect(matcher.walkedM).toBeLessThan(MATCH.minWalkedM)
    expect(matcher.update((w) => ({x: w.x, y: w.z}))).toBeNull()
  })

  it('clamps a single update to 3 m and 10°', () => {
    const c = clampCorrection({dx: 8, dy: 6, yaw: 20 * DEG, pivot: {x: 0, y: 0}})
    near(Math.hypot(c.dx, c.dy), 3, 1e-9)
    near(c.yaw, 10 * DEG, 1e-9)
    near(c.dy / c.dx, 6 / 8, 1e-9) // same direction
    near(clampCorrection({dx: 0, dy: 0, yaw: -20 * DEG}).yaw, -10 * DEG, 1e-9)
  })

  it('clamps the trip total to 20 m and 75°', () => {
    const total = {dx: 19, dy: 0, yaw: 74 * DEG}
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

  describe('corners', () => {
    /** Leg one and just enough of leg two, every metre, offset along the route by offsetY. */
    const walkRoundCorner = (afterCorner, offsetY) => {
      const track = []
      for (let s = 8; s <= 30 + afterCorner; s += 1) {
        const p = pointOnL(s)
        track.push({x: p.x, y: p.y + offsetY})
      }
      return track
    }

    it('finds the turn in a walk, right and left', () => {
      const right = detectTrackTurn(walkRoundCorner(8, 0))
      near(right.angle, 90, 15)
      expect(right.index).toBe(22) // s = 30
      const left = detectTrackTurn(walkRoundCorner(8, 0).map((p) => ({x: -p.x, y: p.y})))
      near(left.angle, -90, 15)
    })
    it('finds no turn in a straight walk, or one that has only just begun', () => {
      expect(detectTrackTurn(walkRoundCorner(-5, 0))).toBeNull()
      // Only 2 m round the corner the walk looks like 45°, too far from the route's 90° to anchor.
      expect(findCornerAnchor(walkRoundCorner(2, 0), L)).toBeNull()
    })
    it('matches a turn in the walk to the same turn in the route', () => {
      const anchor = findCornerAnchor(walkRoundCorner(6, -5), L)
      expect(anchor.q).toEqual({x: 0, y: 30})
    })
    it('ignores a turn the opposite way to the route, or far from any corner', () => {
      const mirrored = walkRoundCorner(6, 0).map((p) => ({x: -p.x, y: p.y}))
      expect(findCornerAnchor(mirrored, L)).toBeNull()
      expect(findCornerAnchor(walkRoundCorner(6, -40), L)).toBeNull()
    })
    it('fixes an along-route offset that side-on samples hardly can', () => {
      const track = walkRoundCorner(5, -6)
      const plain = fitTrackToRoute(track, L, {iterations: 1, useCorners: false})
      const anchored = fitTrackToRoute(track, L, {iterations: 1})
      expect(Math.abs(anchored.dy)).toBeGreaterThan(Math.abs(plain.dy) * 1.5)
      const settled = fitTrackToRoute(track, L)
      near(settled.dy, 6, 0.5)
      near(settled.dx, 0, 0.5)
    })
    it('corrects an along-route offset while walking round the corner', () => {
      const error = (p) => ({x: p.x, y: p.y - 7})
      const {placed} = walkWithMisplacement(error, 42)
      for (const s of [31, 36, 42]) {
        const truth = pointOnL(s)
        const got = placed(error(truth))
        expect(Math.hypot(got.x - truth.x, got.y - truth.y)).toBeLessThan(0.5)
      }
    })
  })

  it('locks once the fit is confident, and stays locked', () => {
    const matcher = createRouteMatcher(L)
    const toRoute = (w) => ({x: w.x, y: w.z})
    expect(matcher.locked).toBe(false)
    let t = 0
    for (let y = 0; y <= 8; y += 0.65) matcher.addSample(0.2, y, (t += 0.5))
    matcher.update(toRoute)
    expect(matcher.locked).toBe(true)
    matcher.addSample(40, 40, t + 0.5) // a SLAM jump loses the fit...
    expect(matcher.confident).toBe(false)
    expect(matcher.locked).toBe(true) // ...but the hint does not come back
  })

  it('reads the walking direction against the route', () => {
    const north = [{x: 1, y: 2}, {x: 1, y: 10}]
    near(walkVsRoute(north, L).turn, 0, 1e-9)
    near(Math.abs(walkVsRoute([...north].reverse(), L).turn), Math.PI, 1e-9)
  })

  it('keeps only the last 30 m of walking, but remembers the whole walk', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 200; i++) matcher.addSample(0, i * 0.65, i * 0.5)
    expect(matcher.walkedM).toBeLessThanOrEqual(MATCH.trackM + 0.65)
    expect(matcher.walkedM).toBeGreaterThanOrEqual(MATCH.trackM - 0.65)
    near(matcher.everWalkedM, 199 * 0.65, 1e-6)
  })

  it('starts the track again after a SLAM jump', () => {
    const matcher = createRouteMatcher(L)
    for (let i = 0; i < 20; i++) matcher.addSample(0, i * 0.65, i * 0.5)
    expect(matcher.walkedM).toBeGreaterThan(MATCH.minWalkedM)
    matcher.addSample(40, 40, 10)
    expect(matcher.walkedM).toBe(0)
  })
})
