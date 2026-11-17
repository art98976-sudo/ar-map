// The network checks on a small hand-made network: each check passes on a good one and catches
// the fault it is for. (The real network is checked in network.test.js.)
import {describe, expect, it} from 'vitest'
import {
  checkBlockedCrossings,
  checkDoors,
  checkFloorsConnected,
  checkPilotRoute,
  checkRoomsReachable,
  checkWalkable,
  runChecks,
} from '../../src/network/network-checks.js'
import {networkGeoJSON} from '../../src/ui/screens/network-layer.js'

const square = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]

function makeNet() {
  const nodes = [
    {id: 'o1', x: -20, y: 5, z: 0, heightM: null, building: null, type: 'path'},
    {id: 'o2', x: -3, y: 5, z: 0, heightM: null, building: null, type: 'path'},
    {id: 'd', x: 0, y: 5, z: 1, heightM: 0, building: 7, type: 'entrance'},
    {id: 'c1', x: 3, y: 5, z: 1, heightM: 0, building: 7, type: 'path'},
    {id: 's1', x: 8, y: 8, z: 1, heightM: 0, building: 7, type: 'stairs'},
    {id: 's2', x: 8, y: 8, z: 2, heightM: 3.5, building: 7, type: 'stairs'},
    {id: 'r', x: 5, y: 5, z: 2, heightM: 3.5, building: 7, type: 'room'},
  ]
  const e = (id, from, to, type, lengthM) => ({id, from, to, type, lengthM, widthM: null, stepFree: type !== 'stairs', oneWay: false, verified: false, source: type === 'outdoor' ? 'osm' : 'mazemap'})
  const edges = [
    e('e1', 'o1', 'o2', 'outdoor', 17),
    e('e2', 'o2', 'd', 'door', 3),
    e('e3', 'd', 'c1', 'corridor', 3),
    e('e4', 'c1', 's1', 'corridor', 5.83),
    e('e5', 's1', 's2', 'stairs', 3.5),
    e('e6', 's2', 'r', 'corridor', 4.24),
  ]
  return {
    schemaVersion: 1,
    origin: {lat: 56.1455, lng: -3.92},
    floors: {7: {name: 'Test Building', measured: false, levels: {1: 0, 2: 3.5}}},
    nodes,
    edges,
    areas: {
      walkable: [
        {id: 'w0', z: 0, kind: 'campus', polygon: square(-100, -100, 100, 100)},
        {id: 'w1', z: 1, kind: 'floor', polygon: square(0, 0, 10, 10)},
        {id: 'w2', z: 2, kind: 'floor', polygon: square(0, 0, 10, 10)},
      ],
      blocked: [
        {id: 'b0', z: 0, kind: 'building', source: 'mazemap', polygon: square(0, 0, 10, 10)},
        {id: 'b1', z: 1, kind: 'wall', source: 'mazemap', polygon: square(4.9, 0, 5.1, 4)},
      ],
    },
    doorLines: [{z: 1, a: [0, 4.5], b: [0, 5.5], exterior: true}],
    openings: [],
    errors: [],
    warnings: [],
    pilot: {name: 'test', start: {name: 'car park', x: -20, y: 5, z: 0}, roomNodeId: 'r', mazemap: {lengthM: 36.6, entranceNodeIds: ['d'], entries: [], points: []}},
  }
}

