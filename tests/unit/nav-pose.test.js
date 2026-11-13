import {describe, expect, it} from 'vitest'
import {createNavPose, levelAt, levelsAlong, routeBearingAt, signedOffset, steeredBearing} from '../../src/route/nav-pose.js'

// North 50 m, then east 50 m (route frame: x east, y north).
const L = [
  {x: 0, y: 0},
  {x: 0, y: 50},
  {x: 50, y: 50},
]

describe('signedOffset', () => {
  it('is positive to the right of the route and negative to the left', () => {
    expect(signedOffset(L, 20, {x: 6, y: 20})).toBeCloseTo(6)
    expect(signedOffset(L, 20, {x: -6, y: 20})).toBeCloseTo(-6)
    expect(signedOffset(L, 20, {x: 0, y: 20})).toBeCloseTo(0)
  })
  it('follows the route round the corner (east leg: south is right)', () => {
    expect(signedOffset(L, 75, {x: 25, y: 46})).toBeCloseTo(4)
  })
  it('only searches near s, so another stretch of the route is never measured instead', () => {
    // Near the start, a point beside the east leg is still measured from the north leg.
    expect(Math.abs(signedOffset(L, 0, {x: 30, y: 49}))).toBeGreaterThan(20)
  })
})

describe('the arrow follows the path, not the raw position', () => {
  const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
  it('reads the route direction from s', () => {
    expect(routeBearingAt(L, 10)).toBeCloseTo(0)
    expect(routeBearingAt(L, 60)).toBeCloseTo(90)
  })
  it('is the path direction itself while near the route, or before walking has proved the placement', () => {
    expect(steeredBearing(0, 3, true)).toBe(0) // 3 m off: no steering
    expect(steeredBearing(0, 9, false)).toBe(0) // far off, but the match is not confident yet
    expect(steeredBearing(null, 0, true)).toBeNull()
  })
  it('6 m off the route: leans back towards it, and stays within 25° of the path', () => {
    const right = steeredBearing(0, 6, true) // 6 m to the right of a path going north
    expect(diff(right, 0)).toBeGreaterThan(0)
    expect(diff(right, 0)).toBeLessThanOrEqual(25)
    expect(right).toBeGreaterThan(180) // leans left (anticlockwise), back to the path
    const left = steeredBearing(90, -6, true) // 6 m left of a path going east: leans right
    expect(left).toBeGreaterThan(90)
    expect(diff(left, 90)).toBeLessThanOrEqual(25)
  })
  it('never leans more than 25°, however far off', () => {
    for (const off of [5, 10, 20, 50, -50]) expect(diff(steeredBearing(45, off, true), 45)).toBeLessThanOrEqual(25)
  })
})

describe('floor level along the route', () => {
  const origin = {lat: 56.1448, lng: -3.9205}
  const pts = [
    {lat: 56.1448, lng: -3.9205, z: 0},
    {lat: 56.1449, lng: -3.9205, z: 0},
    {lat: 56.1449, lng: -3.9205, z: 1}, // in at the door, on level 1
    {lat: 56.145, lng: -3.9205, z: 2}, // up the stairs
  ]
  it('reads MazeMap z at each point along the route', () => {
    const levels = levelsAlong(pts, origin)
    expect(levelAt(levels, 0)).toBe(0)
    expect(levelAt(levels, 5)).toBe(0)
    expect(levelAt(levels, 11.2)).toBe(1)
    expect(levelAt(levels, 30)).toBe(2)
    expect(levelAt([], 3)).toBeNull()
  })
})

describe('createNavPose', () => {
  it('holds one pose: s, signed offset, heading and confidence', () => {
    const pose = createNavPose()
    const p = pose.update({route: L, routeS: 20, shownS: 19.5, tracked: {x: 3, y: 20}, headingDeg: 5, confident: true})
    expect(p).toMatchObject({routeS: 20, shownS: 19.5, headingDeg: 5, confident: true})
    expect(p.lateralOffsetM).toBeCloseTo(3)
    expect(pose.current).toBe(p)
  })
  it('is never confident without a position along the route', () => {
    const pose = createNavPose()
    expect(pose.update({route: L, routeS: null, confident: true}).confident).toBe(false)
    pose.reset()
    expect(pose.current.routeS).toBeNull()
  })
})
