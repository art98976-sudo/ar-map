import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {requestCameraPermission} from '../../src/ar/permissions.js'
import {startCompass, topEdgeHeading} from '../../src/ar/compass.js'
import {alignmentYaw, bearingAlong, createNavScene, pointAt, rotateY, shortestTurn, snapToRoute} from '../../src/ar/nav-scene.js'
import {chooseStartHeading, createArTrip} from '../../src/ar/trip.js'

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

  it('waits for the Start tap, and for tracking, before showing the arrows', () => {
    trip.onTick({dt: 0.25, time: 1000})
    read(90)
    trip.onTick({dt: 0.25, time: 1000.3})
    expect(phases).toEqual(['await-start'])
    expect(stats.canStart).toBe(false)
    expect(trip.start()).toBe('tracking')
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.25, time: 1000.6})
    expect(stats.canStart).toBe(true)
    expect(phases).toEqual(['await-start']) // tracking alone does not place the route
    expect(trip.start()).toBe('ok')
    expect(phases).toEqual(['await-start', 'ready'])
  })

  it('asks for the phone to be held up when it points at the floor', () => {
    trip.onTracking({status: 'NORMAL'})
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    expect(trip.start()).toBe('look')
    expect(phases).toEqual(['await-start'])
  })

  it('leaves the route alone when the heading stays within 5°', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
    trip.onTick({dt: 0.25, time: 1000.3})
    near(wrapped(stats.yawDeg), 0, 0.01)
    run(3500, 4)
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('eases towards a heading more than 5° off, without a snap, after a 3 s steady window', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
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
    trip.start()
    camera.lookAt(0, 0, -1) // looking down at the ground
    camera.updateMatrixWorld(true)
    run(4000, 40)
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('restarts the window whenever the camera turns', () => {
    trip.onTracking({status: 'NORMAL'})
    read(0)
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
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
    trip.start()
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

  it('starts without any compass: the user facing the path is enough', () => {
    vi.advanceTimersByTime(3100)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.25, time: 1000})
    expect(stats.compassSource).toBe('none')
    expect(stats.routeBearingDeg).toBeCloseTo(0, 3)
    expect(trip.start()).toBe('ok')
    trip.onTick({dt: 0.25, time: 1000.3})
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('a compass that wakes up after Start does not turn the route', () => {
    vi.advanceTimersByTime(3100)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
    run(8000, 70)
    near(wrapped(stats.yawDeg), 0, 0.01)
  })

  it('a steadily wrong compass does not undo the user facing the path', () => {
    read(120)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
    run(8000, 120)
    near(wrapped(stats.yawDeg), 0, 0.01)
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

describe('map matching in the scene', () => {
  const STRAIGHT = {...ROUTE}

  it('applies a correction to the placement, keeping the user fixed in the world', () => {
    const camera = makeCamera()
    const nav = createNavScene({THREE, scene: new THREE.Scene(), camera, route: STRAIGHT, origin: ORIGIN, name: 'Library'})
    nav.align(25, ORIGIN)
    const world = {x: 4, z: -9}
    const before = nav.worldToRoute(world)
    const pivot = nav.worldToRoute({x: camera.position.x, z: camera.position.z})
    const turn = (8 * Math.PI) / 180
    expect(nav.applyCorrection({dx: 1.5, dy: -2, yaw: turn, pivot})).toBe(true)
    for (let i = 0; i < 12; i++) nav.update(0.1, i)
    expect(nav.easing).toBe(false)

    // The pivot moved by exactly (dx, dy) in the route frame.
    const after = nav.worldToRoute({x: camera.position.x, z: camera.position.z})
    near(after.x, pivot.x + 1.5, 1e-6)
    near(after.y, pivot.y - 2, 1e-6)
    // Any other point moved as p' = R(yaw)(p - pivot) + pivot + d.
    const x = before.x - pivot.x
    const y = before.y - pivot.y
    const moved = nav.worldToRoute(world)
    near(moved.x, x * Math.cos(turn) - y * Math.sin(turn) + pivot.x + 1.5, 1e-6)
    near(moved.y, x * Math.sin(turn) + y * Math.cos(turn) + pivot.y - 2, 1e-6)
  })

  it('snaps the user onto a route within 15 m, not one further away', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 50}]
    expect(snapToRoute(route, {x: 9, y: 20})).toEqual({x: 0, y: 20})
    expect(snapToRoute(route, {x: 20, y: 20})).toEqual({x: 20, y: 20})
  })

  it('walking with a compass 9° out, averaged in at Start, brings the arrows back onto the path', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    window.THREE = THREE
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition: () => 1, clearWatch: () => {}}})
    const add = vi.spyOn(window, 'addEventListener')
    let stats = null
    const trip = createArTrip({route: ROUTE, origin: ORIGIN, destination: {name: 'Library'}, onStats: (s) => (stats = s)})
    const compass = add.mock.calls.find(([name]) => name === 'deviceorientation')[1]
    add.mockRestore()
    const camera = makeCamera()
    trip.onSceneReady({scene: new THREE.Scene(), camera})
    trip.onTracking({status: 'NORMAL'})

    // The route really runs along -Z, where the camera looks, but the compass says 9° east of that.
    const frame = (i) => {
      vi.advanceTimersByTime(50)
      compass({webkitCompassHeading: 9, webkitCompassAccuracy: 5})
      trip.onTick({dt: 0.05, time: 1000 + i * 0.05})
    }
    frame(0)
    frame(1)
    expect(trip.start()).toBe('ok')
    let i = 2
    for (; i < 12; i++) frame(i)
    const startOff = stats.offRouteM
    for (; i < 12 + 600; i++) {
      camera.position.z -= 1.3 * 0.05
      camera.updateMatrixWorld(true)
      frame(i)
    }
    expect(startOff).toBeLessThan(0.1)
    expect(stats.offRouteM).toBeLessThan(0.5)
    near(Math.abs(stats.matchYawDeg), 4.5, 1) // Start averaged 0° (route) and 9° (compass)
    expect(stats.matchResidualM).toBeLessThan(0.5)
    trip.stop()
    vi.useRealTimers()
    delete window.THREE
  })
})

