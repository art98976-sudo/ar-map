import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {requestCameraPermission} from '../../src/ar/permissions.js'
import {alignmentYaw, createNavScene, shortestTurn} from '../../src/ar/nav-scene.js'
import {createArTrip} from '../../src/ar/trip.js'

// The real pin draws its label on a 2D canvas, which the test DOM does not have.
vi.mock('../../src/arrows/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))

const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

// Yaw is only meaningful modulo 360°; compare it in -180..180.
const wrapped = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180

const ORIGIN = {lat: 56.14525, lng: -3.9201}
const ROUTE = {
  points: [ORIGIN, {lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng}],
  entrance: {lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng},
  lengthM: 111,
  source: 'direct',
}

// The camera looks along -Z: world "north" until the route is aligned.
function makeCamera(lookX = 0, lookZ = -1, lookY = 0) {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 1.5, 0)
  camera.lookAt(lookX, 1.5 + lookY, lookZ)
  camera.updateMatrixWorld(true)
  return camera
}

describe('background alignment', () => {
  let phases
  let stats
  let trip
  let camera
  let compassEvent

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    phases = []
    stats = null
    window.THREE = THREE
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {watchPosition: () => 1, clearWatch: () => {}},
    })
    const add = vi.spyOn(window, 'addEventListener')
    trip = createArTrip({
      route: ROUTE,
      origin: ORIGIN,
      destination: {name: 'Library'},
      onPhase: (p) => phases.push(p),
      onStats: (s) => (stats = s),
    })
    compassEvent = add.mock.calls.find(([name]) => name === 'deviceorientation')[1]
    add.mockRestore()
    camera = makeCamera()
    trip.onSceneReady({scene: new THREE.Scene(), camera})
  })

  afterEach(() => {
    trip.stop()
    vi.useRealTimers()
    delete window.THREE
  })

  const read = (heading, accuracy = 5) => compassEvent({webkitCompassHeading: heading, webkitCompassAccuracy: accuracy})

  /** Compass readings every 50 ms and engine ticks, for `ms` milliseconds. */
  function run(ms, heading, accuracy) {
    for (let t = 0; t < ms; t += 50) {
      vi.advanceTimersByTime(50)
      read(heading, accuracy)
      trip.onTick({dt: 0.05, time: Date.now() / 1000})
    }
  }

  it('shows the arrows on the first tick with tracking and any compass reading', () => {
    trip.onTick({dt: 0.016, time: 1000})
    expect(phases).toEqual(['starting'])
    read(90)
    trip.onTick({dt: 0.016, time: 1000.1})
    expect(phases).toEqual(['starting']) // compass yes, tracking no
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000.2})
    expect(phases).toEqual(['starting', 'ready'])
  })

  it('leaves the route alone when the heading stays within 5°', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    trip.onTick({dt: 0.25, time: 1000.3})
    near(wrapped(stats.yawDeg), 0, 0.01)
    run(3500, 4)
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('eases towards a heading more than 5° off, without a snap, after a 3 s steady window', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    run(500, 20)
    const before = wrapped(stats.yawDeg)
    near(before, 0, 0.01) // nothing yet: the window is not complete
    run(3200, 20)
    near(Math.abs(wrapped(stats.yawDeg)), 20, 0.1)
    expect(wrapped(stats.yawDeg)).toBeGreaterThan(0) // facing 20° east of north: north is to the left
  })

  it('does not collect while the camera is tilted', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    camera.lookAt(0, 0, -1) // looking down at the ground
    camera.updateMatrixWorld(true)
    run(4000, 40)
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('restarts the window whenever the camera turns', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    for (let i = 0; i < 6; i++) {
      run(1000, 40)
      const a = ((i + 1) * 20 * Math.PI) / 180 // 20° further each second
      camera.lookAt(Math.sin(a), 1.5, -Math.cos(a))
      camera.updateMatrixWorld(true)
    }
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('flags an unsteady compass only after 10 s, and clears it', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    run(9000, 0, -1)
    expect(stats.compassUnsteady).toBe(false)
    run(1500, 0, -1)
    expect(stats.compassUnsteady).toBe(true)
    run(500, 0, 5)
    expect(stats.compassUnsteady).toBe(false)
  })

  it('flags tracking stalled only after 4 s without NORMAL', () => {
    read(0)
    trip.onTick({dt: 0.25, time: 1000})
    trip.onTick({dt: 0.25, time: 1003.9})
    expect(stats.trackingStalled).toBe(false)
    trip.onTick({dt: 0.25, time: 1004.1})
    expect(stats.trackingStalled).toBe(true)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.25, time: 1004.4})
    expect(stats.trackingStalled).toBe(false)
  })

  it('reports no compass after 3 s, and recovers if readings start late', () => {
    vi.advanceTimersByTime(3100)
    expect(phases.at(-1)).toBe('no-compass')
    trip.onTracking({status: 'NORMAL'})
    read(10)
    trip.onTick({dt: 0.016, time: 1000})
    expect(phases.at(-1)).toBe('ready')
  })
})

describe('nav scene realign', () => {
  const setup = (camera = makeCamera()) => {
    const nav = createNavScene({THREE, scene: new THREE.Scene(), camera, route: ROUTE, origin: ORIGIN, name: 'Library'})
    nav.align(0, ORIGIN)
    return nav
  }

  it('ignores differences up to the limit and takes the short way round', () => {
    const nav = setup()
    expect(nav.realign(4, 5)).toBe(false)
    expect(nav.realign(350, 5)).toBe(true)
    nav.update(0.5, 1)
    near(Math.abs(wrapped(nav.yawDeg)), 10, 0.01) // 350° would be the long way round
  })

  it('eases over 0.5 s rather than snapping', () => {
    const nav = setup()
    nav.realign(40)
    const seen = []
    for (let i = 0; i < 6; i++) {
      nav.update(0.1, i)
      seen.push(wrapped(nav.yawDeg))
    }
    expect(Math.abs(seen[0])).toBeGreaterThan(0)
    expect(Math.abs(seen[0])).toBeLessThan(10)
    near(Math.abs(seen[4]), 40, 0.01)
    near(Math.abs(seen[5]), 40, 0.01)
  })

  it('keeps the user at the same place on the route while turning', () => {
    const nav = setup()
    const before = nav.update(0.016, 1)
    nav.realign(40)
    let during
    for (let i = 0; i < 6; i++) during = nav.update(0.1, 2 + i * 0.1)
    near(during.offset, before.offset, 0.01)
    near(during.remainingM, before.remainingM, 0.01)
  })

  it('computes the short turn across the wrap', () => {
    near(shortestTurn(Math.PI - 0.1, -Math.PI + 0.1), 0.2, 1e-9)
    near(shortestTurn(alignmentYaw({x: 0, z: -1}, 0), 0), 0, 1e-9)
  })
})

describe('camera permission', () => {
  it('asks, then releases the camera', async () => {
    const stop = vi.fn()
    const nav = {mediaDevices: {getUserMedia: () => Promise.resolve({getTracks: () => [{stop}]})}}
    await expect(requestCameraPermission(nav)).resolves.toBe('granted')
    expect(stop).toHaveBeenCalled()
  })
  it('only treats a clear no as denied', async () => {
    const fails = (name) => ({mediaDevices: {getUserMedia: () => Promise.reject(new DOMException('x', name))}})
    await expect(requestCameraPermission(fails('NotAllowedError'))).resolves.toBe('denied')
    await expect(requestCameraPermission(fails('NotFoundError'))).resolves.toBe('unknown')
    await expect(requestCameraPermission({})).resolves.toBe('unknown')
  })
})
