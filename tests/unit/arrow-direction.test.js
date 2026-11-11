import {describe, expect, it} from 'vitest'
import {fromLocal} from '../../src/geo/geo.js'
import {arrowYawDeg} from '../../src/route/compass-guide.js'
import {
  arrowBearing,
  arrowDirection,
  lookAheadPoint,
  normaliseRoute,
  progressOnRoute,
  routeFromPoints,
} from '../../src/route/arrow-direction.js'

const O = {lat: 56.1452, lng: -3.9205}
// Metres east (x) / north (y) of O -> {lat, lon}
const at = (x, y) => {
  const p = fromLocal(O, {x, y})
  return {lat: p.lat, lon: p.lng}
}
// An L: 50 m north, then 50 m east. The destination is north-east of the start.
const L = routeFromPoints([at(0, 0), at(0, 50), at(50, 50)])

const feature = (coords, z = 0, buildingId = null) => ({
  type: 'Feature',
  geometry: {type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat])},
  properties: {m: 1, z, buildingId},
})

describe('normaliseRoute', () => {
  it('joins every stretch into one ordered list, keeping each point’s floor', () => {
    const r = normaliseRoute({
      path: {features: [feature([at(0, 0), at(0, 10)]), feature([at(0, 10), at(5, 10)]), feature([at(5, 10), at(5, 15)], 2, 1009836)]},
      pathMetrics: {distanceWalkingMeters: 20},
    })
    expect(r.points).toHaveLength(4) // the shared corners appear once
    expect(r.points.map((p) => p.z)).toEqual([0, 0, 2, 2])
    expect(r.points[1]).toEqual({...at(0, 10), z: 0})
    expect(r.lengthMetres).toBe(20)
  })

  it('measures the route when MazeMap gives no length, and copes with nothing', () => {
    const r = normaliseRoute({path: {features: [feature([at(0, 0), at(0, 30), at(40, 30)])]}})
    expect(r.lengthMetres).toBeCloseTo(70, 1)
    expect(normaliseRoute(null)).toEqual({points: [], lengthMetres: 0})
    expect(normaliseRoute({path: {features: [{geometry: {coordinates: [[NaN, 1]]}}]}}).points).toEqual([])
  })
})

describe('progressOnRoute', () => {
  it('projects the user on to the nearest segment', () => {
    expect(progressOnRoute(L, at(0, 20))).toMatchObject({segmentIndex: 0})
    expect(progressOnRoute(L, at(0, 20)).distanceAlong).toBeCloseTo(20, 1)
    const off = progressOnRoute(L, at(10, 20))
    expect(off.distanceAlong).toBeCloseTo(20, 1)
    expect(off.distanceFromRoute).toBeCloseTo(10, 1)
    const second = progressOnRoute(L, at(30, 52))
    expect(second.segmentIndex).toBe(1)
    expect(second.distanceAlong).toBeCloseTo(80, 1)
    expect(second.distanceFromRoute).toBeCloseTo(2, 1)
  })

  it('never slides back more than 5 m between updates', () => {
    expect(progressOnRoute(L, at(0, 10), 30).distanceAlong).toBeCloseTo(25, 1)
    expect(progressOnRoute(L, at(0, 28), 30).distanceAlong).toBeCloseTo(28, 1)
  })

  it('moves forward no more than 25 m per update', () => {
    const straight = routeFromPoints([at(0, 0), at(0, 100)])
    expect(progressOnRoute(straight, at(0, 80), 30).distanceAlong).toBeCloseTo(55, 1)
    expect(progressOnRoute(straight, at(0, 80), 30, {maxAheadM: Infinity}).distanceAlong).toBeCloseTo(80, 1)
    expect(progressOnRoute(straight, at(0, 80)).distanceAlong).toBeCloseTo(80, 1) // first update: anywhere
  })

  it('does not creep towards a later stretch of route that passes closer', () => {
    // North 60 m, east 20 m, then back south: the way back passes 20 m east of the start.
    const loop = routeFromPoints([at(0, 0), at(0, 60), at(20, 60), at(20, 0)])
    let along = 0
    for (let i = 0; i < 30; i++) along = progressOnRoute(loop, at(16, 5), along).distanceAlong // 16 m off, 4 m from the way back
    expect(along).toBeCloseTo(5, 1)
    // Without a previous position it does take the nearest stretch.
    expect(progressOnRoute(loop, at(16, 5)).distanceAlong).toBeCloseTo(135, 1)
  })

  it('stays on the right stretch of a route that doubles back on itself', () => {
    // 40 m north, then back south 3 m to the east of the way up.
    const hairpin = routeFromPoints([at(0, 0), at(0, 40), at(3, 40), at(3, 0)])
    // Walking back down at y = 20: GPS puts the user nearer the way up.
    const down = progressOnRoute(hairpin, at(1, 20), 60)
    expect(down.segmentIndex).toBe(2)
    expect(down.distanceAlong).toBeCloseTo(63, 1)
    // Walking up at y = 20: GPS puts the user nearer the way down.
    const up = progressOnRoute(hairpin, at(2, 20), 18)
    expect(up.segmentIndex).toBe(0)
    expect(up.distanceAlong).toBeCloseTo(20, 1)
  })
})

