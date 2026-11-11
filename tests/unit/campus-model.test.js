import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {CAMPUS_ORIGIN, floorLevelOf, floorPartOf, floorToShow, modelToLatLng, poiIdOf} from '../../src/map/campus-geo.js'
import {createNavScene} from '../../src/ar/nav-scene.js'
import {distanceM, fromLocal} from '../../src/geo/geo.js'
import data from '../../src/data/destinations.json'

// The real pin draws its label on a 2D canvas, which the test DOM does not have.
vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))

const centres = JSON.parse(readFileSync('public/data/room-centres.json', 'utf8'))

describe('campus model names', () => {
  it('reads the poiId after the last underscore', () => {
    expect(poiIdOf('teaching_COTT_A3LT_1002084999')).toBe('1002084999')
    expect(poiIdOf('other_x_1002080614')).toBe('1002080614')
    expect(poiIdOf('B_Cottrell_Building_L2_walls')).toBeNull()
  })

  it('reads floor levels, including the basement', () => {
    expect(floorLevelOf('B_Cottrell_Building_L2')).toBe(2)
    expect(floorLevelOf('B_Robbins_Centre_L-1')).toBe(-1)
    expect(floorLevelOf('B_Cottrell_Building_L2_walls')).toBeNull()
    expect(floorLevelOf('Outdoor')).toBeNull()
    expect(floorPartOf('B_Robbins_Centre_L-1_lintels')).toBe('lintels')
    expect(floorPartOf('B_Cottrell_Building_L1_slab')).toBe('slab')
    expect(floorPartOf('office_COTT_1A012_1002084561')).toBeNull()
  })

  it('shows the selected floor, else the nearest below, else the lowest', () => {
    expect(floorToShow([1, 2, 3, 4], 3)).toBe(3)
    expect(floorToShow([1, 2], 4)).toBe(2)
    expect(floorToShow([3, 4], 1)).toBe(3)
    expect(floorToShow([-1, 1, 2], -1)).toBe(-1)
    expect(floorToShow([], 1)).toBeNull()
  })

  it('puts the model origin at its GPS anchor, x east and y north', () => {
    expect(modelToLatLng(0, 0)).toEqual(CAMPUS_ORIGIN)
    const north = modelToLatLng(0, 100)
    const east = modelToLatLng(100, 0)
    expect(distanceM(CAMPUS_ORIGIN, north)).toBeCloseTo(100, 0)
    expect(north.lat).toBeGreaterThan(CAMPUS_ORIGIN.lat)
    expect(east.lng).toBeGreaterThan(CAMPUS_ORIGIN.lng)
  })
})

describe('?debug=align click readout', () => {
  it('gives metres east/north of the model origin', async () => {
    const {describePoint} = await import('../../src/map/align-debug.js')
    const origin = describePoint({lat: CAMPUS_ORIGIN.lat, lng: CAMPUS_ORIGIN.lng})
    expect(origin.east).toBeCloseTo(0, 6)
    expect(origin.north).toBeCloseTo(0, 6)
    const p = modelToLatLng(-12.5, 40)
    const d = describePoint({lat: p.lat, lng: p.lng})
    expect(d.east).toBeCloseTo(-12.5, 3)
    expect(d.north).toBeCloseTo(40, 3)
    expect(d.fromOrigin).toBeCloseTo(Math.hypot(12.5, 40), 1)
  })
})

describe('room centres from the model', () => {
  it('covers the rooms in the model', () => {
    expect(Object.keys(centres).length).toBeGreaterThan(2500)
    expect(centres['1002084999'][2]).toBe(2) // a Cottrell room on level 2
  })

  it('lands within a few metres of MazeMap’s own points for our rooms', () => {
    const rooms = data.destinations.filter((d) => d.mazemapPoi && centres[d.mazemapPoi])
    expect(rooms.length).toBeGreaterThanOrEqual(3)
    for (const d of rooms) {
      const [lat, lng] = centres[d.mazemapPoi]
      expect(distanceM({lat, lng}, d)).toBeLessThan(3)
    }
  })
})

describe('getRoomCentre', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns {lat, lng, floor} for a room, null otherwise, and fetches once', async () => {
    const fetchMock = vi.fn(async () => ({ok: true, json: async () => ({1002096756: [56.1462, -3.92007, 2]})}))
    vi.stubGlobal('fetch', fetchMock)
    const {getRoomCentre} = await import('../../src/map/room-centres.js')
    expect(await getRoomCentre('1002096756')).toEqual({lat: 56.1462, lng: -3.92007, floor: 2})
    expect(await getRoomCentre(1002096756)).toEqual({lat: 56.1462, lng: -3.92007, floor: 2})
    expect(await getRoomCentre('42')).toBeNull()
    expect(await getRoomCentre(null)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives null, not an error, when the file cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {getRoomCentre} = await import('../../src/map/room-centres.js')
    expect(await getRoomCentre('1002096756')).toBeNull()
  })
})

describe('AR pin in the room', () => {
  const ORIGIN = {lat: 56.14525, lng: -3.9201}
  const ENTRANCE = fromLocal(ORIGIN, {x: 0, y: 30})
  const ROUTE = {points: [ORIGIN, ENTRANCE], lengthM: 30, entrance: ENTRANCE}

  it('moves only the pin: arrival distance still measures to the entrance', () => {
    const camera = new THREE.PerspectiveCamera()
    const nav = createNavScene({THREE, scene: new THREE.Scene(), camera, route: ROUTE, origin: ORIGIN, name: 'Scran'})
    nav.align(0, ORIGIN)
    const before = nav.update(0.016, 1).toPinM
    expect(before).toBeCloseTo(30, 0)
    nav.setMarker(fromLocal(ORIGIN, {x: 20, y: 30}))
    expect(nav.update(0.016, 2).toPinM).toBeCloseTo(before, 6)
    nav.setRoute(ROUTE) // a reroute keeps the pin in the room
    expect(nav.update(0.016, 3).toPinM).toBeCloseTo(before, 6)
    nav.setMarker(null)
    expect(nav.update(0.016, 4).toPinM).toBeCloseTo(before, 6)
    nav.dispose()
  })
})
