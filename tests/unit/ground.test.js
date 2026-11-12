import {describe, expect, it} from 'vitest'
import {acceptFloorHit, acceptHit, createFloorFinder, createGroundTracker, FLOOR_GRID, fitGround, floorFromHits, median} from '../../src/ar/ground.js'
import {GROUND} from '../../src/config.js'

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

  it('falls back to the phone height minus 1.4 m with no hits', () => {
    const tracker = createGroundTracker()
    const out = tracker.update(0.016, 0, 1.5, 100)
    near(out.height, 0.1, 1e-6)
    expect(out.slope).toBe(0)
    expect(out.source).toBe('eye')
    near(tracker.fallback(1.5), 0.1, 1e-6)
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

describe('adjusting the floor height', () => {
  it('moves the assumed floor, within sensible limits', () => {
    const tracker = createGroundTracker()
    tracker.setEyeM(1.6)
    near(tracker.fallback(1.5), -0.1, 1e-9)
    tracker.setEyeM(5)
    expect(tracker.eyeM).toBe(GROUND.maxEyeM)
    tracker.setEyeM(0)
    expect(tracker.eyeM).toBe(GROUND.minEyeM)
  })
})

describe('the floor finder', () => {
  const cam = {x: 0, y: 1.5, z: 0}
  const floorHits = (y, n = 10, surface = true) => Array.from({length: n}, (_, i) => ({x: (i % 5) * 0.3, y, z: -1 - (i % 3) * 0.4, surface}))

  it('searches the lower half of the screen', () => {
    expect(FLOOR_GRID.length).toBe(20)
    expect(FLOOR_GRID.every(([x, y]) => x > 0 && x < 1 && y >= 0.5 && y < 1)).toBe(true)
  })

  it('accepts only hits 0.5-2.2 m below the phone and near it', () => {
    expect(acceptFloorHit({x: 0, y: 0, z: -1}, cam)).toBe(true) // 1.5 m below
    expect(acceptFloorHit({x: 0, y: 1.2, z: -1}, cam)).toBe(false) // a table 0.3 m below the phone
    expect(acceptFloorHit({x: 0, y: -0.8, z: -1}, cam)).toBe(false) // 2.3 m down: a stairwell
    expect(acceptFloorHit({x: 0, y: 0, z: -6}, cam)).toBe(false) // too far away
  })

  it('takes the median of a flat cluster, so a bed among floor hits does not lift it', () => {
    expect(median([3, 1, 2])).toBe(2)
    const hits = [...floorHits(0, 10), ...floorHits(0.55, 4)] // four hits on a bed 55 cm up
    const fit = floorFromHits(hits)
    expect(fit.height).toBeCloseTo(0, 6)
    expect(fit.found).toBe(true)
  })

  it('is not found from hits in one spot, nor from too few', () => {
    expect(floorFromHits(Array.from({length: 12}, () => ({x: 0, y: 0, z: -1, surface: true}))).found).toBe(false)
    expect(floorFromHits(floorHits(0, 5)).found).toBe(false)
  })

  it('uses feature points only when there are no surfaces', () => {
    const surfaces = floorHits(0, 8)
    const features = floorHits(0.4, 20, false)
    expect(floorFromHits([...surfaces, ...features]).height).toBeCloseTo(0, 6)
    expect(floorFromHits(features).height).toBeCloseTo(0.4, 6)
  })

  it('starts at the fallback, eases to the found floor, never more than 5 cm a frame', () => {
    const f = createFloorFinder()
    let r = f.update(0.016, cam, 0)
    expect(r).toMatchObject({source: 'fallback', found: false})
    expect(r.height).toBeCloseTo(1.5 - GROUND.defaultEyeM, 6)
    for (const h of floorHits(-0.2, 10)) f.addHit(h, 'DETECTED_SURFACE', cam, 0.1)
    let last = r.height
    for (let i = 0; i < 40; i++) {
      r = f.update(0.016, cam, 0.1 + i * 0.016)
      expect(Math.abs(r.height - last)).toBeLessThanOrEqual(0.05 + 1e-9)
      last = r.height
    }
    expect(r).toMatchObject({source: 'hits', found: true})
    expect(r.height).toBeCloseTo(-0.2, 3)
    expect(r.belowPhoneM).toBeCloseTo(1.7, 3)
  })

  it('a tap sets the floor at once and overrides hits, until cleared', () => {
    const f = createFloorFinder()
    for (const h of floorHits(0, 10)) f.addHit(h, 'DETECTED_SURFACE', cam, 0)
    f.update(0.016, cam, 0)
    f.setTap(0.3)
    expect(f.update(0.016, cam, 0.02)).toMatchObject({source: 'tap', height: 0.3})
    f.clear()
    expect(f.update(0.016, cam, 0.04).source).toBe('fallback')
  })
})
