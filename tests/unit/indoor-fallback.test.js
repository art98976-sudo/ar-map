// Fix 1: a route that ends indoors never starts AR with an outdoor-only route when MazeMap's
// floor data fails or times out, whether the trip starts outside or inside.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {parseMazeMapPath, planRoute} from '../../src/route/route.js'
import {fitMazeMapRoute} from '../../src/scene/scene-load.js'
import {clearFloorCache} from '../../src/ar/mazemap-floor.js'

const feature = (coordinates, buildingId = null, z = 0) => ({
  type: 'Feature',
  geometry: {type: 'LineString', coordinates},
  properties: {z, buildingId},
})
const response = (...features) => ({path: {type: 'FeatureCollection', features}, pathMetrics: {distanceWalkingMeters: 120}})
// Outside Cottrell, in through a door, along a Level 1 corridor.
const A = [-3.9213, 56.1456]
const B = [-3.9214, 56.1457]
const C = [-3.9216, 56.146]
const D = [-3.9218, 56.1462]
const E = [-3.922, 56.1464]
const ENDS_INDOOR = response(feature([A, B]), feature([B, C]), feature([C, D], 1009833, 1), feature([D, E], 1009833, 1))
const room = {id: 'mm-1', name: 'A3', category: 'room', floor: 1, lat: E[1], lng: E[0]}
const outside = {lat: A[1], lng: A[0]}
const noGraph = async () => {
  throw new Error('no graph')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearFloorCache()
})

describe('planRoute when the floors do not load', () => {
  const mazemap = async () => parseMazeMapPath(ENDS_INDOOR)
  const failedFit = async (mm) => ({...mm, fitted: {sceneLoaded: false}})

  it('a trip that starts OUTSIDE and ends in a room: no route, never an outdoor-only one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await planRoute(outside, room, {mazemap, fit: failedFit, graph: noGraph, network: false})
    expect(r.status).toBe('no-indoor-route')
    expect(r.reason).toBe('floor-data-unavailable')
  })

  it('a trip that starts inside: still no route (as before)', async () => {
    const r = await planRoute({...outside, floor: 1}, room, {mazemap, fit: failedFit, graph: noGraph, network: false})
    expect(r).toMatchObject({status: 'no-indoor-route', reason: 'floor-data-unavailable'})
  })

  it('the fitting step itself failing counts as floors not loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = async () => {
      throw new Error('chunk failed')
    }
    const r = await planRoute(outside, room, {mazemap, fit: broken, graph: noGraph, network: false})
    expect(r.status).toBe('no-indoor-route')
  })

  it('floors loaded: the room route carries its indoor part', async () => {
    const r = await planRoute(outside, room, {mazemap, fit: async (mm) => ({...mm, fitted: {sceneLoaded: true}}), graph: noGraph, network: false})
    expect(r.status).toBe('ok')
    expect(r.indoorPoints.length).toBeGreaterThanOrEqual(2)
  })
})

describe('fitMazeMapRoute: floor fetch fails or times out', () => {
  const mm = () => parseMazeMapPath(ENDS_INDOOR)

  it('a failing tile fetch is not "loaded": it retries once, then reports sceneLoaded false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const r = await fitMazeMapRoute(mm(), {fetchImpl, timeoutMs: 200, retryTimeoutMs: 400})
    expect(r.fitted.sceneLoaded).toBe(false)
    const firstTile = fetchImpl.mock.calls[0][0]
    expect(fetchImpl.mock.calls.filter(([u]) => u === firstTile).length).toBe(2) // tried, then once more
  })

  it('a fetch that never answers times out, retries with a longer wait, then reports sceneLoaded false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(() => new Promise(() => {}))
    const started = Date.now()
    const r = await fitMazeMapRoute(mm(), {fetchImpl, timeoutMs: 50, retryTimeoutMs: 150})
    expect(r.fitted.sceneLoaded).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(190) // both waits ran
  })

  it('a retry that succeeds: the route is fitted on its floors', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('Failed to fetch')
      return {ok: false, status: 404} // no tile there: an empty floor, which is a real answer
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await fitMazeMapRoute(mm(), {fetchImpl, timeoutMs: 200, retryTimeoutMs: 400})
    expect(r.fitted.sceneLoaded).toBe(true)
  })
})