describe('the Start tap', () => {
  it('uses the route bearing when the compass disagrees by more than 30°', () => {
    expect(chooseStartHeading(10, 100)).toBe(10)
    expect(chooseStartHeading(10, 41)).toBe(10)
    expect(chooseStartHeading(10, null)).toBe(10)
  })
  it('averages with the compass when they agree, across north too', () => {
    near(chooseStartHeading(10, 30), 20, 1e-9)
    near(chooseStartHeading(350, 10) % 360, 0, 1e-9)
  })
  it('reads the route direction over the next few metres, not one short segment', () => {
    const route = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 20}]
    near(bearingAlong(route, 0, 8), 8.1, 0.5) // 1 m east, then north: mostly north
    near(bearingAlong(route, 5, 8), 0, 1e-9)
    expect(pointAt(route, 500)).toEqual({x: 1, y: 20})
  })
  it('puts the user on the route within 20 m, and the route ahead of the camera', () => {
    const camera = makeCamera(1, 0)
    const nav = createNavScene({THREE, scene: new THREE.Scene(), camera, route: ROUTE, origin: ORIGIN, name: 'Library'})
    const beside = {lat: ORIGIN.lat + 18 / 111_195, lng: ORIGIN.lng + 18 / 62_000} // ~18 m east, 18 m north
    const info = nav.startInfo(beside)
    near(info.s, 18, 0.1)
    near(info.bearingDeg, 0, 0.01)
    nav.align(info.bearingDeg, beside)
    const here = nav.worldToRoute({x: camera.position.x, z: camera.position.z})
    near(here.x, 0, 0.01)
    near(here.y, 18, 0.1)
    // Ten metres ahead of the camera is ten metres further along the route.
    const ahead = nav.worldToRoute({x: camera.position.x + 10, z: camera.position.z})
    near(ahead.x, 0, 0.01)
    near(ahead.y, 28, 0.1)
  })
})

describe('alignment in all four directions', () => {
  const FACING = {'-Z': {x: 0, z: -1}, '+X': {x: 1, z: 0}, '+Z': {x: 0, z: 1}, '-X': {x: -1, z: 0}}
  const HEADING = {north: 0, east: 90, south: 180, west: 270}

  for (const [facing, cam] of Object.entries(FACING)) {
    for (const [name, h] of Object.entries(HEADING)) {
      it(`compass says ${name}, SLAM camera faces ${facing}: a segment going ${name} ends up in front`, () => {
        const yaw = alignmentYaw(cam, h)
        const r = (h * Math.PI) / 180
        // A route segment on that compass bearing, in the geo root: x east, z = -north.
        const out = rotateY({x: Math.sin(r), z: -Math.cos(r)}, yaw)
        near(out.x, cam.x, 1e-9)
        near(out.z, cam.z, 1e-9)
      })
    }
  }

  it('in the real scene, a route going north runs ahead of a user facing north', () => {
    for (const [lookX, lookZ] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const camera = makeCamera(lookX, lookZ)
      const nav = createNavScene({THREE, scene: new THREE.Scene(), camera, route: ROUTE, origin: ORIGIN, name: 'Library'})
      nav.align(0, ORIGIN)
      // Ten metres straight ahead of the camera is ten metres north along the route.
      const ahead = nav.worldToRoute({x: lookX * 10, z: lookZ * 10})
      near(ahead.x, 0, 1e-6)
      near(ahead.y, 10, 1e-6)
    }
  })
})

