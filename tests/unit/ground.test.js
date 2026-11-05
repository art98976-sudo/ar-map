import {describe, expect, it} from 'vitest'
import {acceptHit, createGroundTracker, fitGround, GROUND} from '../../src/ar/ground.js'

const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const hitsOn = (height, slope, from = -2, to = 12) => {
  const hits = []
  for (let s = from; s <= to; s += 1) hits.push({s, y: height + slope * s, time: 100})
  return hits
}

describe('which hits count', () => {
  const camera = {x: 0, y: 1.5, z: 0}
  it('keeps a hit below the phone, nearby and near the route', () => {
    expect(acceptHit({x: 3, y: 0, z: -3}, camera, 1)).toBe(true)
  })
  it('rejects a hit at or above the phone, like a wall or a window', () => {
    expect(acceptHit({x: 3, y: 1.4, z: -3}, camera, 1)).toBe(false)
    expect(acceptHit({x: 3, y: 2.5, z: -3}, camera, 1)).toBe(false)
  })
  it('rejects a hit too far away, or off the route', () => {
    expect(acceptHit({x: 20, y: 0, z: 0}, camera, 1)).toBe(false)
    expect(acceptHit({x: 3, y: 0, z: 0}, camera, 5)).toBe(false)
    expect(acceptHit(null, camera, 1)).toBe(false)
  })
})

describe('fitting the ground', () => {
  it('finds a flat height', () => {
    const fit = fitGround(hitsOn(-1.2, 0), 0, 100)
    near(fit.height, -1.2, 1e-6)
    near(fit.slope, 0, 1e-6)
  })
  it('finds a slope, with the height measured at the user', () => {
    const fit = fitGround(hitsOn(0.5, 0.1).map((h) => ({...h, s: h.s + 40})), 40, 100)
    near(fit.height, 0.5, 1e-6)
    near(fit.slope, 0.1, 1e-6)
  })
  it('rejects outliers beyond 0.35 m', () => {
    const hits = [...hitsOn(0, 0), {s: 3, y: 1.0, time: 100}, {s: 6, y: -1.5, time: 100}, {s: 8, y: 0.8, time: 100}]
    const fit = fitGround(hits, 0, 100)
    near(fit.height, 0, 0.02)
    near(fit.slope, 0, 0.005)
    expect(fit.inliers).toHaveLength(hits.length - 3)
  })
  it('clamps the slope to ±0.18, keeping the height sensible', () => {
    expect(fitGround(hitsOn(0, 0.5), 0, 100).slope).toBe(GROUND.maxSlope)
    expect(fitGround(hitsOn(0, -0.5), 0, 100).slope).toBe(-GROUND.maxSlope)
  })
  it('believes no slope over less than 3 m', () => {
    const close = [0, 0.5, 1, 1.5, 2].map((s) => ({s, y: 1 + 0.15 * s, time: 100}))
    const fit = fitGround(close, 0, 100)
    expect(fit.slope).toBe(0)
    near(fit.height, 1.15, 0.01)
  })
  it('counts newer hits for more', () => {
    const hits = [...hitsOn(0, 0, 0, 5).map((h) => ({...h, time: 80})), ...hitsOn(0.3, 0, 0, 5).map((h) => ({...h, time: 100}))]
    expect(fitGround(hits, 0, 100).height).toBeGreaterThan(0.05)
  })
  it('forgets old hits, and needs a few to go on', () => {
    expect(fitGround(hitsOn(0, 0).map((h) => ({...h, time: 10})), 0, 100)).toBeNull()
    expect(fitGround(hitsOn(0, 0, 0, 1), 0, 100)).toBeNull()
  })
})

describe('the ground tracker', () => {
  const feed = (tracker, height, slope = 0, camY = height + 1.6, time = 100) => {
    for (let s = -2; s <= 12; s += 1) tracker.addHit(s, height + slope * s, camY, time)
  }

  it('falls back to the phone height minus 1.45 m with no hits', () => {
    const tracker = createGroundTracker()
    const out = tracker.update(0.016, 0, 1.5, 100)
    near(out.height, 0.05, 1e-6)
    expect(out.slope).toBe(0)
    expect(out.source).toBe('eye')
    near(tracker.fallback(1.5), 0.05, 1e-6)
  })
  it('learns the height of the phone from nearby hits, for later fallback', () => {
    const tracker = createGroundTracker()
    feed(tracker, 0, 0, 1.25)
    tracker.update(0.016, 0, 1.25, 100)
    near(tracker.eyeM, 1.25, 0.01)
    // Much later, walking somewhere with no hits, on ground 1 m higher.
    const out = tracker.update(5, 0, 2.25, 200)
    expect(out.source).toBe('eye')
    near(out.height, 1, 0.01)
  })
  it('never learns an impossible eye height', () => {
    const tracker = createGroundTracker()
    feed(tracker, 0, 0, 9)
    tracker.update(0.016, 0, 9, 100)
    expect(tracker.eyeM).toBe(GROUND.maxEyeM)
  })
  it('eases over about 0.4 s rather than jumping', () => {
    const tracker = createGroundTracker()
    tracker.update(0.016, 0, 1.45, 100) // starts on the fallback: 0
    feed(tracker, 0.5, 0, 1.45, 100)
    const first = tracker.update(0.05, 0, 1.45, 100)
    expect(first.height).toBeGreaterThan(0)
    expect(first.height).toBeLessThan(0.25)
    let out = first
    for (let i = 0; i < 8; i++) out = tracker.update(0.05, 0, 1.45, 100)
    near(out.height, 0.5, 0.03)
    expect(out.source).toBe('hits')
  })
  it('keeps only the newest hits', () => {
    const tracker = createGroundTracker()
    for (let i = 0; i < GROUND.maxHits + 50; i++) tracker.addHit(i % 10, 0, 1.5, 100)
    expect(tracker.hitCount).toBe(GROUND.maxHits)
  })
})
