import {describe, expect, it, vi} from 'vitest'
import {distanceM} from '../../src/geo/geo.js'
import {buildGraph, routeOnFootpaths} from '../../src/route/footpaths.js'
import {TOWN_BBOX} from '../../src/config.js'
import {entranceOf, estimateWalkMinutes, isInStirling, isOnCampus, parseMazeMapPath, planRoute} from '../../src/route/route.js'
import townPaths from '../../src/data/town-footpaths.json'
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
  it('finds a route from anywhere on campus to every destination', {timeout: 30_000}, () => {
    const none = []
    for (let lat = 56.141; lat <= 56.1515; lat += 0.0015) {
      for (let lng = -3.932; lng <= -3.912; lng += 0.0025) {
        for (const d of data.destinations.filter((place) => place.area !== 'town')) {
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

describe('walking routes across Stirling', () => {
  const town = buildGraph(townPaths)
  const place = (id) => data.destinations.find((d) => d.id === id)
  const station = place('stirling-station')
  const neverMazemap = async () => {
    throw new Error('MazeMap should not be asked')
  }
  const townGraph = async () => town
  const noCampusGraph = async () => {
    throw new Error('the campus graph should not be used')
  }

  it('the town file covers the area the app says it covers', () => {
    expect(townPaths.bbox).toEqual(TOWN_BBOX)
    expect(town.mainComponent).toBe(0)
    expect(new Set(town.component).size).toBe(1)
  })
  it('knows the campus from the town', () => {
    expect(isOnCampus(entranceOf(pathfoot))).toBe(true)
    expect(isOnCampus(station)).toBe(false)
    expect(isInStirling(station)).toBe(true)
    expect(isInStirling({lat: 55.9533, lng: -3.1883})).toBe(false) // Edinburgh
  })
  it('every place is close to a path, in the town network', {timeout: 30_000}, () => {
    for (const d of data.destinations) {
      const r = routeOnFootpaths(town, station, entranceOf(d))
      expect(r, d.id).not.toBeNull()
      expect(r.snapEndM, d.id).toBeLessThan(120)
    }
  })
  it('from the train station to Pathfoot: a real walk on paths, not MazeMap and not a straight line', async () => {
    const r = await planRoute(station, pathfoot, {mazemap: neverMazemap, graph: noCampusGraph, townGraph})
    expect(r.status).toBe('ok')
    expect(r.source).toBe('footpaths')
    expect(r.points.length).toBeGreaterThan(20)
    const straight = distanceM(station, entranceOf(pathfoot))
    expect(r.lengthM).toBeGreaterThan(straight)
    expect(r.lengthM).toBeLessThan(straight * 1.8)
  })
  it('from campus to each place in town, and between them', async () => {
    const towns = data.destinations.filter((d) => d.area === 'town')
    expect(towns.map((d) => d.name)).toEqual(['Stirling Train Station', 'Stirling Bus Station', 'City Centre', 'Stirling Castle'])
    for (const d of towns) {
      const r = await planRoute(WALKWAY, d, {mazemap: neverMazemap, graph: noCampusGraph, townGraph})
      expect(r.source, d.id).toBe('footpaths')
    }
    expect((await planRoute(station, place('stirling-castle'), {mazemap: neverMazemap, townGraph})).source).toBe('footpaths')
  })
  it('a trip wholly on campus still asks MazeMap first', async () => {
    const mazemap = vi.fn(async () => parseMazeMapPath(response(feature([A, B, C, D, E]))))
    const r = await planRoute(pt(A), pathfoot, {mazemap, graph: noCampusGraph, townGraph})
    expect(mazemap).toHaveBeenCalled()
    expect(r.source).toBe('mazemap')
  })
  it('with no graph at all, a town trip is flagged as a straight line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await planRoute(station, pathfoot, {townGraph: noCampusGraph})
    expect(r.source).toBe('direct')
    warn.mockRestore()
  })
  it('estimates a walking time from town', () => {
    expect(estimateWalkMinutes(station, pathfoot)).toBeGreaterThan(30)
  })
})
