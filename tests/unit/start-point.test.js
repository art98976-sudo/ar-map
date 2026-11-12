import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {findTurns} from '../../src/geo/geo.js'
import {TURNS} from '../../src/config.js'
import {pinVisible} from '../../src/ar/pin.js'
import {createArTrip} from '../../src/ar/trip.js'
import {buildGraph, nearestOnPaths} from '../../src/route/footpaths.js'
import {
  addRecentStart,
  entrancesOf,
  getRecentStarts,
  getStart,
  GPS_START,
  isManual,
  outwardHeading,
  PLACE_LIST,
  setStart,
  standHereText,
  startAsDestination,
  startFromPin,
  startFromPlace,
  startLabel,
} from '../../src/route/start-point.js'
import townPaths from '../../src/data/town-footpaths.json'
import data from '../../src/data/destinations.json'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const place = (id) => data.destinations.find((d) => d.id === id)
const store = () => {
  const items = new Map()
  return {getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v)}
}

describe('choosing where to start', () => {
  it('is GPS until something is chosen, and remembers the choice for the session', () => {
    const s = store()
    expect(getStart(s)).toBe(GPS_START)
    expect(isManual(getStart(s))).toBe(false)
    const start = startFromPlace(place('cottrell'))
    setStart(start, s)
    expect(getStart(s)).toEqual(start)
    expect(isManual(getStart(s))).toBe(true)
    setStart(GPS_START, s)
    expect(getStart(s)).toBe(GPS_START)
  })
  it('ignores a damaged record', () => {
    const s = store()
    s.setItem('welcomeAR.start.v1', '{"type":"place","lat":"x"}')
    expect(getStart(s)).toBe(GPS_START)
    s.setItem('welcomeAR.start.v1', 'not json')
    expect(getStart(s)).toBe(GPS_START)
  })
  it('starts at the entrance, not the middle of the building', () => {
    const cottrell = place('cottrell')
    const start = startFromPlace(cottrell)
    expect(start.lat).toBe(cottrell.entrance.lat)
    expect(start.lng).toBe(cottrell.entrance.lng)
    expect(startLabel(start)).toBe('Cottrell main entrance')
  })
  it('faces away from the building at a door, when nothing better is stored', () => {
    const heading = outwardHeading({lat: 56, lng: -3.9}, {lat: 56.001, lng: -3.9})
    near(heading, 0, 1)
    expect(outwardHeading({lat: 56, lng: -3.9}, {lat: 56, lng: -3.9})).toBeNull() // too close to tell
  })
  it('offers each door of a place with several, with its own heading', () => {
    const library = {
      id: 'x', name: 'Library', category: 'library', lat: 56, lng: -3.9,
      entrances: [
        {id: 'north', name: 'north door', lat: 56.001, lng: -3.9, headingDeg: 10, facing: 'the loch'},
        {id: 'south', name: 'south door', lat: 55.999, lng: -3.9},
      ],
    }
    const doors = entrancesOf(library)
    expect(doors.map((d) => d.id)).toEqual(['north', 'south'])
    expect(doors[0].headingDeg).toBe(10)
    near(doors[1].headingDeg, 180, 1) // worked out from where the door is
    expect(standHereText(startFromPlace(library, doors[0]))).toBe('Stand at the Library north door, facing the loch.')
  })
  it('says where to stand and which way to face, in one line', () => {
    expect(standHereText(startFromPlace(place('cottrell')))).toMatch(/^Stand at the Cottrell main entrance, with the door behind you, facing [a-z-]+\.$/)
    expect(standHereText(startFromPlace(place('bus-hub')))).toMatch(/^Stand at the Bus Hub/)
    expect(standHereText(startFromPin({lat: 56, lng: -3.9}))).toBe('Stand where you put the pin.')
  })
  it('every place can be a start, including housing and the car park', () => {
    const names = PLACE_LIST.map((d) => d.name)
    expect(names).toEqual(expect.arrayContaining(['Library', 'Atrium', 'Cottrell Building', 'Main Car Park', 'Juniper Court', 'Bus Hub']))
    expect(new Set(PLACE_LIST.map((d) => d.id)).size).toBe(PLACE_LIST.length)
    for (const p of PLACE_LIST) {
      const door = entrancesOf(p)[0]
      expect(Number.isFinite(door.lat) && Number.isFinite(door.lng), p.id).toBe(true)
    }
  })
  it('keeps recent starts newest first, without repeats, and at most five', () => {
    const s = store()
    for (const id of ['library', 'atrium', 'cottrell', 'pathfoot', 'sports-centre', 'campus-central', 'library']) addRecentStart(place(id), s)
    const recent = getRecentStarts(s)
    expect(recent).toHaveLength(5)
    expect(recent[0].id).toBe('library')
    expect(recent.filter((p) => p.id === 'library')).toHaveLength(1)
  })
  it('swaps: a place goes back to being itself, a pin becomes a named point', () => {
    expect(startAsDestination(startFromPlace(place('cottrell'))).id).toBe('cottrell')
    const pin = startAsDestination(startFromPin({lat: 56.1, lng: -3.92}))
    expect(pin.name).toBe('Pin on the map')
    expect(pin.lat).toBe(56.1)
  })
  it('snaps a pin to the nearest walkable path', () => {
    const graph = buildGraph(townPaths)
    const hit = nearestOnPaths(graph, {lat: 56.1456, lng: -3.9213})
    expect(hit.offsetM).toBeLessThan(60)
    const again = nearestOnPaths(graph, hit)
    expect(again.offsetM).toBeLessThan(0.5)
  })
})

