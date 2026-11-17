// Part D: ground arrows from the network (src/ar/network-arrows.js).
import {describe, expect, it} from 'vitest'
import net from '../../src/data/campus-network.json'
import {arrowMode, planArrows} from '../../src/ar/network-arrows.js'
import {wallTesterFrom} from '../../src/ar/network-pose.js'
import {simulateNetworkWalk} from '../../src/map/network-sim.js'
import {buildingAt, routeOnNetwork} from '../../src/route/network-router.js'

const ROUTE = [
  {x: 0, y: 0, z: 0, edgeType: 'start'},
  {x: 0, y: 20, z: 0, edgeType: 'outdoor'},
  {x: 0, y: 21, z: 1, edgeType: 'door'},
  {x: 0, y: 30, z: 1, edgeType: 'corridor'},
  {x: 10, y: 30, z: 1, edgeType: 'corridor'},
  {x: 10, y: 31, z: 2, edgeType: 'stairs'},
  {x: 10, y: 40, z: 2, edgeType: 'corridor'},
]
const pose = (s, z, confidence = 0.9) => ({s, z, confidence, started: true})

describe('network arrows', () => {
  it('normal from 0.7, faded with the minimap from 0.4, hidden below', () => {
    expect(arrowMode(0.9)).toMatchObject({mode: 'normal', opacity: 1, minimap: false})
    expect(arrowMode(0.55)).toMatchObject({mode: 'faded', minimap: true})
    expect(arrowMode(0.55).opacity).toBeLessThan(1)
    expect(arrowMode(0.3)).toMatchObject({mode: 'hidden', opacity: 0, minimap: true})
    expect(arrowMode(NaN).mode).toBe('hidden')
  })

  it('hides the arrows at low confidence: nothing is drawn', () => {
    const plan = planArrows({points: ROUTE, pose: pose(5, 0, 0.3)})
    expect(plan.mode).toBe('hidden')
    expect(plan.segments).toEqual([])
  })

  it('stops at the next door, turn or stair', () => {
    expect(planArrows({points: ROUTE, pose: pose(15, 0)})).toMatchObject({stopKind: 'door'})
    // The door is at s 21, on level 1: the outdoor arrows end at the threshold, on this floor.
    const atDoor = planArrows({points: ROUTE, pose: pose(15, 0)})
    expect(atDoor.untilS).toBeGreaterThanOrEqual(20)
    expect(atDoor.untilS).toBeLessThanOrEqual(21)
    const corridor = planArrows({points: ROUTE, pose: pose(24, 1)})
    expect(corridor.stopKind).toBe('turn')
    expect(corridor.untilS).toBeCloseTo(30, 0)
    const beforeStairs = planArrows({points: ROUTE, pose: pose(35, 1)})
    expect(beforeStairs.stopKind).toBe('floor-change')
    for (const seg of beforeStairs.segments) expect(seg.z).toBe(1)
  })

  it('never draws a segment that crosses a wall: the arrows stop before it', () => {
    const wall = (z, a, b) => z === 1 && Math.min(a.y, b.y) <= 26 && Math.max(a.y, b.y) >= 26 && Math.abs(a.x) < 1 // a wall across the corridor at y 26
    const plan = planArrows({points: ROUTE, pose: pose(23, 1), crossesWall: wall})
    expect(plan.stopKind).toBe('wall')
    expect(plan.segments.length).toBeGreaterThan(0)
    for (const seg of plan.segments) expect(wall(1, seg.a, seg.b)).toBe(false)
    expect(plan.untilS).toBeLessThanOrEqual(26 + 0.5)
  })

  it('Gate D: on the simulated pilot walk no arrow crosses a wall, and low confidence hides them', () => {
    const crossesWall = wallTesterFrom(net)
    const START = {lat: 56.148174267358, lng: -3.9257070226467197}
    const A3 = {lat: 56.144797627811215, lng: -3.9205121464987616, floor: 2, poiId: 1002085033}
    const route = routeOnNetwork(net, START, A3)
    const stats = {normal: 0, faded: 0, hidden: 0, throughWall: 0, hiddenWithSegments: 0, lowConfidenceShown: 0}
    simulateNetworkWalk({
      points: route.points,
      crossesWall,
      insideBuilding: (p) => buildingAt(net, p) != null,
      floorHeights: Object.values(net.floors)[0].levels,
      seed: 1,
      onStep: (step) => {
        const plan = planArrows({points: route.points, pose: step.pose, crossesWall})
        stats[plan.mode] += 1
        if (plan.segments.some((sg) => crossesWall(sg.z, sg.a, sg.b))) stats.throughWall += 1
        if (plan.mode === 'hidden' && plan.segments.length) stats.hiddenWithSegments += 1
        if (step.pose.confidence < 0.4 && plan.mode !== 'hidden') stats.lowConfidenceShown += 1
      },
    })
    expect(stats.throughWall).toBe(0)
    expect(stats.hiddenWithSegments).toBe(0)
    expect(stats.lowConfidenceShown).toBe(0)
    expect(stats.normal).toBeGreaterThan(stats.hidden)
  })
})
