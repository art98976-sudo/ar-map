import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {requestCameraPermission} from '../../src/ar/permissions.js'
import {startCompass, topEdgeHeading} from '../../src/ar/compass.js'
import {alignmentYaw, bearingAlong, createNavScene, rotateY, snapToRoute} from '../../src/ar/nav-scene.js'
import {pointAt, shortestTurn} from '../../src/geo/geo.js'
import {createArTrip} from '../../src/ar/trip.js'

// The real pin draws its label on a 2D canvas, which the test DOM does not have.
vi.mock('../../src/ar/pin.js', async (original) => ({
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
    read(20)
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

  it('starts without any compass, drawing nothing on the ground until walking shows the way', () => {
    vi.advanceTimersByTime(3100)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.25, time: 1000})
    expect(stats.compassSource).toBe('none')
    expect(stats.routeBearingDeg).toBeCloseTo(0, 3)
    expect(trip.start()).toBe('ok')
    trip.onTick({dt: 0.25, time: 1000.3})
    expect(stats.directionKnown).toBe(false)
  })

  it('a compass that wakes up after Start, before any walking, sets the direction', () => {
    vi.advanceTimersByTime(3100)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    trip.start()
    run(1000, 40)
    expect(stats.directionKnown).toBe(true)
    near(Math.abs(wrapped(stats.yawDeg)), 40, 0.1)
  })

  it('facing away at Start: no turn prompt, guidance starts at once and the compass sets the direction', () => {
    read(180)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    expect(trip.start()).toBe('ok')
    expect(phases).toEqual(['await-start', 'ready'])
    run(300, 180)
    expect(stats.turnPrompt).toBeUndefined()
    expect(stats.directionKnown).toBe(true)
    near(Math.abs(wrapped(stats.yawDeg)), 180, 8)
  })

  it('within 60° at Start: no prompt, and the compass decides the direction, not the camera', () => {
    read(50)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    expect(trip.start()).toBe('ok')
    trip.onTick({dt: 0.25, time: 1000.3})
    near(Math.abs(wrapped(stats.yawDeg)), 50, 0.1)
  })

  it('a poor compass at Start: draws nothing on the ground until it recovers', () => {
    read(10, 40)
    trip.onTracking({status: 'NORMAL'})
    trip.onTick({dt: 0.016, time: 1000})
    expect(trip.start()).toBe('ok')
    run(300, 10, 40)
    expect(stats.directionKnown).toBe(false)
    expect(stats.compassPoor).toBe(true)
    run(300, 10, 5) // the figure-8 worked
    expect(stats.directionKnown).toBe(true)
    expect(stats.compassPoor).toBe(false)
  })
})

describe('nothing in mid-air', () => {
  it('puts only the ground (route, chevrons, pin) and the debug floor grid in the scene', () => {
    const scene = new THREE.Scene()
    const camera = makeCamera()
    const nav = createNavScene({THREE, scene, camera, route: ROUTE, origin: ORIGIN, name: 'Library'})
    nav.align(0, ORIGIN)
    expect(scene.children.map((c) => c.name || c.type).sort()).toEqual(['GridHelper', 'geo-root'])
    const grid = scene.children.find((c) => c.type === 'GridHelper')
    expect(grid.visible).toBe(false)
    nav.setGround(-1.4, 0)
    nav.setFloorGrid(true)
    nav.update(0.016, 1)
    expect(grid.visible).toBe(true)
    near(grid.position.y, -1.4, 1e-9)
    nav.dispose()
    expect(scene.children).toHaveLength(0)
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

  it('projects the user onto the route for alignment', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 50}]
    expect(snapToRoute(route, {x: 9, y: 20})).toEqual({x: 0, y: 20})
    expect(snapToRoute(route, {x: 20, y: 20})).toEqual({x: 0, y: 20})
  })

  it('walking with a compass 9° out brings the arrows back onto the path', () => {
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
    near(Math.abs(stats.matchYawDeg), 9, 1) // the compass set the direction, 9° out
    expect(stats.matchResidualM).toBeLessThan(0.5)
    trip.stop()
    vi.useRealTimers()
    delete window.THREE
  })
})

