// Phases 4 and 5: floor changes from SLAM's height (floor-change.js), the wall rules' fixes found on
// the way (corridor-guard.js), and staying inside the building (route.js, door-start.js).
import {describe, expect, it} from 'vitest'
import {createFloorWatch, routeFloorLinks} from '../../src/ar/floor-change.js'
import {createCorridorGuard, nearestCorridorPoint, wallRules} from '../../src/ar/corridor-guard.js'
import {leavesAfterEntering} from '../../src/route/route.js'
import {pickDoorRoute} from '../../src/route/door-start.js'
import {fromLocal} from '../../src/geo/geo.js'
import {FLOOR_CHANGE} from '../../src/config.js'

const O = {lat: 56.145, lng: -3.92}
const at = (x, y, z, extra = {}) => ({...fromLocal(O, {x, y}), z, ...extra})

// 10 m east on level 1, a stair core up to 2 (no run), 10 m back west on 2, a lift from 2 to 4.
const route = [at(0, 0, 1, {h: 0}), at(10, 0, 1, {h: 0}), at(10, 0.2, 2, {h: 3.5, edgeType: 'stairs'}), at(0, 0.2, 2, {h: 3.5}), at(0, 0.4, 4, {h: 10.5, edgeType: 'lift'}), at(5, 0.4, 4, {h: 10.5})]

describe('the route floor changes', () => {
  it('finds each stair and lift, its levels, its rise and its landing', () => {
    const links = routeFloorLinks(route, O)
    expect(links.map((l) => [l.fromLevel, l.toLevel, l.kind, l.riseM])).toEqual([
      [1, 2, 'stairs', 3.5],
      [2, 4, 'lift', 7],
    ])
    expect(links[0].top.x).toBeCloseTo(10, 3)
    expect(links[1].sTop).toBeGreaterThan(links[1].s)
  })
})

describe('the floor watch', () => {
  const links = routeFloorLinks(route, O)
  const atStair = {x: 10, y: 0}

  it('changes floor at a climb of 2.5 m near the stair, and says where the landing is', () => {
    const w = createFloorWatch(links, {level: 1, camY: 1.5})
    expect(w.update({camY: 1.5 + 2.4, here: atStair}).switched).toBeNull()
    const r = w.update({camY: 1.5 + FLOOR_CHANGE.minRiseM, here: atStair})
    expect(r.switched).toMatchObject({from: 1, to: 2})
    expect(r.switched.landing.x).toBeCloseTo(10, 3)
    expect(w.level).toBe(2)
  })

  it('not far from any stair or lift (SLAM height drift on a long corridor)', () => {
    const w = createFloorWatch(links, {level: 1, camY: 1.5})
    expect(w.update({camY: 4.5, here: {x: 40, y: 30}, s: 60}).switched).toBeNull()
    expect(w.level).toBe(1)
  })

  it('not the wrong way: dropping 3 m at an up stair on the lowest floor of the route', () => {
    const w = createFloorWatch(links, {level: 1, camY: 1.5})
    expect(w.update({camY: -1.5, here: atStair}).switched).toBeNull()
  })

  it('a two-floor lift waits for most of its 7 m, then lands on the right floor', () => {
    const w = createFloorWatch(links, {level: 2, camY: 5})
    const lift = {x: 0, y: 0.3}
    expect(w.update({camY: 5 + 3, here: lift}).switched).toBeNull() // 3 m: past 2.5, under 70% of 7
    expect(w.update({camY: 5 + 5, here: lift}).switched).toMatchObject({from: 2, to: 4})
  })

  it('walking back down the same stair', () => {
    const w = createFloorWatch(links, {level: 2, camY: 5})
    expect(w.update({camY: 5 - 3, here: atStair}).switched).toMatchObject({from: 2, to: 1})
  })

  it('between floors the wall rules wait; through a door the floor follows the route', () => {
    const w = createFloorWatch(links, {level: 1, camY: 1.5})
    expect(w.update({camY: 1.5 + 1, here: atStair}).inTransit).toBe(true)
    const out = createFloorWatch(links, {level: 0, camY: 1.5})
    out.update({camY: 1.5, routeLevel: 1})
    expect(out.level).toBe(1)
  })
})

