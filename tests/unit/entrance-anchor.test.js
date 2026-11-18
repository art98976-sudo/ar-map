// Fix 3: the entrance re-anchor, indoor GPS and the compass hold (src/ar/entrance-anchor.js).
import {describe, expect, it} from 'vitest'
import {createHeadingHold, createIndoorGpsGate, entranceIndex, planEntranceAnchor} from '../../src/ar/entrance-anchor.js'

// A route due north: 20 m outside, the door at s = 20, then 20 m of corridor.
const ROUTE = [
  {x: 0, y: 0},
  {x: 0, y: 20},
  {x: 0, y: 40},
]
/** A straight walk ending at (x, y), `metres` long, heading `deg` clockwise from north. */
function walk(x, y, deg, metres = 4) {
  const r = (deg * Math.PI) / 180
  const pts = []
  for (let m = metres; m >= 0; m -= 0.25) pts.push({x: x - Math.sin(r) * m, y: y - Math.cos(r) * m})
  return pts
}

describe('entranceIndex', () => {
  it('is the first point on a floor after an outdoor stretch', () => {
    expect(entranceIndex([{z: 0}, {z: 0}, {z: 2}, {z: 2}])).toBe(2)
  })
  it('-1 for an outdoor route, or one that starts indoors', () => {
    expect(entranceIndex([{z: 0}, {z: 0}])).toBe(-1)
    expect(entranceIndex([{z: 1}, {z: 0}])).toBe(-1)
  })
})

describe('planEntranceAnchor', () => {
  it('waits until route progress reaches the door, and stops 2 m past it', () => {
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 17, track: walk(0, 17, 0)})).toBeNull()
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 19, track: walk(0, 19, 0)})).toBeNull()
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 19.6, track: walk(0, 19.6, 0)})).not.toBeNull()
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 22.5, track: walk(0, 22.5, 0)})).toBeNull()
  })

  it('puts the user on the door, wherever drift had put them', () => {
    const plan = planEntranceAnchor({route: ROUTE, doorS: 20, s: 20.5, track: walk(3, 20.5, 0)})
    expect(plan.at).toEqual({x: 0, y: 20})
    expect(plan.s).toBe(20)
  })

  it('a path turned 15° anticlockwise: the walk runs 15° right of it, so turn it 15° clockwise', () => {
    // In the (wrongly turned) route frame, walking up the real corridor looks like 15° east of north.
    const plan = planEntranceAnchor({route: ROUTE, doorS: 20, s: 20, track: walk(0, 20, 15)})
    expect(plan.turnDeg).toBeCloseTo(15, 0)
  })

  it('and the other way', () => {
    const plan = planEntranceAnchor({route: ROUTE, doorS: 20, s: 20, track: walk(0, 20, -12)})
    expect(plan.turnDeg).toBeCloseTo(-12, 0)
  })

  it('too short a walk, or too big a turn: position only, no heading change', () => {
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 20, track: walk(0, 20, 15, 1)}).turnDeg).toBe(0)
    expect(planEntranceAnchor({route: ROUTE, doorS: 20, s: 20, track: walk(0, 20, 70)}).turnDeg).toBe(0)
  })
})

describe('createIndoorGpsGate', () => {
  it('outdoors every fix is used', () => {
    const g = createIndoorGpsGate()
    expect(g.update({accuracy: 30}, false)).toEqual({use: true, outside: false})
  })

  it('indoors fixes are ignored, until 3 good ones in a row say the user is back outside', () => {
    const g = createIndoorGpsGate()
    expect(g.update({accuracy: 35}, true).use).toBe(false)
    expect(g.update({accuracy: 8}, true).use).toBe(false)
    expect(g.update({accuracy: 8}, true).use).toBe(false)
    expect(g.update({accuracy: 8}, true)).toEqual({use: true, outside: true})
    expect(g.update({accuracy: 25}, true).use).toBe(false) // one poor fix: inside again
  })
})

describe('createHeadingHold', () => {
  it('passes the compass through while it is steady', () => {
    const h = createHeadingHold()
    expect(h.update(90, 5)).toBe(90)
    expect(h.update(95, 8)).toBe(95)
    expect(h.holding).toBe(false)
  })

  it('keeps the last good heading while it swings more than 20°', () => {
    const h = createHeadingHold()
    h.update(90, 5)
    expect(h.update(140, 35)).toBe(90)
    expect(h.holding).toBe(true)
    expect(h.update(60, 25)).toBe(90)
    expect(h.update(100, 10)).toBe(100) // steady again: the live compass
    expect(h.holding).toBe(false)
  })
})