describe('the arrows on the real ground', () => {
  function start(hitTest) {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    window.THREE = THREE
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition: () => 1, clearWatch: () => {}}})
    const box = {stats: null}
    const scene = new THREE.Scene()
    const trip = createArTrip({route: ROUTE, origin: ORIGIN, destination: {name: 'Library'}, onStats: (s) => (box.stats = s)})
    const camera = makeCamera()
    trip.onSceneReady({scene, camera, XR8: {XrController: {hitTest}}})
    trip.onTracking({status: 'NORMAL'})
    expect(trip.start()).toBe('ok')
    const run = (seconds) => {
      for (let i = 0; i < seconds / 0.05; i++) trip.onTick({dt: 0.05, time: (box.time = (box.time ?? 1000) + 0.05)})
    }
    return {
      box,
      run,
      root: scene.getObjectByName('geo-root'),
      trip,
      done() {
        trip.stop()
        vi.useRealTimers()
        delete window.THREE
      },
    }
  }

  it('starts on the phone height minus 1.45 m, with no hits', () => {
    const t = start(() => [])
    t.run(0.5)
    near(t.root.position.y, 0.05, 0.001)
    expect(t.box.stats.groundSource).toBe('eye')
    t.done()
  })

  it('moves onto the surfaces the engine finds', () => {
    let n = 0
    const hitTest = vi.fn(() => {
      n += 1
      return [{type: 'DETECTED_SURFACE', position: {x: 0.5, y: -0.6, z: -((n % 12) + 1)}}]
    })
    const t = start(hitTest)
    t.run(4)
    expect(hitTest.mock.calls[0][2]).toEqual(['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT'])
    expect(hitTest.mock.calls.every(([x, y]) => x > 0 && x < 1 && y >= 0.5)).toBe(true)
    near(t.root.position.y, -0.6, 0.02)
    expect(t.box.stats.groundSource).toBe('hits')
    t.done()
  })

  it('ignores a window or wall above the phone', () => {
    const t = start(() => [{position: {x: 0.5, y: 2.5, z: -3}}])
    t.run(2)
    near(t.root.position.y, 0.05, 0.001)
    expect(t.box.stats.groundHits).toBe(0)
    t.done()
  })

  it('samples about every 0.15 s, and carries on if a hit test throws', () => {
    const hitTest = vi.fn(() => {
      throw new Error('not ready')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = start(hitTest)
    t.run(1.5)
    expect(hitTest.mock.calls.length).toBeGreaterThan(5)
    expect(hitTest.mock.calls.length).toBeLessThan(15)
    expect(t.box.stats.phase).toBe('ready')
    warn.mockRestore()
    t.done()
  })

  it('does not hit test while tracking is limited', () => {
    const hitTest = vi.fn(() => [])
    const t = start(hitTest)
    t.trip.onTracking({status: 'LIMITED'})
    t.run(1)
    expect(hitTest).not.toHaveBeenCalled()
    t.done()
  })
})

