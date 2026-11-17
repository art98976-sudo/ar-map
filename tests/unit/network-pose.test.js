// Part C: the map-constrained pose (src/ar/network-pose.js) and the simulated pilot walk
// (src/map/network-sim.js).
import {describe, expect, it} from 'vitest'
import net from '../../src/data/campus-network.json'
import {createNetworkPose, wallTesterFrom} from '../../src/ar/network-pose.js'
import {simulateNetworkWalk} from '../../src/map/network-sim.js'
import {buildingAt, routeOnNetwork} from '../../src/route/network-router.js'

// A small route: 20 m outdoors north, a door, a corridor north then east, stairs up, on to a room.
const ROUTE = [
  {x: 0, y: 0, z: 0, edgeType: 'start'},
  {x: 0, y: 20, z: 0, edgeType: 'outdoor'},
  {x: 0, y: 21, z: 1, edgeType: 'door'},
  {x: 0, y: 30, z: 1, edgeType: 'corridor'},
  {x: 10, y: 30, z: 1, edgeType: 'corridor'},
  {x: 10, y: 31, z: 2, edgeType: 'stairs'},
  {x: 10, y: 40, z: 2, edgeType: 'corridor'},
]
const HEIGHTS = {1: 0, 2: 3.5}
// A wall 0.6 m east of the corridor on level 1, beside y 22-29.
const WALL = [{x: 0.6, y: 22}, {x: 0.6, y: 29}]
function crossesWall(z, a, b) {
  if (z !== 1) return false
  const [p, q] = WALL
  const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x)
  if (Math.abs(d) < 1e-12) return false
  const t = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d
  const u = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}
const insideBuilding = (p) => p.y > 20.5
const rot = (x, y, deg) => {
  const r = (deg * Math.PI) / 180
  return {dx: x * Math.cos(r) + y * Math.sin(r), dy: -x * Math.sin(r) + y * Math.cos(r)}
}
const walk = (pose, metres, dirX, dirY, {errDeg = 0, dh = 0} = {}) => {
  for (let m = 0; m < metres; m += 0.25) pose.move({...rot(dirX * 0.25, dirY * 0.25, errDeg), dh})
  return pose.current
}
const fresh = () => createNetworkPose({points: ROUTE, crossesWall, insideBuilding, floorHeights: HEIGHTS})

