// Alignment Phase 1, steps 2-3: doors near the user, and the heading from the door's wall.
import {describe, expect, it} from 'vitest'
import network from '../../src/data/campus-network.json'
import fixture from '../fixtures/route-library-a3.json'
import {angleDiff, fromLocal, localBearing, toLocal} from '../../src/geo/geo.js'
import {
  classifyDoor,
  doorLabel,
  doorStartPoint,
  mapHeadingStart,
  doorwaySides,
  exteriorDoors,
  facingForRoute,
  rankDoors,
  resolveDoorHeading,
} from '../../src/route/door-start.js'
import {buildingAt, buildingShapes, doorsNear} from '../../src/map/door-data.js'
import {isManual, standHereText} from '../../src/route/start-point.js'

// A 20 m square building centred on (0, 0): walls at x = ±10 and y = ±10.
const square = {id: 1, name: 'Test Building', rings: [[{x: -10, y: -10}, {x: 10, y: -10}, {x: 10, y: 10}, {x: -10, y: 10}, {x: -10, y: -10}]]}
// The same square turned 45°: its walls face north-east, south-east, south-west and north-west.
const r = 10 * Math.SQRT2
const diamond = {id: 2, name: 'Diamond', rings: [[{x: 0, y: r}, {x: r, y: 0}, {x: 0, y: -r}, {x: -r, y: 0}, {x: 0, y: r}]]}
const door = (a, b, extra = {}) => ({id: 'd', level: 1, a, b, ...extra})
const near = (deg, want, tol = 0.01) => expect(Math.abs(angleDiff(deg, want))).toBeLessThan(tol)

describe('the heading from the door wall', () => {
  it.each([
    ['north wall: facing inside is south', door({x: -0.5, y: 10}, {x: 0.5, y: 10}), 180],
    ['east wall: facing inside is west', door({x: 10, y: -0.5}, {x: 10, y: 0.5}), 270],
    ['south wall: facing inside is north', door({x: -0.5, y: -10}, {x: 0.5, y: -10}), 0],
    ['west wall: facing inside is east', door({x: -10, y: -0.5}, {x: -10, y: 0.5}), 90],
  ])('%s', (_, d, inward) => {
    const c = classifyDoor(d, [square])
    expect(c).not.toBeNull()
    near(c.inwardDeg, inward)
    // A door line drawn the other way round is the same doorway.
    near(classifyDoor({...d, a: d.b, b: d.a}, [square]).inwardDeg, inward)
  })

  it('a diagonal wall: the north-east face of a turned building, facing inside is south-west', () => {
    const mid = {x: r / 2, y: r / 2}
    const c = classifyDoor(door({x: mid.x - 0.4, y: mid.y + 0.4}, {x: mid.x + 0.4, y: mid.y - 0.4}), [diamond])
    near(c.inwardDeg, 225)
  })

  it('a door line drawn a few degrees off the wall takes the wall (the outline) direction', () => {
    const c = classifyDoor(door({x: -0.5, y: 9.97}, {x: 0.5, y: 10.03}), [square]) // ~3.4° off
    near(c.inwardDeg, 180)
  })

  it('inside vs outside: facing comes from where the route goes from the doorway', () => {
    const inward = classifyDoor(door({x: -0.5, y: 10}, {x: 0.5, y: 10}), [square]).inwardDeg // 180
    const intoCorridor = [{x: 0, y: 10}, {x: 0, y: 6}, {x: -4, y: 6}]
    const outToPath = [{x: 0, y: 10}, {x: 0, y: 14}, {x: 6, y: 18}]
    expect(facingForRoute(inward, intoCorridor)).toEqual({facing: 'inside', headingDeg: 180})
    expect(facingForRoute(inward, outToPath)).toEqual({facing: 'outside', headingDeg: 0})
    // A route that goes out and straight along the facade still leans out: facing outside.
    expect(facingForRoute(inward, [{x: 0, y: 10}, {x: 0, y: 10.5}, {x: 8, y: 10.6}]).facing).toBe('outside')
    expect(resolveDoorHeading({inwardDeg: inward, recessM: 0}, intoCorridor)).toMatchObject({facing: 'inside', headingDeg: 180, source: 'wall'})
  })
})