describe('the Start tap', () => {
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

  it('starts on the phone height minus 1.4 m, with no hits: half-transparent, "Point your phone at the floor"', () => {
    const t = start(() => [])
    t.run(0.5)
    near(t.root.position.y, 0.1, 0.001)
    expect(t.box.stats).toMatchObject({groundSource: 'fallback', floorSource: 'fallback', pointAtFloor: true, arrowsShown: true})
    near(t.box.stats.floorBelowM, 1.4, 0.001)
    const fill = t.root.getObjectByName('chevron-1').children[2].material
    near(fill.opacity, 0.5, 0.01)
    t.done()
  })

  it('takes the median of a flat cluster: a table among floor hits does not lift the arrows', () => {
    let n = 0
    const t = start(() => {
      n += 1
      const x = ((n % 7) - 3) * 0.3
      // One hit in four is a table top 0.75 m above the floor.
      return [{type: 'DETECTED_SURFACE', position: {x, y: n % 4 ? -0.1 : 0.65, z: -1 - (n % 3)}}]
    })
    t.run(2)
    near(t.root.position.y, -0.1, 0.01)
    expect(t.box.stats).toMatchObject({floorSource: 'hits', pointAtFloor: false})
    near(t.root.getObjectByName('chevron-1').children[2].material.opacity, 1, 0.01)
    t.done()
  })

  it('never moves the floor more than 5 cm in one frame', () => {
    let floorY = -0.1
    const t = start(() => [{type: 'DETECTED_SURFACE', position: {x: Math.random() - 0.5, y: floorY, z: -1 - Math.random() * 2}}])
    t.run(2)
    near(t.root.position.y, -0.1, 0.01)
    floorY = -0.6 // the floor turns out 0.5 m lower (stale hits age out over 8 s)
    let last = t.root.position.y
    let biggest = 0
    for (let i = 0; i < 400; i++) {
      t.run(0.05)
      biggest = Math.max(biggest, Math.abs(t.root.position.y - last))
      last = t.root.position.y
    }
    expect(biggest).toBeLessThanOrEqual(0.05 + 1e-9)
    near(t.root.position.y, -0.6, 0.02)
    t.done()
  })

  it('a tap on the floor sets the height straight away, until tracking resets', () => {
    let tapping = false
    const t = start(() => (tapping ? [{type: 'FEATURE_POINT', position: {x: 0.2, y: -0.25, z: -1.5}}] : []))
    t.run(0.5)
    tapping = true
    expect(t.trip.tapFloor(0.5, 0.8)).toBe(true)
    tapping = false
    t.run(0.3)
    near(t.root.position.y, -0.25, 1e-6)
    expect(t.box.stats.floorSource).toBe('tap')
    t.run(1)
    expect(t.box.stats.floorSource).toBe('tap') // overrides the estimate
    t.trip.onTracking({status: 'LIMITED'})
    t.run(3)
    t.trip.onTracking({status: 'NORMAL'})
    t.run(0.5)
    expect(t.box.stats.floorSource).toBe('fallback') // tracking reset: found again from scratch
    t.done()
  })

  it('hides a chevron behind a wall, and every one beyond it along the path', () => {
    // A wall 3 m ahead of the camera, across the path: anything aimed past it hits the wall first.
    const t = start((x, y) => (y < 0.5 ? [] : [{type: 'FEATURE_POINT', position: {x: 0, y: 0.6, z: -3}}]))
    t.run(3)
    expect(t.box.stats.arrowsBlocked).toBeGreaterThan(0)
    const items = [...Array(11).keys()].map((i) => t.root.getObjectByName(`chevron-${i}`))
    // The near ones stay; past the wall (3 m, plus the 0.6 m margin), none are drawn.
    const drawn = items.filter((c) => c.visible).map((c) => -c.getWorldPosition(new THREE.Vector3()).z)
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.every((d) => d < 3.6)).toBe(true)
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
    near(t.root.position.y, 0.1, 0.001)
    expect(t.box.stats.groundHits).toBe(0)
    t.done()
  })

  it('searches with several hit tests a frame until the floor is found, and carries on if a hit test throws', () => {
    const hitTest = vi.fn(() => {
      throw new Error('not ready')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = start(hitTest)
    t.run(1.5)
    expect(hitTest.mock.calls.length).toBeGreaterThanOrEqual(6 * 29)
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
    if (extra.geolocation) Object.defineProperty(navigator, 'geolocation', {configurable: true, value: extra.geolocation})
    const trip = createArTrip({route: ROUTE, origin: ORIGIN, destination: {name: 'Library'}, debug: true, onStats: (s) => (box.stats = s), ...extra})
    const compass = add.mock.calls.find(([name]) => name === 'deviceorientation')[1]
    add.mockRestore()
    const camera = makeCamera(0, extra.lookZ ?? -1)
    const scene = new THREE.Scene()
    trip.onSceneReady({scene, camera})
    trip.onTracking({status: 'NORMAL'})
    let i = 0
    let now = reading
    let accuracy = extra.accuracy ?? 5
    const frame = () => {
      vi.advanceTimersByTime(50)
      compass({webkitCompassHeading: now, webkitCompassAccuracy: accuracy})
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
      trip,
      box,
      frame,
      walk,
      scene,
      camera,
      setAccuracy(value) {
        accuracy = value
      },
      sidestep(metres) {
        camera.position.x += metres
        camera.updateMatrixWorld(true)
      },
      faceNorth(compassSays = 0) {
        now = compassSays
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

  it('line-up: opens after Start, a drag turns the route about the user, and after "Looks right" the compass never turns it again', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    expect(t.box.stats).toMatchObject({lineUp: true, canRealign: false})
    const before = wrapped(t.box.stats.yawDeg)
    // Drag right 30°: the route turns clockwise seen from above, about where the user stands.
    const root = t.scene.getObjectByName('geo-root')
    const userBefore = t.trip.mapState().user
    expect(t.trip.rotateRoute(30)).toBe(true)
    for (let i = 0; i < 6; i++) t.frame()
    near(wrapped(t.box.stats.yawDeg - before), -30, 0.5)
    near(t.trip.mapState().user.lat, userBefore.lat, 1e-6) // the user stays put
    expect(root.visible).toBe(true)
    t.trip.confirmLineUp()
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats).toMatchObject({lineUp: false, canRealign: true, compassLocked: true})
    // The compass now says 40° east for many seconds, steady: the route must not move.
    const settled = t.box.stats.yawDeg
    t.faceNorth(40)
    for (let i = 0; i < 10 / 0.05; i++) t.frame()
    near(t.box.stats.yawDeg, settled, 0.01)
    t.trip.recalibrate() // not even the debug button
    for (let i = 0; i < 40; i++) t.frame()
    near(t.box.stats.yawDeg, settled, 0.01)
    // "Re-align" opens it again.
    expect(t.trip.reopenLineUp()).toBe(true)
    t.frame()
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.lineUp).toBe(true)
    t.done()
  })

  it('indoors: near a stair the trip says "Go to Level 2"; "I\'m on Level 2" carries on from the top and lines up again', () => {
    const north = (m) => ORIGIN.lat + m / 111_195
    const route = {
      ...ROUTE,
      source: 'mazemap',
      points: [
        {lat: ORIGIN.lat, lng: ORIGIN.lng, z: 1},
        {lat: north(20), lng: ORIGIN.lng, z: 1},
        {lat: north(20.5), lng: ORIGIN.lng, z: 2}, // up the stair
        {lat: north(40), lng: ORIGIN.lng, z: 2},
      ],
    }
    route.entrance = route.points.at(-1)
    const t = startTrip(0, {route})
    for (let i = 0; i < 10; i++) t.frame()
    t.trip.confirmLineUp()
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.floorChange).toBeNull()
    expect(t.box.stats.floorLevel).toBe(1)
    t.walk(17.5) // 2.5 m before the stair
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.floorChange).toEqual({toLevel: 2, up: true})
    expect(t.trip.confirmFloor()).toBe(true)
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats).toMatchObject({floorChange: null, lineUp: true, floorLevel: 2})
    expect(t.box.stats.userS).toBeGreaterThan(20)
    t.done()
  })

  it('"Look up while you walk": after 10 s of walking with the phone held up, once per trip, for 3 s', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    t.trip.confirmLineUp()
    t.walk(10) // about 8 s: not yet
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.lookUp).toBe(false)
    t.walk(5) // past 10 s of walking, phone up
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.lookUp).toBe(true)
    for (let i = 0; i < 3.5 / 0.05; i++) t.frame()
    expect(t.box.stats.lookUp).toBe(false) // gone after 3 s
    t.walk(15)
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.lookUp).toBe(false) // once per trip
    t.done()
  })

  it('back from the background: the line-up opens again, and the compass still may not turn the route', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    t.trip.confirmLineUp()
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.lineUp).toBe(false)
    t.trip.onResume()
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats).toMatchObject({lineUp: true, compassLocked: true, floorSource: 'fallback'})
    t.done()
  })

  it('line-up: the first drag already stops the compass turning the route', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    t.trip.rotateRoute(-10)
    for (let i = 0; i < 6; i++) t.frame()
    const dragged = t.box.stats.yawDeg
    t.faceNorth(25)
    for (let i = 0; i < 10 / 0.05; i++) t.frame()
    near(t.box.stats.yawDeg, dragged, 0.01)
    t.done()
  })

  it('draws the floor chevrons inside geo-root at once, on the fallback floor, and hides them after 2 s of lost tracking', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    const root = t.scene.getObjectByName('geo-root')
    const arrows = t.scene.getObjectByName('ground-arrows')
    expect(arrows.parent).toBe(root) // in the AR world, not over the screen
    expect(arrows.visible).toBe(true)
    expect(t.box.stats).toMatchObject({aligned: true, arrowsShown: true, arrowsCreated: 11, pointAtFloor: true, groundSource: 'fallback'})
    expect(t.box.stats.arrowsDrawn).toBeGreaterThanOrEqual(9)
    // No floor hit yet: the floor is the phone's height minus 1.4 m, and nothing waits for a hit.
    for (let i = 0; i < 40; i++) t.frame()
    near(root.position.y, t.camera.position.y - 1.4, 0.05)
    // Tracking lost: still drawn for 2 s, then hidden with "Point your phone at the floor".
    t.trip.onTracking({status: 'LIMITED'})
    for (let i = 0; i < 1.5 / 0.05; i++) t.frame()
    expect(arrows.visible).toBe(true)
    for (let i = 0; i < 1 / 0.05; i++) t.frame()
    expect(arrows.visible).toBe(false)
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats).toMatchObject({arrowsShown: false, pointAtFloor: true})
    t.trip.onTracking({status: 'NORMAL'})
    t.frame()
    expect(arrows.visible).toBe(true)
    t.done()
  })

  it('a compass that says north while the camera faces south: the route turns round once the user has walked, and stays round', () => {
    const t = startTrip(0, {lookZ: 1}) // so the route was laid out southwards
    for (let i = 0; i < 10; i++) t.frame()
    expect(t.box.stats.locked).toBe(false)
    t.faceNorth(180) // the compass is 180° out all along
    t.walk(45) // and the user walks north
    expect(t.box.stats.locked).toBe(true)
    expect(t.box.stats.matchFlipped).toBe(true)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    // Walked 45 m along a 111 m route, in the right direction.
    near(t.box.stats.remainingM, 111 - 45, 3)
    near(t.box.stats.debug.lookDeg, 0, 2)
    t.done()
  })

  it('a compass 30° out sets the direction, then walking corrects it, with no flip', () => {
    const t = startTrip(30)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(40)
    expect(t.box.stats.matchFlipped).toBe(false)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    near(Math.abs(t.box.stats.matchYawDeg), 30, 2)
    t.done()
  })

  it('a compass 50° out, as far as Start lets through: walking still brings the route back', () => {
    const t = startTrip(50)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(60)
    expect(t.box.stats.offRouteM).toBeLessThan(0.5)
    near(Math.abs(t.box.stats.matchYawDeg), 50, 3)
    t.done()
  })

  it('a poor compass: the floor arrows show at once, and walking 6 m sets the direction', () => {
    const t = startTrip(200, {accuracy: 40})
    const arrows = t.scene.getObjectByName('ground-arrows')
    for (let i = 0; i < 10; i++) t.frame()
    expect(arrows.visible).toBe(true) // shown as soon as the route is placed
    expect(t.box.stats.compassPoor).toBe(true)
    t.walk(4)
    expect(t.box.stats.directionKnown).toBe(false)
    t.walk(4)
    expect(t.box.stats.directionKnown).toBe(true)
    expect(arrows.visible).toBe(true)
    expect(t.box.stats.compassPoor).toBe(false) // walking settled it
    for (let i = 0; i < 30; i++) t.frame()
    expect(t.box.stats.offRouteM).toBeLessThan(1)
    near(t.box.stats.debug.lookDeg, 0, 3) // the camera looks the way it walked: along the route
    t.done()
  })

  it('a compass that goes poor asks for a figure-8, until walking has proved the placement', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    expect(t.box.stats.compassPoor).toBe(false)
    t.setAccuracy(40)
    for (let i = 0; i < 60; i++) t.frame()
    expect(t.box.stats.compassPoor).toBe(true)
    t.walk(30)
    expect(t.box.stats.locked).toBe(true)
    for (let i = 0; i < 10; i++) t.frame()
    expect(t.box.stats.compassPoor).toBe(false)
    t.done()
  })

  it('fills the ring and passes the corner as the user reaches a turn', () => {
    const route = {...ROUTE, source: 'mazemap', points: [ORIGIN, {lat: ORIGIN.lat + 40 / 111_195, lng: ORIGIN.lng}, {lat: ORIGIN.lat + 40 / 111_195, lng: ORIGIN.lng + 60 / 62_000}]}
    route.entrance = route.points.at(-1)
    const passed = []
    const now = []
    const t = startTrip(0, {route, landmarks: [], onTurnPassed: () => passed.push(true), onTurnNow: () => now.push(true)})
    for (let i = 0; i < 12; i++) t.frame()
    expect(t.box.stats.ringFill).toBe(0)
    t.walk(34)
    near(t.box.stats.ringFill, 0.5, 0.1)
    expect(passed).toHaveLength(0)
    t.walk(4.5)
    expect(now).toHaveLength(1)
    t.done()
  })

  it('gives the map where to draw everything', () => {
    const t = startTrip(30)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(10)
    const state = t.trip.mapState()
    // The same polyline the ground arrows use, as map coordinates; no turn numbers, no leg, no pin.
    expect(state.routeCoords).toHaveLength(2)
    near(state.routeCoords[0][1], ORIGIN.lat, 1e-7)
    near(state.routeCoords[1][1], ORIGIN.lat + 0.001, 1e-7)
    near(state.user.lat, ORIGIN.lat + 10 / 111_195, 2 / 111_195)
    expect(state).not.toHaveProperty('turn')
    expect(state).not.toHaveProperty('leg')
    expect(state.approximate).toBe(true)
    expect(state.headingDeg).not.toBeNull()
    t.done()
  })

  it('tells the user what to do, and ticks before a turn', () => {
    const route = {...ROUTE, source: 'mazemap', points: [ORIGIN, {lat: ORIGIN.lat + 40 / 111_195, lng: ORIGIN.lng}, {lat: ORIGIN.lat + 40 / 111_195, lng: ORIGIN.lng + 60 / 62_000}]}
    route.entrance = route.points.at(-1)
    const ticks = []
    const t = startTrip(0, {route, landmarks: [], arriveLabel: 'Pathfoot entrance', onTurnClose: () => ticks.push(true)})
    for (let i = 0; i < 12; i++) t.frame()
    expect(t.box.stats.instruction).toBe('Continue straight 40 m')
    expect(t.box.stats.routePoints).toBe(3)
    t.walk(28)
    expect(t.box.stats.instruction).toMatch(/^Turn right in 1[0-3] m$/)
    expect(ticks).toHaveLength(0)
    t.walk(8) // the light vibration comes 5 m before the corner
    expect(ticks).toHaveLength(1)
    t.done()
  })

  it('off route for 5 s: plans again from good GPS, and puts the new route in place', async () => {
    const newRoute = {status: 'ok', source: 'footpaths', lengthM: 80, entrance: ROUTE.entrance, points: [{lat: ORIGIN.lat, lng: ORIGIN.lng + 40 / 62_000}, ROUTE.entrance]}
    const plan = vi.fn(async () => newRoute)
    let onFix
    const t = startTrip(0, {plan, geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    onFix({coords: {latitude: ORIGIN.lat, longitude: ORIGIN.lng + 40 / 62_000, accuracy: 10}})
    t.sidestep(40)
    for (let i = 0; i < 4.5 / 0.05; i++) t.frame()
    expect(plan).not.toHaveBeenCalled()
    for (let i = 0; i < 1 / 0.05; i++) t.frame()
    expect(plan).toHaveBeenCalledTimes(1)
    expect(plan.mock.calls[0][0].accuracy).toBe(10)
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 12; i++) t.frame()
    expect(t.box.stats.source).toBe('footpaths')
    expect(t.box.stats.offRouteM).toBeLessThan(1) // the new route starts where GPS says the user is
    expect(t.box.stats.rerouting).toBe(false)
    t.done()
  })

  it('off route with only poor GPS: keeps the route, and does not plan from a bad fix', () => {
    const plan = vi.fn()
    let onFix
    const t = startTrip(0, {plan, geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    onFix({coords: {latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy: 60}})
    t.sidestep(40)
    for (let i = 0; i < 8 / 0.05; i++) t.frame()
    expect(plan).not.toHaveBeenCalled()
    t.done()
  })

  it('GPS worse than 20 m for 3 s hides the arrow and the ground route; 3 s of good GPS brings them back', () => {
    let onFix
    const t = startTrip(0, {geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    const arrows = t.scene.getObjectByName('ground-arrows')
    const fix = (accuracy) => onFix({coords: {latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy}})
    fix(6)
    for (let i = 0; i < 20; i++) t.frame()
    expect(t.trip.guideDeg).not.toBeNull()
    fix(35)
    for (let i = 0; i < 2.8 / 0.05; i++) t.frame()
    expect(t.box.stats.positionUncertain).toBe(false) // not yet: one bad stretch must last 3 s
    for (let i = 0; i < 0.4 / 0.05; i++) t.frame()
    expect(t.box.stats).toMatchObject({positionUncertain: true, positionReason: 'gps'})
    expect(arrows.visible).toBe(false) // unsure for 3 s: the arrows hide and the map leads
    expect(t.trip.guideDeg).toBeNull()
    fix(8)
    for (let i = 0; i < 2.8 / 0.05; i++) t.frame()
    expect(t.box.stats.positionUncertain).toBe(true)
    for (let i = 0; i < 0.6 / 0.05; i++) t.frame() // recovers at 3 s; stats go out every 0.25 s
    expect(t.box.stats.positionUncertain).toBe(false)
    expect(arrows.visible).toBe(true)
    expect(t.trip.guideDeg).not.toBeNull()
    t.done()
  })

  it('a compass swinging 60° while the phone holds still hides the arrow', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    for (let i = 0; i < 5 / 0.05; i++) {
      t.faceNorth(i % 16 < 8 ? 30 : 330) // the compass jumps between 30° and -30°; the camera does not move
      t.frame()
    }
    expect(t.box.stats).toMatchObject({positionUncertain: true, positionReason: 'compass'})
    expect(t.box.stats.headingSwingDeg).toBeGreaterThan(40)
    expect(t.trip.guideDeg).toBeNull()
    t.done()
  })

  it('a poor GPS fix does not hide the arrow on a trip from a chosen door', () => {
    let onFix
    const door = {type: 'place', placeId: 'cottrell', name: 'Cottrell', lat: ORIGIN.lat, lng: ORIGIN.lng, headingDeg: 0}
    const t = startTrip(0, {startPoint: door, geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    onFix?.({coords: {latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy: 60}})
    for (let i = 0; i < 6 / 0.05; i++) t.frame()
    expect(t.box.stats.positionUncertain).toBe(false)
    t.done()
  })

  it('off route: plans a new route at most once every 15 s', async () => {
    const plan = vi.fn(async () => ({...ROUTE, status: 'ok', source: 'footpaths'})) // the same route: still off it
    let onFix
    const t = startTrip(0, {plan, geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    onFix({coords: {latitude: ORIGIN.lat, longitude: ORIGIN.lng + 40 / 62_000, accuracy: 10}})
    t.sidestep(40)
    for (let i = 0; i < 5.2 / 0.05; i++) t.frame()
    expect(plan).toHaveBeenCalledTimes(1)
    expect(t.box.stats.distanceFromRouteM).toBeGreaterThan(15)
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 13.5 / 0.05; i++) t.frame() // 18.7 s: 5 s off again, but only 13.5 s since the last
    expect(plan).toHaveBeenCalledTimes(1)
    expect(t.box.stats.rerouteWaitS).toBeGreaterThan(0)
    for (let i = 0; i < 2 / 0.05; i++) t.frame()
    expect(plan).toHaveBeenCalledTimes(2)
    t.done()
  })

  it('crossing on to campus: says welcome once, and plans again for a campus destination', async () => {
    const outside = {lat: 56.13, lng: -3.92}
    const route = {...ROUTE, source: 'footpaths', points: [outside, ROUTE.entrance]}
    const plan = vi.fn(async () => ({status: 'ok', source: 'mazemap', lengthM: 50, entrance: ROUTE.entrance, points: [ORIGIN, ROUTE.entrance]}))
    const welcome = vi.fn()
    let onFix
    const t = startTrip(0, {route, origin: outside, plan, onEnterCampus: welcome, destination: {name: 'Library', lat: ORIGIN.lat, lng: ORIGIN.lng}, geolocation: {watchPosition: (ok) => ((onFix = ok), 1), clearWatch: () => {}}})
    const fix = (lat, lng) => {
      onFix({coords: {latitude: lat, longitude: lng, accuracy: 8}})
      t.frame()
    }
    fix(outside.lat, outside.lng)
    expect(welcome).not.toHaveBeenCalled()
    fix(ORIGIN.lat, ORIGIN.lng) // one stray fix does not cross the boundary
    fix(outside.lat, outside.lng)
    expect(welcome).not.toHaveBeenCalled()
    fix(ORIGIN.lat, ORIGIN.lng)
    fix(ORIGIN.lat + 0.00001, ORIGIN.lng)
    expect(welcome).toHaveBeenCalledTimes(1)
    expect(plan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 6; i++) t.frame()
    expect(t.box.stats.source).toBe('mazemap')
    fix(ORIGIN.lat + 0.00002, ORIGIN.lng)
    expect(welcome).toHaveBeenCalledTimes(1)
    t.done()
  })

  it('stops the arrows on arrival', () => {
    const t = startTrip(0)
    for (let i = 0; i < 10; i++) t.frame()
    t.walk(106)
    const root = t.scene.getObjectByName('geo-root')
    expect(root.children.filter((c) => c.isInstancedMesh).every((m) => m.visible === false)).toBe(true)
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
