import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {describe, expect, it} from 'vitest'
import {buildShellMeshes, doorCrossings, floorToLocal, insideRing, segmentCross, wallCrossings, wallsNear} from '../../src/ar/building-shell.js'
import {boxAround, decodeFloorTile, fetchFloor, levelPath, mergeFloor, tileOf, tilesFor, tileUrl} from '../../src/ar/mazemap-floor.js'

// A real MazeMap floor tile: Cottrell Building, level 2, zoom 18 (recorded, so no network).
const TILE = {x: 128217, y: 81440, z: 18}
const tileBuffer = () => readFileSync(resolve(process.cwd(), 'tests/fixtures/mazemap-tiles/2.0-18-128217-81440.mvt'))
const ORIGIN = {lat: 56.1448, lng: -3.9205}

describe('MazeMap floor tiles', () => {
  it('finds the tiles for a box and builds their address per floor level', () => {
    expect(tileOf(-3.9205, 56.1448, 18)).toEqual({x: 128217, y: 81440})
    expect(levelPath(2)).toBe('2.0')
    expect(tileUrl(2, TILE)).toBe('https://tiles.mazemap.com/all/latest/2.0/18/128217/81440.mvt?version=2')
    const tiles = tilesFor(boxAround(ORIGIN, 45))
    expect(tiles.length).toBeGreaterThanOrEqual(1)
    expect(tiles.length).toBeLessThanOrEqual(9)
  })

  it('reads walls (polygons), doors (lines a door wide) and room labels from a real tile', () => {
    const floor = decodeFloorTile(tileBuffer(), TILE)
    expect(floor.walls.length).toBeGreaterThan(3)
    expect(floor.doors.length).toBeGreaterThan(5)
    expect(floor.rooms.length).toBeGreaterThan(5)
    const local = floorToLocal({level: 2, ...mergeFloor([floor])}, ORIGIN)
    const widths = local.doors.map((d) => Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))
    expect(widths.filter((w) => w > 0.5 && w < 3).length).toBeGreaterThan(widths.length / 2) // door-sized
    expect(local.labels.length).toBeGreaterThan(0)
  })

  it('fetches a floor over a box, treating missing tiles as empty', async () => {
    const fetchImpl = async (url) => (url.includes('/128217/81440') ? {ok: true, arrayBuffer: async () => tileBuffer()} : {ok: false, status: 404})
    const floor = await fetchFloor(2, boxAround(ORIGIN, 20), {fetchImpl})
    expect(floor.level).toBe(2)
    expect(floor.walls.length).toBeGreaterThan(3)
  })
})

// A small made-up floor: one room 10 x 6 m with walls 0.2 m thick and a 1 m door in its south wall.
const box = (x0, y0, x1, y1) => [[{x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1}, {x: x0, y: y0}]]
const FLOOR = {
  level: 1,
  walls: [
    {id: 1, polygon: box(0, -0.1, 4.5, 0.1)}, // south wall, west of the door
    {id: 2, polygon: box(5.5, -0.1, 10, 0.1)}, // south wall, east of the door
    {id: 3, polygon: box(0, 5.9, 10, 6.1)}, // north wall
  ],
  doors: [{id: 9, a: {x: 4.5, y: 0}, b: {x: 5.5, y: 0}}],
  rooms: [{id: 7, polygon: box(0, 0, 10, 6)}],
  outlines: [],
  labels: [{text: '2B87', x: 5, y: 3}],
}

describe('the building shell', () => {
  it('finds the doors the route walks through, at their real width', () => {
    const route = [{x: 5, y: -5}, {x: 5, y: 3}]
    const doors = doorCrossings(route, FLOOR.doors)
    expect(doors).toHaveLength(1)
    expect(doors[0].s).toBeCloseTo(5, 6)
    expect(doors[0].widthM).toBeCloseTo(1, 6)
  })

  it('?debug=walls: a route through a wall away from any door is listed, with the room', () => {
    const throughWall = [{x: 2, y: -5}, {x: 2, y: 3}] // through the south wall, 2.5 m from the door
    const crossings = wallCrossings(throughWall, FLOOR)
    expect(crossings).toHaveLength(1)
    expect(crossings[0].rooms).toContain('2B87')
    const throughDoor = [{x: 5, y: -5}, {x: 5, y: 3}]
    expect(wallCrossings(throughDoor, FLOOR)).toEqual([])
  })

  it('builds an invisible occluder 2.7 m tall, a wireframe and wall base lines', () => {
    const shell = buildShellMeshes(THREE, mergeGeometries, FLOOR)
    expect(shell.occluder.material.colorWrite).toBe(false)
    expect(shell.occluder.material.depthWrite).toBe(true)
    shell.occluder.geometry.computeBoundingBox()
    const bb = shell.occluder.geometry.boundingBox
    expect(bb.min.y).toBeCloseTo(0, 6)
    expect(bb.max.y).toBeCloseTo(2.7, 6)
    expect(bb.max.z).toBeCloseTo(0.1, 6) // north is -z: the south wall sits at z = -y = 0.1
    expect(shell.wire.geometry.attributes.position.count).toBeGreaterThan(0)
    expect(shell.baseLines.geometry.attributes.position.count).toBeGreaterThan(0)
    shell.dispose()
  })

  it('keeps only nearby walls when asked (line-up lines, low frame rate)', () => {
    expect(wallsNear(FLOOR, {x: 1, y: 0}, 2).map((w) => w.id)).toEqual([1])
    expect(insideRing({x: 5, y: 3}, FLOOR.rooms[0].polygon[0])).toBe(true)
    expect(segmentCross({x: 0, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 1, y: 0})).toMatchObject({x: 0.5, y: 0.5})
  })
})
