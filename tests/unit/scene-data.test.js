import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {decodeFloorTile} from '../../src/ar/mazemap-floor.js'
import {buildScene, createSegmentIndex, doorFrom, floorIndex, ringSegments} from '../../src/scene/scene-data.js'
import {fromLocal} from '../../src/geo/geo.js'

const origin = {lat: 56.1448, lng: -3.9205}
const ll = (x, y, z) => ({...fromLocal(origin, {x, y}), z})
const square = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => {
  const p = fromLocal(origin, {x, y})
  return [p.lng, p.lat]
})]
const lineLL = (a, b) => [a, b].map(([x, y]) => {
  const p = fromLocal(origin, {x, y})
  return [p.lng, p.lat]
})
// A corridor on level 1 with a wall to the north (gap 4-5 m: a door), a stair at its east end.
const floor1 = {
  walls: [{id: 1, polygon: square(0, 2, 4, 2.2)}, {id: 2, polygon: square(5, 2, 20, 2.2)}],
  doors: [{id: 9, line: lineLL([4, 2.1], [5, 2.1])}],
  rooms: [], outlines: [{id: 3, polygon: square(-1, -3, 21, 10)}], labels: [],
  stairs: [{id: 7, polygon: square(17, -2, 20, 1)}], lifts: [],
}
const floor2 = {walls: [{id: 4, polygon: square(0, 5, 20, 5.2)}], doors: [{id: 10, line: lineLL([8, 5.1], [9, 5.1])}], rooms: [], outlines: [{id: 5, polygon: square(-1, -3, 21, 10)}], labels: [], stairs: [{id: 8, polygon: square(17, -2, 20, 1)}], lifts: []}

describe('the navigation scene (Step 1)', () => {
  const route = [ll(-10, 0, 0), ll(0, 0, 1), ll(18, 0, 1), ll(19, 0, 2), ll(19, 4, 2)]
  const scene = buildScene({route, origin, floors: {1: floor1, 2: floor2}})

  it('only the floors the route uses, at heights counted from the entrance floor', () => {
    expect(scene.levels).toEqual([1, 2])
    expect(scene.floors[1].y).toBe(0)
    expect(scene.floors[2].y).toBeCloseTo(3.5)
    expect(scene.route3d.map((p) => p.h)).toEqual([0, 0, 0, 3.5, 3.5])
  })

  it('MazeMap has no level 0 indoors: -1 is one floor below 1', () => {
    expect(floorIndex(1) - floorIndex(-1)).toBe(1)
    expect(floorIndex(3) - floorIndex(1)).toBe(2)
  })

  it('doors have their real width and centre', () => {
    const d = scene.floors[1].doors[0]
    expect(d.width).toBeCloseTo(1, 1)
    expect(d.centre.x).toBeCloseTo(4.5, 1)
    expect(doorFrom({a: {x: 0, y: 0}, b: {x: 0, y: 2}}).lineDeg).toBe(0)
  })

  it('walls are segments with a spatial index; the gap at the door is open', () => {
    expect(scene.crossesWall(1, {x: 2, y: 0}, {x: 2, y: 4})).toBe(true) // through the wall
    expect(scene.crossesWall(1, {x: 4.5, y: 0}, {x: 4.5, y: 4})).toBe(false) // through the door
    expect(scene.nearestWall(1, {x: 10, y: 0}).d).toBeCloseTo(2, 1)
    expect(scene.doorsNear(1, {x: 4.5, y: 1}, 2)).toHaveLength(1)
  })

  it('the stair is a slope between the two floor heights, found from where the route climbs', () => {
    expect(scene.links).toHaveLength(1)
    expect(scene.links[0]).toMatchObject({kind: 'stairs', fromLevel: 1, toLevel: 2, up: true})
    expect(scene.links[0].slope.rise).toBeCloseTo(3.5)
    expect(scene.problems).toEqual([])
  })

  it('says exactly what is missing', () => {
    const bare = buildScene({route, origin, floors: {1: {...floor1, stairs: [], walls: []}}})
    const kinds = bare.problems.map((p) => p.kind)
    expect(kinds).toContain('no-floor') // level 2 not loaded
    expect(kinds).toContain('no-walls')
    expect(kinds).toContain('no-shaft')
  })

  it('reads a real Cottrell tile: walls are open at every door', () => {
    const buf = readFileSync('tests/fixtures/mazemap-tiles/2.0-18-128217-81440.mvt')
    const raw = decodeFloorTile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {x: 128217, y: 81440, z: 18})
    const o = {lat: raw.doors[0].line[0][1], lng: raw.doors[0].line[0][0]}
    const real = buildScene({route: [{...o, z: 2}, {lat: o.lat + 0.0001, lng: o.lng, z: 2}], origin: o, floors: {2: raw}})
    const f = real.floors[2]
    expect(f.doors.length).toBeGreaterThan(10)
    for (const d of f.doors) {
      // Straight through each door's centre, across its line: no wall in the way.
      const n = {x: -(d.b.y - d.a.y) / d.width * 0.3, y: (d.b.x - d.a.x) / d.width * 0.3}
      expect(real.crossesWall(2, {x: d.centre.x - n.x, y: d.centre.y - n.y}, {x: d.centre.x + n.x, y: d.centre.y + n.y})).toBe(false)
    }
  })

  it('the index finds the same walls as a full search', () => {
    const segs = ringSegments([[{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 0}]])
    const idx = createSegmentIndex(segs, 2)
    expect(idx.near({x: 5, y: 1}, 1.5).length).toBe(1)
    expect(idx.near({x: 9, y: 5}, 1.5).length).toBe(1)
  })
})