describe('which door lines are exterior doors', () => {
  it('a corridor door inside the building is not', () => {
    expect(classifyDoor(door({x: -0.5, y: 0}, {x: 0.5, y: 0}), [square])).toBeNull()
  })

  it('a door set back 2 m (under a canopy) counts only at a known entrance, and only parallel to the wall', () => {
    const recessed = door({x: -0.5, y: 8}, {x: 0.5, y: 8})
    expect(classifyDoor(recessed, [square])).toBeNull()
    const known = classifyDoor(recessed, [square], undefined, {allowRecessed: true})
    near(known.inwardDeg, 180)
    expect(known.recessM).toBeCloseTo(2, 5)
    expect(classifyDoor(door({x: 0, y: 7.5}, {x: 0, y: 8.5}), [square], undefined, {allowRecessed: true})).toBeNull() // at right angles
  })

  it('double doors and a lobby are one doorway: the outer door stands for it', () => {
    const lines = [door({x: -1.2, y: 10}, {x: -0.2, y: 10}), door({x: 0.2, y: 10}, {x: 1.2, y: 10}), door({x: -0.5, y: 8}, {x: 0.5, y: 8})]
    const doors = exteriorDoors(lines, [square], undefined, {entrances: [{x: 0, y: 10}]})
    expect(doors).toHaveLength(1)
    expect(doors[0].recessM).toBe(0)
  })
})

describe('ranking the doors near the user', () => {
  const doors = [
    {id: 'far', x: 60, y: 0},
    {id: 'near', x: 3, y: 4},
    {id: 'mid', x: 0, y: -20},
    {id: 'next', x: -10, y: 0},
  ]
  it('the 3 nearest, nearest first, each with its distance', () => {
    const ranked = rankDoors(doors, {x: 0, y: 0})
    expect(ranked.map((d) => d.id)).toEqual(['near', 'next', 'mid'])
    expect(ranked[0].d).toBe(5)
  })
  it('nothing to rank without a position', () => {
    expect(rankDoors(doors, null)).toEqual([])
  })
})

describe('door start', () => {
  it('plans from just inside and just outside the doorway', () => {
    const {inside, outside} = doorwaySides({x: 0, y: 10, inwardDeg: 180}, 0.5)
    expect(inside.y).toBeCloseTo(9.5, 6)
    expect(outside.y).toBeCloseTo(10.5, 6)
  })

  it('is a manual start that says where to stand and which way to face', () => {
    const start = doorStartPoint({id: 7, level: 1, inwardDeg: 180, buildingName: 'Cottrell Building', name: 'A3 entrance'}, {lat: 56.1449, lng: -3.9203}, {facing: 'inside', headingDeg: 180})
    expect(isManual(start)).toBe(true)
    expect(start).toMatchObject({type: 'door', floor: 1, headingDeg: 180, doorFacing: 'inside'})
    expect(standHereText(start)).toBe('Stand in the doorway, facing inside.')
    expect(standHereText({...start, doorFacing: 'outside'})).toBe('Stand in the doorway, facing outside.')
  })

  it('labels a door by its building and side, with a rounded distance', () => {
    expect(doorLabel({buildingName: 'Cottrell Building', inwardDeg: 180, d: 23, level: 1})).toEqual({title: 'Cottrell, north door', detail: 'about 25 m · Level 1'})
    expect(doorLabel({buildingName: 'Cottrell Building', name: 'main entrance', inwardDeg: 270, d: 4})).toEqual({title: 'Cottrell main entrance', detail: 'East side · about 5 m'})
    // Two named doors on one building read differently: each is named for its place.
    const a = doorLabel({buildingName: 'Andrew Miller Building', name: 'main entrance', places: ['Library'], inwardDeg: 180, d: 30})
    const b = doorLabel({buildingName: 'Andrew Miller Building', name: 'main entrance', places: ['Scran'], inwardDeg: 180, d: 40})
    expect(a.title).toBe('Library main entrance')
    expect(b.title).not.toBe(a.title)
    // No wall line: no side is made up.
    expect(doorLabel({buildingName: 'Cottrell Building', name: 'main entrance', places: ['Cottrell Building'], inwardDeg: null, d: 30})).toEqual({title: 'Cottrell main entrance', detail: 'about 30 m'})
  })

  it('a known entrance with no usable wall: the route through it gives the heading, never the compass', () => {
    const route = [{x: 0, y: 0}, {x: 3, y: 3}, {x: 6, y: 6}]
    expect(resolveDoorHeading({inwardDeg: null}, route, {goesIn: true})).toMatchObject({facing: 'inside', headingDeg: 45, source: 'route'})
    // A recessed door whose wall disagrees with the route by more than 60°: the wrong door line.
    expect(resolveDoorHeading({inwardDeg: 135, recessM: 2}, route, {goesIn: true})).toMatchObject({headingDeg: 45, source: 'route'})
    // On the outline the wall wins, even with the route turning at once.
    expect(resolveDoorHeading({inwardDeg: 135, recessM: 0}, route).source).toBe('wall')
  })
})

