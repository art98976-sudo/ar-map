import {describe, expect, it} from 'vitest'
import {buildScene} from '../../src/scene/scene-data.js'
import {checkFitted, fitRoute, roundCorners, trimStartKink} from '../../src/scene/fit-route.js'
import {fromLocal} from '../../src/geo/geo.js'

const origin = {lat: 56.1448, lng: -3.9205}
const ll = (x, y, z) => ({...fromLocal(origin, {x, y}), z})
const toLL = ([x, y]) => {
  const p = fromLocal(origin, {x, y})
  return [p.lng, p.lat]
}
const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(toLL)]
const outline = [{id: 1, polygon: rect(-5, -10, 40, 20)}]

// A 2 m wide corridor along y = 0..2 from x = 0 to 30, a room to the north entered by a 0.9 m door
// at x = 20 in the north wall, and a stair at the east end up to level 2.
const corridor = {
  walls: [
    {id: 10, polygon: rect(0, -0.2, 30, 0)}, // south wall
    {id: 11, polygon: rect(0, 2, 19.55, 2.2)}, // north wall, west of the door
    {id: 12, polygon: rect(20.45, 2, 30, 2.2)}, // north wall, east of the door
  ],
  doors: [{id: 20, line: [toLL([19.55, 2.1]), toLL([20.45, 2.1])]}],
  rooms: [], outlines: outline, labels: [], lifts: [],
  stairs: [{id: 30, polygon: rect(26, 0, 30, 2)}],
}
const upstairs = {walls: [], doors: [], rooms: [], outlines: outline, labels: [], lifts: [], stairs: [{id: 31, polygon: rect(26, 0, 30, 2)}]}

describe('the fitted route (Step 2)', () => {
  it('walks the middle of a corridor and goes straight through the door centre', () => {
    // MazeMap's line hugs the south wall (0.2 m), then turns north through the door off-centre.
    const route = [ll(2, 0.2, 1), ll(19.8, 0.2, 1), ll(19.8, 5, 1)]
    const scene = buildScene({route, origin, floors: {1: corridor}})
    const fitted = fitRoute(scene)
    const check = checkFitted(scene, fitted)
    expect(check.crossings).toEqual([])
    expect(check.worstDoorOffsetM).toBeLessThanOrEqual(0.1)
    expect(check.minClearM).toBeGreaterThanOrEqual(0.4)
    // On the corridor's centre line (y = 1) halfway along.
    const i = fitted.points.findIndex((p) => p.x >= 10)
    const [a, b] = [fitted.points[i - 1], fitted.points[i]]
    expect(a.y + ((b.y - a.y) * (10 - a.x)) / (b.x - a.x)).toBeCloseTo(1, 1)
    // The turn into the door is at the junction: the centre line meets the door's axis (x = 20).
    const turn = fitted.points.filter((p) => p.corner)
    expect(Math.max(...turn.map((p) => p.x))).toBeGreaterThan(19.5)
  })

  it('never crosses a wall: a stretch through one is repaired through the nearest door', () => {
    // MazeMap cuts through the north wall 1.5 m east of the door.
    const route = [ll(10, 1, 1), ll(21.5, 1, 1), ll(21.5, 6, 1)]
    const scene = buildScene({route, origin, floors: {1: corridor}})
    const fitted = fitRoute(scene)
    expect(checkFitted(scene, fitted).crossings).toEqual([])
    expect(fitted.repairs.length + fitted.doors.length).toBeGreaterThan(0)
    expect(fitted.points.some((p) => Math.abs(p.x - 20) < 0.05 && Math.abs(p.y - 2.1) < 0.05)).toBe(true)
  })

  it('climbs the stair as a slope between the floor heights', () => {
    const route = [ll(10, 1, 1), ll(26.5, 1, 1), ll(29.5, 1, 1), ll(29.5, 1, 2), ll(27, 1, 2)]
    const scene = buildScene({route, origin, floors: {1: corridor, 2: upstairs}})
    const pts = fitRoute(scene).points
    const hs = pts.map((p) => p.h)
    expect(pts.some((p) => p.stair && p.h > 0 && p.h < 3.5)).toBe(true) // part way up the slope
    expect(hs.at(-1)).toBeCloseTo(3.5) // on the upper floor's plane
    for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9) // only up
    // The climb starts where the line enters the stair (x = 26), not before.
    const firstUp = pts.find((p) => p.h > 0.01)
    expect(firstUp.x).toBeGreaterThanOrEqual(26 - 0.01)
  })

  it('starts at the nearest walkable point, not at a node behind the user', () => {
    // From the user the line goes 8 m back west, then turns and comes past them going east.
    const pts = [{x: 0, y: 0, z: 0}, {x: -8, y: 0, z: 0}, {x: -8, y: 2, z: 0}, {x: 30, y: 2, z: 0}]
    const {points, savedM} = trimStartKink(pts, {crossesWall: () => false})
    expect(savedM).toBeGreaterThan(10)
    expect(points[1]).toMatchObject({x: 0, y: 2})
  })

  it('rounds a corner with a 1 m radius', () => {
    const out = roundCorners([{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}], 1)
    const arc = out.filter((p) => p.corner)
    expect(arc.length).toBeGreaterThan(2)
    for (const p of arc) expect(Math.hypot(p.x - 9, p.y - 1)).toBeCloseTo(1, 5) // on the 1 m circle
  })
})