describe('lookAheadPoint', () => {
  it('is 9 m further along the route line', () => {
    const p = lookAheadPoint(L, 0)
    const want = at(0, 9)
    expect(p.lat).toBeCloseTo(want.lat, 7)
    expect(p.lon).toBeCloseTo(want.lon, 7)
  })

  it('follows the line round a corner instead of cutting it', () => {
    const p = lookAheadPoint(L, 45) // 5 m before the corner -> 4 m after it
    const want = at(4, 50)
    expect(p.lat).toBeCloseTo(want.lat, 7)
    expect(p.lon).toBeCloseTo(want.lon, 7)
  })

  it('is the destination near the end', () => {
    expect(lookAheadPoint(L, 95)).toEqual({lat: at(50, 50).lat, lon: at(50, 50).lon})
    expect(lookAheadPoint(L, 500, 9)).toEqual({lat: at(50, 50).lat, lon: at(50, 50).lon})
    expect(lookAheadPoint(routeFromPoints([]), 0)).toBeNull()
  })

  it('takes another look-ahead distance', () => {
    expect(lookAheadPoint(L, 0, 20).lat).toBeCloseTo(at(0, 20).lat, 7)
  })
})

describe('arrowBearing', () => {
  it('gives degrees from north', () => {
    expect(arrowBearing(at(0, 0), at(0, 10))).toBeCloseTo(0, 1)
    expect(arrowBearing(at(0, 0), at(10, 0))).toBeCloseTo(90, 1)
    expect(arrowBearing(at(0, 0), at(0, -10))).toBeCloseTo(180, 1)
    expect(arrowBearing(at(0, 0), at(-10, 0))).toBeCloseTo(270, 1)
  })

  it('on screen: the arrow turns by the bearing minus the phone’s heading', () => {
    const b = arrowBearing(at(0, 0), at(10, 0)) // east
    expect(arrowYawDeg(b, 0)).toBeCloseTo(90, 1) // facing north: right
    expect(arrowYawDeg(b, 90)).toBeCloseTo(0, 1) // facing east: ahead
    expect(arrowYawDeg(b, 180)).toBeCloseTo(-90, 1) // facing south: left
  })
})

describe('the arrow along a walk', () => {
  it('points along the path, not at the destination', () => {
    // The destination is north-east (45°) of the start, but the path goes north first.
    expect(arrowDirection(L, at(0, 0)).bearingDeg).toBeCloseTo(0, 1)
  })

  it('turns at the corner, step by step', () => {
    const bearings = [30, 40, 45, 49, 50].map((y) => arrowDirection(L, at(0, y)).bearingDeg)
    expect(bearings[0]).toBeCloseTo(0, 1)
    for (let i = 1; i < bearings.length; i++) expect(bearings[i]).toBeGreaterThanOrEqual(bearings[i - 1] - 1e-6)
    expect(bearings.at(-1)).toBeCloseTo(90, 1)
  })

  it('leads someone off the path back on to it', () => {
    // 10 m east of the first leg, 20 m up: aim at (0, 29), up and to the left.
    const b = arrowDirection(L, at(10, 20)).bearingDeg
    expect(b).toBeGreaterThan(270)
    expect(b).toBeLessThan(360)
    expect(b).toBeCloseTo(360 - (Math.atan2(10, 9) * 180) / Math.PI, 0)
  })

  it('aims at the destination itself for the last 9 m', () => {
    const d = arrowDirection(L, at(45, 52))
    expect(d.target).toEqual({lat: at(50, 50).lat, lon: at(50, 50).lon})
  })

  it('keeps the last direction when standing on the destination', () => {
    expect(arrowDirection(L, at(50, 50)).bearingDeg).toBeCloseTo(90, 1)
  })

  it('returns null without a route or a position', () => {
    expect(arrowDirection(routeFromPoints([]), at(0, 0))).toBeNull()
    expect(arrowDirection(L, null)).toBeNull()
  })
})