describe('door data from MazeMap (door-data.js)', () => {
  const origin = {lat: 56.145, lng: -3.92}
  const ll = (x, y) => {
    const p = fromLocal(origin, {x, y})
    return [p.lng, p.lat]
  }
  // A building with a courtyard (its second ring).
  const records = [
    {
      id: 11,
      name: 'Test Building',
      fullOutline: {type: 'Polygon', coordinates: [[ll(-10, -10), ll(10, -10), ll(10, 10), ll(-10, 10), ll(-10, -10)], [ll(-3, -3), ll(3, -3), ll(3, 3), ll(-3, 3), ll(-3, -3)]]},
      floors: [{z: 1}, {z: 2}],
    },
  ]
  const shapes = buildingShapes(records)

  it('says which building a fix is in, and not in its courtyard', () => {
    expect(buildingAt(fromLocal(origin, {x: 6, y: 6}), shapes)?.id).toBe(11)
    expect(buildingAt(fromLocal(origin, {x: 0, y: 0}), shapes)).toBeNull()
    expect(buildingAt(fromLocal(origin, {x: 30, y: 0}), shapes)).toBeNull()
  })

  it('finds the exterior doors on every floor, names a known entrance, and keeps one without a wall', async () => {
    const floors = {
      1: [[ll(-0.5, 10), ll(0.5, 10)], [ll(-0.5, -6), ll(0.5, -6)]], // the north door, and a corridor door (not exterior)
      2: [[ll(10, -0.5), ll(10, 0.5)]], // east door, upstairs (a hillside entrance)
    }
    const loadFloor = async (level) => ({level, doors: (floors[level] || []).map((line, i) => ({id: `${level}-${i}`, line}))})
    const here = fromLocal(origin, {x: 0, y: 25})
    const entrances = [
      {...fromLocal(origin, {x: 0.5, y: 10.5}), name: 'main entrance', places: ['Test']},
      {...fromLocal(origin, {x: -10, y: 8}), name: 'side entrance', places: ['Test']},
    ]
    const doors = await doorsNear(here, {shapes, loadFloor, entrances})
    expect(doors.filter((d) => d.level === 1)).toHaveLength(1) // the north door; the corridor door is not exterior
    const north = doors.find((d) => d.level === 1)
    expect(north.name).toBe('main entrance')
    near(north.inwardDeg, 180, 0.5)
    expect(doors.find((d) => d.level === 2).inwardDeg).toBeCloseTo(270, 0)
    expect(doors.find((d) => d.name === 'side entrance')).toMatchObject({inwardDeg: null, buildingName: 'Test Building'})
    expect(rankDoors(doors, {x: 0, y: 0})[0].name).toBe('main entrance')
  })

  it('no outlines (MazeMap unreachable): no doors, so the picker offers the map only', async () => {
    expect(await doorsNear({lat: 56.145, lng: -3.92}, {shapes: []})).toEqual([])
  })
})