describe('compass readings', () => {
  const fakeWindow = (angle) => {
    const handlers = {}
    return {
      handlers,
      screen: {orientation: {angle}},
      addEventListener: (name, fn) => (handlers[name] = fn),
      removeEventListener: () => {},
    }
  }

  it('iPhone: uses webkitCompassHeading, corrected for screen rotation', () => {
    const readings = []
    for (const [angle, expected] of [[0, 30], [90, 120], [270, 300]]) {
      const win = fakeWindow(angle)
      const stop = startCompass({onReading: (r) => readings.push(r)}, win)
      win.handlers.deviceorientation({webkitCompassHeading: 30, webkitCompassAccuracy: 5, beta: 80})
      stop()
      expect(readings.at(-1)).toMatchObject({heading: expected, source: 'webkitCompassHeading', beta: 80})
    }
  })

  it('Android: an upright phone gives the direction out of the back, whatever the screen does', () => {
    const win = fakeWindow(90)
    win.ondeviceorientationabsolute = null
    const readings = []
    const stop = startCompass({onReading: (r) => readings.push(r)}, win)
    win.handlers.deviceorientationabsolute({alpha: 90, beta: 90, gamma: 0}) // facing west
    stop()
    near(readings[0].heading, 270, 1e-6)
    expect(readings[0].source).toBe('alpha')
  })

  it('Android: a phone lying flat falls back to 360 - alpha, so it is not "no compass"', () => {
    const win = fakeWindow(0)
    win.ondeviceorientationabsolute = null
    const readings = []
    const stop = startCompass({onReading: (r) => readings.push(r)}, win)
    win.handlers.deviceorientationabsolute({alpha: 40, beta: 0, gamma: 0})
    stop()
    near(readings[0].heading, 320, 1e-6)
    expect(topEdgeHeading(null)).toBeNull()
  })
})

describe('walking beats the compass', () => {
  function startTrip(reading, extra = {}) {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    window.THREE = THREE
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition: () => 1, clearWatch: () => {}}})
    const add = vi.spyOn(window, 'addEventListener')
    const box = {stats: null}
    const trip = createArTrip({route: ROUTE, origin: ORIGIN, destination: {name: 'Library'}, debug: true, onStats: (s) => (box.stats = s), ...extra})
    const compass = add.mock.calls.find(([name]) => name === 'deviceorientation')[1]
    add.mockRestore()
    const camera = makeCamera(0, extra.lookZ ?? -1)
    trip.onSceneReady({scene: new THREE.Scene(), camera})
    trip.onTracking({status: 'NORMAL'})
    let i = 0
    let now = reading
    const frame = () => {
      vi.advanceTimersByTime(50)
      compass({webkitCompassHeading: now, webkitCompassAccuracy: 5})
      trip.onTick({dt: 0.05, time: 1000 + i++ * 0.05})
    }
    frame()
    expect(trip.start()).toBe('ok')
    const walk = (metres) => {
      for (let m = 0; m < metres; m += 1.3 * 0.05) {
        camera.position.z -= 1.3 * 0.05
        camera.updateMatrixWorld(true)
        frame()
      }
    }
    return {
      box,
      frame,
      walk,
      faceNorth() {
        now = 0
        camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1)
        camera.updateMatrixWorld(true)
      },
      done() {
        trip.stop()
        vi.useRealTimers()
        delete window.THREE
      },
    }
  }

  it('a compass 180° wrong at Start is ignored: the user faced the path', () => {
    const t = startTrip(180)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(40)
    expect(t.box.stats.matchFlipped).toBe(false)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    near(t.box.stats.remainingM, 111 - 40, 3)
    t.done()
  })

  it('facing the wrong way at Start: the route turns round once the user has walked, and stays round', () => {
    const t = startTrip(180, {lookZ: 1}) // faced south, so the route was laid out southwards
    for (let i = 0; i < 10; i++) t.frame()
    expect(t.box.stats.locked).toBe(false)
    t.faceNorth()
    t.walk(45) // but walks north
    expect(t.box.stats.locked).toBe(true)
    expect(t.box.stats.matchFlipped).toBe(true)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    // Walked 45 m along a 111 m route, in the right direction.
    near(t.box.stats.remainingM, 111 - 45, 3)
    near(t.box.stats.debug.lookDeg, 0, 2)
    t.done()
  })

  it('a compass 30° out is averaged in at Start, then corrected by walking, with no flip', () => {
    const t = startTrip(30)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(40)
    expect(t.box.stats.matchFlipped).toBe(false)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    near(Math.abs(t.box.stats.matchYawDeg), 15, 2)
    t.done()
  })

  it('says you have arrived once, within 8 m of the entrance, not before', () => {
    const arrivals = []
    const t = startTrip(0, {onArrived: () => arrivals.push(true)})
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(100)
    expect(arrivals).toHaveLength(0) // 11 m to go
    t.walk(8)
    expect(arrivals).toHaveLength(1)
    t.walk(2)
    expect(arrivals).toHaveLength(1)
    t.done()
  })

  it('reports the numbers the debug overlay shows', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    const {debug} = t.box.stats
    near(debug.cameraYawDeg, 0, 1e-6)
    near(debug.firstSegmentDeg, 0, 1e-6)
    near(debug.lookDeg, 0, 1e-6)
    expect(debug.route.length).toBeGreaterThanOrEqual(2)
    t.done()
  })
})