describe('network checks', () => {
  it('all pass on a good network', () => {
    for (const r of runChecks(makeNet())) expect(r.failures, r.title).toEqual([])
  })

  it('a door without its outdoor join fails the door, room and pilot checks', () => {
    const net = makeNet()
    net.edges = net.edges.filter((e) => e.id !== 'e2')
    expect(checkDoors(net).failures[0].message).toMatch(/no outdoor edge/)
    expect(checkPilotRoute(net).failures.length).toBeGreaterThan(0)
  })

  it('floors without a stair or lift between them fail', () => {
    const net = makeNet()
    net.edges = net.edges.filter((e) => e.id !== 'e5')
    expect(checkFloorsConnected(net).failures.length).toBeGreaterThan(0)
    expect(checkRoomsReachable(net).failures[0].message).toMatch(/cannot be reached/)
  })

  it('a one-way edge against the walk breaks reachability', () => {
    const net = makeNet()
    net.edges.find((e) => e.id === 'e3').oneWay = 'reverse'
    expect(checkRoomsReachable(net).failures.length).toBe(1)
  })

  it('an edge through a wall fails, one through a door does not', () => {
    const net = makeNet()
    net.nodes.find((n) => n.id === 'c1').y = 1 // the corridor now runs through the wall at x = 5
    net.nodes.find((n) => n.id === 's1').y = 2
    const r = checkBlockedCrossings(net)
    expect(r.failures.map((f) => f.edgeIds[0])).toContain('e4')
    expect(r.failures.map((f) => f.edgeIds[0])).not.toContain('e2') // the door join crosses the outline at its door
  })

  it('an outdoor path through a building fails unless it is a mapped passage', () => {
    const net = makeNet()
    net.nodes.push({id: 'o3', x: -5, y: 2, z: 0, type: 'path'}, {id: 'o4', x: 15, y: 2, z: 0, type: 'path'})
    net.edges.push({id: 'e9', from: 'o3', to: 'o4', type: 'outdoor', lengthM: 20, source: 'osm', oneWay: false})
    expect(checkBlockedCrossings(net).failures.map((f) => f.edgeIds[0])).toContain('e9')
    net.edges.at(-1).passage = 'covered'
    expect(checkBlockedCrossings(net).failures.map((f) => f.edgeIds[0])).not.toContain('e9')
  })

  it('an edge outside the walkable floor fails (0.3 m tolerance)', () => {
    const net = makeNet()
    net.nodes.find((n) => n.id === 'c1').x = 3
    net.nodes.find((n) => n.id === 'c1').y = 10.2 // 0.2 m outside: tolerated
    expect(checkWalkable(net).failures).toEqual([])
    net.nodes.find((n) => n.id === 'c1').y = 11 // 1 m outside: not
    expect(checkWalkable(net).failures.map((f) => f.edgeIds[0])).toContain('e3')
  })

  it('the pilot route fails when it is too long or uses another door', () => {
    const net = makeNet()
    net.pilot.mazemap.lengthM = 25
    expect(checkPilotRoute(net).failures[0].message).toMatch(/vs MazeMap 25 m/)
    const other = makeNet()
    other.pilot.mazemap.entranceNodeIds = ['o2']
    expect(checkPilotRoute(other).failures[0].message).toMatch(/enters by d/)
  })
})

describe('network viewer layer', () => {
  it('shows one floor, outdoors on every floor, level changes on both floors, failures in red', () => {
    const net = makeNet()
    const level1 = networkGeoJSON(net, 1, {failed: {nodes: new Set(['d']), edges: new Set(['e3'])}})
    const ids = level1.edges.features.map((f) => f.properties.id)
    expect(ids).toEqual(expect.arrayContaining(['e1', 'e2', 'e3', 'e4', 'e5']))
    expect(ids).not.toContain('e6')
    expect(level1.edges.features.find((f) => f.properties.id === 'e3').properties.error).toBe(true)
    expect(level1.nodes.features.find((f) => f.properties.id === 'd').properties.error).toBe(true)
    expect(networkGeoJSON(net, 2).edges.features.map((f) => f.properties.id)).toEqual(expect.arrayContaining(['e1', 'e5', 'e6']))
    const [lng, lat] = level1.nodes.features.find((f) => f.properties.id === 'd').geometry.coordinates
    expect(lat).toBeCloseTo(56.1455 + 5 / 111195, 6)
    expect(lng).toBeCloseTo(-3.92, 6)
  })
})