describe('network pose', () => {
  it('starts from GPS only outdoors and when GPS is good', () => {
    expect(fresh().start({x: 0, y: 1, accuracyM: 30})).toBe(false)
    expect(fresh().start({x: 0, y: 25, accuracyM: 5})).toBe(false) // inside the building
    expect(fresh().start({x: 0, y: 25, z: 1, manual: true})).toBe(true) // a picked start indoors
    const p = fresh()
    expect(p.start({x: 0.4, y: 1, accuracyM: 8})).toBe(true)
    expect(p.current.s).toBeCloseTo(1, 1)
  })

  it('snaps to the route: a sideways drift is held within the corridor', () => {
    const p = fresh()
    p.start({x: 0, y: 0, accuracyM: 5})
    const c = walk(p, 10, 0.5, 1) // walking north but drifting east: 5 m east after 10 m
    expect(Math.abs(c.lateralM)).toBeLessThanOrEqual(2) // outdoors at most 2 m to the side
    expect(c.x).toBeLessThanOrEqual(2)
    expect(c.s).toBeGreaterThan(9)
  })

  it('never puts the pose behind a wall', () => {
    const p = fresh()
    p.start({x: 0, y: 24, z: 1, manual: true})
    const c = walk(p, 2, 1, 0.2) // pushes east, towards the wall 0.6 m away
    expect(c.z).toBe(1)
    expect(c.x).toBeLessThan(0.6)
    expect(crossesWall(1, {x: 0, y: c.y}, c)).toBe(false)
  })

  it('locks the heading to the route after straight walking, removing a 20° compass error', () => {
    const p = fresh()
    p.start({x: 0, y: 0, accuracyM: 5})
    p.compass(20)
    walk(p, 3, 0, 1, {errDeg: 20})
    expect(p.current.headingLocked).toBe(false)
    const c = walk(p, 4, 0, 1, {errDeg: 20})
    expect(c.headingLocked).toBe(true)
    expect(c.yawFixDeg).toBeCloseTo(-20, 0)
  })

  it('anchors at the door and at a turn that matches the route', () => {
    const p = fresh()
    p.start({x: 0, y: 0, accuracyM: 5})
    walk(p, 21.2, 0, 1)
    expect(p.current.lastAnchor.kind).toBe('door')
    expect(p.current.z).toBe(1)
    walk(p, 9, 0, 1)
    const c = walk(p, 3, 1, 0) // the right turn at (0, 30)
    expect(c.lastAnchor.kind).toBe('turn')
    expect(c.sinceAnchorM).toBeLessThan(3)
  })

  it('switches floor only when the height change is within 30% of the floor height', () => {
    const p = fresh()
    p.start({x: 0, y: 30, z: 1, manual: true})
    walk(p, 10, 1, 0)
    walk(p, 3, 1, 0) // at the stairs, no climb: held on level 1, never past the stairs
    expect(p.current.z).toBe(1)
    expect(p.current.s).toBeLessThanOrEqual(p.model.floorChanges[0].sBottom + 0.01)
    for (let i = 0; i < 10; i++) p.move({dx: 0, dy: 0.05, dh: 0.1}) // 1.0 m: too little
    expect(p.current.z).toBe(1)
    for (let i = 0; i < 20; i++) p.move({dx: 0, dy: 0.05, dh: 0.1}) // 3.0 m in all: within 30% of 3.5
    expect(p.current.z).toBe(2)
    expect(p.current.lastAnchor.kind).toBe('stairs')
  })

  it('ignores GPS inside a building, and GPS jumps outdoors', () => {
    const p = fresh()
    p.start({x: 0, y: 25, z: 1, manual: true})
    expect(p.gps({x: 30, y: 25, accuracyM: 8})).toBe(false)
    const q = fresh()
    q.start({x: 0, y: 2, accuracyM: 5})
    expect(q.gps({x: 0, y: 3, accuracyM: 6})).toBe(true)
    expect(q.gps({x: 25, y: 3, accuracyM: 6})).toBe(false) // 25 m off the route
  })

  it('confidence falls with poor tracking, walking without anchors, and distance off the route', () => {
    const p = fresh()
    p.start({x: 0, y: 0, accuracyM: 5})
    walk(p, 6, 0, 1)
    const locked = p.current.confidence
    expect(locked).toBeGreaterThan(0.8)
    p.setTracking('LIMITED')
    expect(p.current.confidence).toBeLessThan(locked * 0.5)
    p.setTracking('NORMAL')
    const far = fresh()
    far.start({x: 0, y: 30, z: 1, manual: true})
    for (let i = 0; i < 300; i++) far.move({dx: 0, dy: 0, dh: 0}) // standing: no anchors needed
    expect(far.current.confidence).toBeGreaterThan(0)
  })
})

describe('Gate C: the pilot route, simulated with drift, GPS jumps and a compass error', () => {
  const crosses = wallTesterFrom(net)
  const inside = (p) => buildingAt(net, p) != null
  const heights = Object.values(net.floors)[0].levels
  const START = {lat: 56.148174267358, lng: -3.9257070226467197}
  const A3 = {lat: 56.144797627811215, lng: -3.9205121464987616, floor: 2, poiId: 1002085033}

  for (const stepFree of [false, true]) {
    for (const seed of [1, 2, 3]) {
      it(`${stepFree ? 'step-free (lift)' : 'stairs'} route, seed ${seed}: correct corridor and floor, never behind a wall`, () => {
        const route = routeOnNetwork(net, START, A3, {stepFree})
        const m = simulateNetworkWalk({points: route.points, crossesWall: crosses, insideBuilding: inside, floorHeights: heights, seed, compassErrorDeg: 25, driftPer20M: 2, gpsJumpM: 30})
        const indoor = m.trace.filter((t) => t.truth.z !== 0)
        expect(m.maxLateralM).toBeLessThanOrEqual(2)
        expect(Math.max(...indoor.map((t) => t.lateralM))).toBeLessThanOrEqual(1.25)
        expect(Math.max(...indoor.map((t) => t.posM))).toBeLessThanOrEqual(3)
        expect(m.floorMismatches).toBe(0)
        expect(m.wallCrossings).toBe(0)
        expect(m.finalFloor).toBe(2)
        expect(m.finalAlongErrorM).toBeLessThanOrEqual(1)
        expect(m.headingLocked).toBe(true)
      })
    }
  }
})
