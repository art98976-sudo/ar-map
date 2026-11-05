import {describe, expect, it, vi} from 'vitest'
import {distanceM} from '../../src/geo/geo.js'
import {buildGraph, routeOnFootpaths} from '../../src/nav/footpaths.js'
import {parseMazeMapPath, planRoute} from '../../src/nav/route.js'
import footpaths from '../../src/data/footpaths.json'
import data from '../../src/data/destinations.json'

const WALKWAY = {lat: 56.14525, lng: -3.9201}
const pathfoot = data.destinations.find((d) => d.id === 'pathfoot')

// The shape MazeMap's /routing/path returns: [lng, lat] coordinates, one feature per stretch.
const feature = (coordinates, buildingId = null, z = 0) => ({
  type: 'Feature',
  geometry: {type: 'LineString', coordinates},
  id: 5830311,
  properties: {m: 5.3, z, buildingId, target: 5839471, flags: [], travelMode: 'PEDESTRIAN', travelType: 'FOOT'},
})
const response = (...features) => ({
  path: {type: 'FeatureCollection', features},
  pathObjects: {},
  pathMetrics: {distanceWalkingMeters: 583},
  dataProviders: {},
})
const A = [-3.9213, 56.1456]
const B = [-3.9214, 56.1457]
const C = [-3.9216, 56.146]
const D = [-3.9218, 56.1462]
const E = [-3.922, 56.1464]
const pt = ([lng, lat]) => ({lat, lng})

describe('parseMazeMapPath', () => {
  it('reads every coordinate in order, lat and lng the right way round, without repeats', () => {
    const r = parseMazeMapPath(response(feature([A, B]), feature([B, C, D])))
    expect(r.points).toEqual([pt(A), pt(B), pt(C), pt(D)])
    expect(r.indoor).toBe(false)
    expect(r.endsIndoor).toBe(false)
    expect(r.lengthM).toBe(583)
  })
  it('keeps the outdoor part when the final part is indoors', () => {
    const r = parseMazeMapPath(response(feature([A, B]), feature([B, C]), feature([C, D], 1009833, 1), feature([D, E], 1009833, 1)))
    expect(r.indoor).toBe(true)
    expect(r.endsIndoor).toBe(true)
    expect(r.outdoorPoints).toEqual([pt(A), pt(B), pt(C)])
    expect(r.points).toHaveLength(5)
  })
  it('knows a route through a building that comes out again does not end indoors', () => {
    const r = parseMazeMapPath(response(feature([A, B]), feature([B, C], 1009833), feature([C, D])))
    expect(r.indoor).toBe(true)
    expect(r.endsIndoor).toBe(false)
  })
  it('copes with an empty response', () => {
    expect(parseMazeMapPath({}).points).toEqual([])
    expect(parseMazeMapPath(null).outdoorPoints).toEqual([])
  })
})

describe('planRoute', () => {
  const noGraph = async () => {
    throw new Error('no graph')
  }
  const graph = async () => buildGraph(footpaths)
  const mazemap = (json) => async () => parseMazeMapPath(json)
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('uses the full MazeMap route when it stays outdoors, and says so', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await planRoute(pt(A), pathfoot, {mazemap: mazemap(response(feature([A, B, C, D, E]))), graph: noGraph})
    expect(r.source).toBe('mazemap')
    expect(r.points.length).toBeGreaterThanOrEqual(5)
    expect(info).toHaveBeenCalledWith('[route]', 'mazemap', r.points.length, 'points')
    info.mockRestore()
  })
  it('an indoor final part: walks the outdoor part and ends at the door', async () => {
    const json = response(feature([A, B]), feature([B, C]), feature([C, D], 1009833, 1), feature([D, E], 1009833, 1))
    const fallback = vi.fn(graph)
    const r = await planRoute(pt(A), pathfoot, {mazemap: mazemap(json), graph: fallback})
    expect(r.source).toBe('mazemap')
    expect(r.points.at(-1)).toEqual(pt(C))
    expect(r.entrance).toEqual(pt(C)) // the pin marks that door
    expect(fallback).not.toHaveBeenCalled()
  })
  it('a route through a building: prefers the outdoor footpaths', async () => {
    const json = response(feature([A, B]), feature([B, C], 1009833), feature([C, D]))
    const r = await planRoute(WALKWAY, pathfoot, {mazemap: mazemap(json), graph})
    expect(r.source).toBe('footpaths')
  })
  it('a route through a building with no footpaths: still better than a straight line', async () => {
    const warn = quiet()
    const json = response(feature([A, B]), feature([B, C], 1009833), feature([C, D]))
    const r = await planRoute(pt(A), pathfoot, {mazemap: mazemap(json), graph: noGraph})
    expect(r.source).toBe('mazemap')
    expect(r.points.length).toBeGreaterThan(2)
    warn.mockRestore()
  })
  it('only goes straight when nothing else works, with the reason', async () => {
    const warn = quiet()
    const failing = async () => {
      throw new Error('offline')
    }
    const r = await planRoute(WALKWAY, pathfoot, {mazemap: failing, graph: noGraph})
    expect(r.source).toBe('direct')
    expect(r.points).toHaveLength(2)
    warn.mockRestore()
  })
})

describe('footpaths never give up because of an isolated bit of path', () => {
  const g = buildGraph(footpaths)

  it('finds the biggest connected network', () => {
    const inMain = g.component.filter((c) => c === g.mainComponent).length
    expect(inMain).toBeGreaterThan(g.pts.length / 2)
    expect(new Set(g.component).size).toBeGreaterThan(1)
  })
  it('finds a route from anywhere on campus to every destination', () => {
    const none = []
    for (let lat = 56.141; lat <= 56.1515; lat += 0.0015) {
      for (let lng = -3.932; lng <= -3.912; lng += 0.0025) {
        for (const d of data.destinations) {
          if (!routeOnFootpaths(g, {lat, lng}, d.entrance)) none.push(`${lat},${lng},${d.id}`)
        }
      }
    }
    expect(none).toEqual([])
  })
  it('routes are real paths, not one straight hop', () => {
    const r = routeOnFootpaths(g, WALKWAY, pathfoot.entrance)
    expect(r.points.length).toBeGreaterThan(5)
    expect(r.lengthM).toBeGreaterThan(distanceM(WALKWAY, pathfoot.entrance))
  })
})
