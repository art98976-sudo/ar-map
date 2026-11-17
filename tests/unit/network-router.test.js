// Part B: routing on the connected campus network (src/route/network-router.js) and planRoute()
// with ?network=1.
import {describe, expect, it} from 'vitest'
import net from '../../src/data/campus-network.json'
import {networkEnabled} from '../../src/config.js'
import {fromLocal} from '../../src/geo/geo.js'
import {CAMPUS_ORIGIN} from '../../src/map/campus-geo.js'
import {placeOf, routeOnNetwork} from '../../src/route/network-router.js'
import {planOnNetwork, planRoute} from '../../src/route/route.js'

const START = {lat: 56.148174267358, lng: -3.9257070226467197} // Pathfoot Front Car Park (east)
const A3 = {id: 'mm-1002085033', name: 'A3 Lecture Theatre', category: 'room', floor: 2, lat: 56.144797627811215, lng: -3.9205121464987616, mazemapPoi: 1002085033}
const target = {lat: A3.lat, lng: A3.lng, floor: A3.floor, poiId: A3.mazemapPoi}
const byId = new Map(net.nodes.map((n) => [n.id, n]))

describe('network router', () => {
  it('pilot route: the same entrance door as MazeMap, within 15% of its length', () => {
    const r = routeOnNetwork(net, START, target)
    expect(r).not.toBeNull()
    expect(r.entranceNodeId).toBe(net.pilot.mazemap.entranceNodeIds[0])
    expect(Math.abs(r.lengthM / net.pilot.mazemap.lengthM - 1)).toBeLessThanOrEqual(0.15)
    expect(r.points[0].z).toBe(0)
    expect(r.points.at(-1).z).toBe(2)
    expect(r.points.at(-1).nodeId).toBe(net.pilot.roomNodeId)
    // Every point says what kind of way leads to it, and its floor height.
    for (const p of r.points.slice(1)) expect(['access', 'outdoor', 'door', 'corridor', 'stairs', 'lift']).toContain(p.edgeType)
    expect(r.points.find((p) => p.z === 2).heightM).toBe(3.5)
  })

  it('an indoor ground-floor start (GPS z 0) never routes outside when an indoor path exists', () => {
    // A corridor point on level 1, given as GPS would: no floor.
    const corridor = net.nodes.find((n) => n.z === 1 && n.type === 'path' && n.x < -30 && n.x > -60 && n.y < -60)
    expect(corridor).toBeDefined()
    const from = fromLocal(CAMPUS_ORIGIN, corridor)
    expect(placeOf(net, corridor, 0).kind).toBe('indoor')
    const r = routeOnNetwork(net, from, target)
    expect(r).not.toBeNull()
    expect(r.startPlace).toMatchObject({kind: 'indoor', floor: 1})
    expect(r.points.filter((p) => p.z === 0)).toEqual([])
    expect(r.doors).toEqual([])
  })

  it('step-free routes use a lift and no stairs', () => {
    const r = routeOnNetwork(net, START, target, {stepFree: true})
    expect(r).not.toBeNull()
    expect(r.floorChanges.length).toBeGreaterThan(0)
    expect(r.floorChanges.every((f) => f.type === 'lift')).toBe(true)
    const types = new Set(r.edgeIds.map((id) => net.edges.find((e) => e.id === id).type))
    expect(types.has('stairs')).toBe(false)
    expect(r.edgeIds.some((id) => net.edges.find((e) => e.id === id).stepFree === false)).toBe(false)
  })

  it('stairs cost 1.5 times their length in the search, not in the reported length', () => {
    const r = routeOnNetwork(net, START, target)
    const stairs = r.edgeIds.map((id) => net.edges.find((e) => e.id === id)).filter((e) => e.type === 'stairs')
    expect(stairs.length).toBeGreaterThan(0)
    expect(r.lengthM).toBeLessThan(net.pilot.mazemap.lengthM * 1.15)
    expect(byId.get(r.floorChanges[0].nodeId).z).toBe(1)
  })
})

describe('planRoute with ?network=1', () => {
  it('the flag is read from the address only when it says network=1', () => {
    expect(networkEnabled('?network=1', '')).toBe(true)
    expect(networkEnabled('', '#/ar?to=x&network=1')).toBe(true)
    expect(networkEnabled('?debug=1', '#/ar?to=x')).toBe(false)
    expect(networkEnabled('?network=0', '')).toBe(false)
  })

  it('uses the network first and returns its points with floors and edge types', async () => {
    const route = await planRoute(START, A3, {network: true, networkRoute: (f, d, o) => planOnNetwork(f, d, {...o, load: async () => net}), mazemap: () => Promise.reject(new Error('not called'))})
    expect(route).toMatchObject({status: 'ok', source: 'network', approximate: false})
    expect(route.network.entranceNodeId).toBe(net.pilot.mazemap.entranceNodeIds[0])
    expect(route.points.at(-1)).toMatchObject({z: 2, edgeType: expect.any(String)})
    expect(route.minutes).toBeGreaterThan(0)
  })

  it('falls back to the usual chain outside the network area', async () => {
    const far = {lat: 56.1386, lng: -3.9344} // south-west corner of campus, far from the pilot area
    const viaNetwork = await planOnNetwork(far, A3, {load: async () => net})
    expect(viaNetwork).toBeNull()
    const route = await planRoute(far, {id: 'x', lat: 56.1395, lng: -3.933}, {
      network: true,
      networkRoute: (f, d, o) => planOnNetwork(f, d, {...o, load: async () => net}),
      mazemap: () => Promise.reject(new Error('offline')),
      graph: async () => {
        throw new Error('no graph')
      },
      townGraph: async () => {
        throw new Error('no graph')
      },
    })
    expect(route.source).toBe('direct')
  })

  it('without the flag, the network is never asked', async () => {
    let asked = false
    await planRoute(START, A3, {network: false, networkRoute: async () => (asked = true), mazemap: () => Promise.reject(new Error('offline')), graph: async () => {
      throw new Error('no graph')
    }})
    expect(asked).toBe(false)
  })
})