describe('the wall rules on several floors', () => {
  // A corridor along y = 0 with a wall at y = 1, a door gap at x = 5 (door line 4.6-5.4).
  const wall = (x0, x1) => ({id: `${x0}`, polygon: [[{x: x0, y: 1}, {x: x1, y: 1}, {x: x1, y: 1.1}, {x: x0, y: 1.1}, {x: x0, y: 1}]]})
  const floor = {walls: [wall(-10, 4.6), wall(5.4, 20)], doors: [{a: {x: 4.6, y: 1.05}, b: {x: 5.4, y: 1.05}}]}
  const rules = wallRules(floor)

  it('standing on a wall line is not going through it (an anchor can put the user there)', () => {
    expect(rules.crosses({x: 2, y: 1}, {x: 2, y: 0.5})).toBeNull()
    expect(rules.crosses({x: 2, y: 0.5}, {x: 2, y: 1.5})).not.toBeNull()
  })

  it('a walk through the wall just beside a doorway the route goes through is that doorway, not the wall', () => {
    // The route turns through the door; SLAM puts the walker 0.8 m to the side of the door line.
    const through = [{x: 0, y: 0}, {x: 5, y: 0}, {x: 5, y: 5}]
    const g = createCorridorGuard(through)
    g.setFloor(floor)
    const cam = (x, y) => ({x, z: -y})
    const toRoute = ({x, z}) => ({x, y: -z})
    g.step({cam: cam(4, 0.6), toRoute, s: 4})
    expect(g.step({cam: cam(4, 1.6), toRoute, s: 6}).snap).toBeNull() // 0.6 m beside the door line
    // Well away from any opening it is the wall: put back in the corridor.
    const h = createCorridorGuard(through)
    h.setFloor(floor)
    h.step({cam: cam(1.5, 0.6), toRoute, s: 1.5})
    expect(h.step({cam: cam(1.5, 1.6), toRoute, s: 1.5}).snap).not.toBeNull()
  })

  it('a corridor point is only one on the user\'s floor (a route passing over itself)', () => {
    // Along x on floor 1 (s 0-10), then back over the same line on floor 2 (s 10-20).
    const line = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 0.01}, {x: 0, y: 0.01}]
    const onFloor1 = (s) => s <= 10
    const p = {x: 3, y: 0}
    expect(nearestCorridorPoint(line, null, p, p, 3, {onFloor: onFloor1}).s).toBeCloseTo(3, 0)
    expect(nearestCorridorPoint(line, null, p, p, 3, {onFloor: (s) => s > 10.01})?.s ?? 99).toBeGreaterThan(10)
  })
})

describe('staying inside the building', () => {
  const inThenOut = [{z: 0}, {z: 1}, {z: 1}, {z: 0}, {z: 1}]
  it('a route that goes out of the building and back in is found; a step in from the door is not', () => {
    expect(leavesAfterEntering(inThenOut)).toBe(true)
    expect(leavesAfterEntering([{z: 0}, {z: 1}, {z: 2}])).toBe(false)
    expect(leavesAfterEntering([{z: 1}, {z: 2}])).toBe(false)
  })

  it('from a door to a room in the same building: the way that stays inside, even if longer', () => {
    const planned = [
      {side: 'outside', route: {status: 'ok', points: inThenOut, lengthM: 40}},
      {side: 'inside', route: {status: 'ok', points: [{z: 1}, {z: 1}], lengthM: 55}},
    ]
    const opts = {lengthOf: (r) => r.lengthM, leaves: (r) => leavesAfterEntering(r.points)}
    expect(pickDoorRoute(planned, {...opts, sameBuilding: true}).side).toBe('inside')
    expect(pickDoorRoute(planned, {...opts, sameBuilding: false}).side).toBe('outside') // another building: shorter
    expect(pickDoorRoute([{route: {status: 'error'}}], {...opts, sameBuilding: true})).toBeNull()
  })
})
