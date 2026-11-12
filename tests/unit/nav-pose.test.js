import {describe, expect, it} from 'vitest'
import {aimBearing, createNavPose, routeBearingAt, signedOffset} from '../../src/route/nav-pose.js'

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

describe('routeBearingAt and aimBearing', () => {
  it('reads the route direction from s', () => {
    expect(routeBearingAt(L, 10)).toBeCloseTo(0)
    expect(routeBearingAt(L, 60)).toBeCloseTo(90)
  })
  it('aims from the tracked position at the route ahead of the pose s', () => {
    expect(aimBearing(L, {routeS: 10, tracked: {x: 0, y: 10}})).toBeCloseTo(0)
    expect(aimBearing(L, {routeS: null, tracked: null})).toBeNull()
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