describe('on the real Cottrell Building (MazeMap geometry in campus-network.json)', () => {
  const outline = network.areas.blocked.filter((a) => a.kind === 'building' && a.source === 'mazemap')
  const buildings = outline.map((b) => ({id: 1009833, name: 'Cottrell Building', rings: b.polygon.map((ring) => ring.map(([x, y]) => ({x, y})))}))
  const lines = network.doorLines.map((d, i) => ({id: i, level: d.z, exterior: d.exterior, a: {x: d.a[0], y: d.a[1]}, b: {x: d.b[0], y: d.b[1]}}))

  it('finds the same exterior doors as the network generator, and no others', () => {
    const found = lines.filter((l) => classifyDoor(l, buildings))
    expect(found.filter((l) => !l.exterior)).toHaveLength(0)
    expect(found.filter((l) => l.exterior).length).toBeGreaterThanOrEqual(44) // of the generator's 45
  })

  it("the A3 entrance's wall heading matches MazeMap's own route in through that door, within 2°", () => {
    const pts = [...fixture.route.points, ...fixture.route.indoorPoints.slice(1)].map((p) => toLocal(network.origin, p))
    const at = fixture.route.points.length - 1 // MazeMap's door point
    const away = (list) => list.find((p) => Math.hypot(p.x - pts[at].x, p.y - pts[at].y) > 2)
    const routeIn = localBearing(away(pts.slice(0, at).reverse()), away(pts.slice(at + 1)))
    const doors = exteriorDoors(lines, buildings)
    const a3 = rankDoors(doors.filter((d) => d.level === 1), pts[at], 1)[0]
    expect(a3.d).toBeLessThan(2)
    expect(Math.abs(angleDiff(routeIn, a3.inwardDeg))).toBeLessThan(2)
  })
})

describe('item 20: room and pin starts take their heading from the map', () => {
  // A room 4 m square around (0, 0); its door is a 1 m line in one wall; the route leaves through it.
  const cases = [
    ['north wall, leaving north', {a: {x: -0.5, y: 2}, b: {x: 0.5, y: 2}}, [{x: 0, y: 0}, {x: 0, y: 2}, {x: 0, y: 8}], 0],
    ['east wall, leaving east', {a: {x: 2, y: -0.5}, b: {x: 2, y: 0.5}}, [{x: 0, y: 0}, {x: 2, y: 0}, {x: 8, y: 0}], 90],
    ['south wall, leaving south', {a: {x: 0.5, y: -2}, b: {x: -0.5, y: -2}}, [{x: 0, y: 0}, {x: 0, y: -8}], 180],
    ['west wall, leaving west', {a: {x: -2, y: 0.5}, b: {x: -2, y: -0.5}}, [{x: 0, y: 0}, {x: -8, y: 0}], 270],
    ['a diagonal wall, leaving north-east, walked in at a slant', {a: {x: 1.0, y: 2.0}, b: {x: 2.0, y: 1.0}}, [{x: 0, y: 0}, {x: 1.2, y: 1.8}, {x: 6, y: 6}], 45],
  ]
  it.each(cases)('%s: the wall normal the route walks through, at the doorway', (_, door, route, want) => {
    const h = mapHeadingStart(route, [door])
    expect(h.source).toBe('wall')
    near(h.headingDeg, want, 0.01)
    expect(Math.hypot(h.at.x, h.at.y)).toBeGreaterThan(1) // in the doorway, not the room's middle
  })

  it('no door on the route near the start (a pin in the open): the route\'s first metres', () => {
    const h = mapHeadingStart([{x: 0, y: 0}, {x: 3, y: 3}, {x: 6, y: 6}], [])
    expect(h).toMatchObject({source: 'route', s: 0})
    near(h.headingDeg, 45, 0.01)
  })

  it('a door further down the route than roomDoorM is not the room\'s door', () => {
    const far = {a: {x: -0.5, y: 30}, b: {x: 0.5, y: 30}}
    expect(mapHeadingStart([{x: 0, y: 0}, {x: 0, y: 40}], [far]).source).toBe('route')
  })

  it('says where to stand and which way to face', () => {
    expect(standHereText({type: 'place', name: 'A3 Lecture Theatre', entranceName: null, doorFacing: 'out of the room'})).toBe('Stand in the doorway, facing out of the room.')
    expect(standHereText({type: 'map', name: 'Pin on the map', faceRoute: true})).toBe('Stand where you put the pin, facing the way the route starts on the map.')
    expect(standHereText({type: 'place', name: 'A3 Lecture Theatre', entranceName: null, faceRoute: true})).toMatch(/A3 Lecture Theatre, facing the way the route starts on the map\.$/)
  })
})