describe('the visuals', () => {
  it('shows the destination pin only within 30 m, never from far away', () => {
    expect(pinVisible(5)).toBe(true)
    expect(pinVisible(30)).toBe(true)
    expect(pinVisible(31)).toBe(false)
    expect(pinVisible(null)).toBe(false)
  })
  it('counts a 30° bend as a corner, but not a 25° one', () => {
    const bend = (deg) => {
      const r = (deg * Math.PI) / 180
      return [{x: 0, y: 0}, {x: 0, y: 30}, {x: Math.sin(r) * 30, y: 30 + Math.cos(r) * 30}]
    }
    expect(findTurns(bend(31), TURNS.minDeg)).toHaveLength(1)
    expect(findTurns(bend(25), TURNS.minDeg)).toHaveLength(0)
  })
})

describe('a trip in AR', () => {
  const ORIGIN = {lat: 56.14525, lng: -3.9201}
  const ROUTE = {
    points: [ORIGIN, {lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng}],
    entrance: {lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng},
    lengthM: 111,
    source: 'footpaths',
  }
  let camera
  let box
  let compass
  let onFix
  let trip
  let time

  function setup(extra = {}) {
    const add = vi.spyOn(window, 'addEventListener')
    trip = createArTrip({route: ROUTE, origin: ORIGIN, destination: {name: 'Library'}, landmarks: [], debug: true, onStats: (s) => (box.stats = s), onPhase: (p) => box.phases.push(p), ...extra})
    compass = add.mock.calls.find(([name]) => name === 'deviceorientation')[1]
    add.mockRestore()
    camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 1.5, 0)
    camera.lookAt(0, 1.5, -1)
    camera.updateMatrixWorld(true)
    trip.onSceneReady({scene: new THREE.Scene(), camera})
    trip.onTracking({status: 'NORMAL'})
  }
  const frames = (n, heading = 0) => {
    for (let i = 0; i < n; i++) {
      vi.advanceTimersByTime(50)
      if (heading != null) compass({webkitCompassHeading: heading, webkitCompassAccuracy: 5})
      trip.onTick({dt: 0.05, time})
      time += 0.05
    }
  }
  const allowGps = () => {
    Object.defineProperty(navigator, 'permissions', {configurable: true, value: {query: async () => ({state: 'granted'})}})
  }
  const fix = (lat, lng, accuracy = 8) => onFix({coords: {latitude: lat, longitude: lng, accuracy}})

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    window.THREE = THREE
    box = {stats: null, phases: []}
    time = 1000
    onFix = null
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
  })
  afterEach(() => {
    trip.stop()
    vi.useRealTimers()
    delete window.THREE
    delete navigator.permissions
  })

  it('from GPS: starts by itself once tracking is ready, with no tap', () => {
    setup({autoStart: true})
    frames(10)
    expect(box.phases).toEqual(['await-start'])
    frames(15)
    expect(box.phases).toEqual(['await-start', 'ready'])
  })
  it('from GPS, facing away: starts by itself, with no turn prompt (the floor arrows show the way)', () => {
    setup({autoStart: true})
    frames(25, 180)
    expect(box.phases).toEqual(['await-start', 'ready'])
    expect(box.stats.turnPrompt).toBeUndefined()
  })
  it('from a door: waits for the tap, then trusts the stored heading over the compass', () => {
    setup({autoStart: true, startPoint: {type: 'place', name: 'Cottrell', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: 40}})
    frames(30, 200)
    expect(box.phases).toEqual(['await-start'])
    expect(trip.start()).toBe('ok')
    frames(10, 200)
    expect(box.stats.manual).toBe(true)
    expect(box.stats.directionKnown).toBe(true)
    near(Math.abs((((box.stats.yawDeg + 180) % 360) + 360) % 360 - 180), 40, 0.1) // not 200
    expect(box.stats.lineUp).toBe(false) // a door already knows which way the user faces: no line-up
  })
  it('from a pin, with no stored heading: the compass decides, as usual', () => {
    setup({startPoint: {type: 'map', name: 'Pin', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: null}})
    frames(5, 180)
    expect(trip.start()).toBe('ok')
    expect(box.phases).toEqual(['await-start', 'ready'])
  })
  it('a manual start ignores GPS, and offers to switch once GPS is good', async () => {
    allowGps()
    const plan = vi.fn(async () => ({status: 'fail'}))
    setup({plan, startPoint: {type: 'place', name: 'Cottrell', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: 0}})
    await vi.advanceTimersByTimeAsync(0)
    expect(onFix).toBeTypeOf('function')
    frames(5)
    trip.start()
    frames(5)
    const before = box.stats.userS
    fix(ORIGIN.lat + 0.0003, ORIGIN.lng)
    frames(6)
    expect(box.stats.userS).toBe(before) // 33 m away by GPS: not moved
    expect(box.stats.liveAvailable).toBe(false)
    fix(ORIGIN.lat + 0.0003, ORIGIN.lng)
    fix(ORIGIN.lat + 0.0003, ORIGIN.lng)
    frames(6)
    expect(box.stats.liveAvailable).toBe(true)
    trip.switchToLive()
    expect(plan).toHaveBeenCalledTimes(1)
    expect(plan.mock.calls[0][0].accuracy).toBe(8)
    await vi.advanceTimersByTimeAsync(0)
    frames(6)
    expect(box.stats.manual).toBe(false)
    expect(box.stats.liveAvailable).toBe(false)
  })
  it('a manual start does not ask for location', async () => {
    Object.defineProperty(navigator, 'permissions', {configurable: true, value: {query: async () => ({state: 'prompt'})}})
    setup({startPoint: {type: 'place', name: 'Cottrell', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: 0}})
    await vi.advanceTimersByTimeAsync(0)
    expect(onFix).toBeNull()
  })
  it('off route from a manual start: plans from where tracking says, and offers to choose again', async () => {
    const plan = vi.fn(async () => ({status: 'fail'}))
    setup({plan, startPoint: {type: 'place', name: 'Cottrell', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: 0}})
    frames(5)
    trip.start()
    frames(5)
    camera.position.x += 40
    camera.updateMatrixWorld(true)
    frames(120)
    expect(plan).toHaveBeenCalledTimes(1)
    near(plan.mock.calls[0][0].lng, ORIGIN.lng + 40 / 62_000, 0.0001)
    expect(box.stats.repick).toBe(true)
  })

  it('gives the arrows the way to walk, from where the phone faces', () => {
    setup()
    frames(5)
    expect(trip.guideDeg).toBeNull() // no walk yet
    trip.start()
    frames(30)
    near(trip.guideDeg, 0, 1) // facing up the route
    camera.lookAt(1, 1.5, 0) // turned to face east: the route is now to the left
    camera.updateMatrixWorld(true)
    frames(30, 90)
    near(trip.guideDeg, -90, 2)
  })
  it('lets the floor be moved up and down, and shows it as a grid', () => {
    setup()
    frames(5)
    trip.start()
    frames(5)
    near(trip.nudgeFloor(0.05), 1.45, 1e-9)
    near(trip.nudgeFloor(-0.1), 1.35, 1e-9)
    frames(5)
    near(box.stats.floorEyeM, 1.35, 1e-9)
    expect(() => trip.setFloorGrid(true)).not.toThrow()
  })
})
