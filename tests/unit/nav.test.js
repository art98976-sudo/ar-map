import {describe, expect, it, vi} from 'vitest'
import {
  bearingDeg,
  distanceM,
  findTurns,
  fromLocal,
  polylineLength,
  projectOntoPolyline,
  resample,
  simplify,
  toLocal,
} from '../../src/geo/geo.js'
import {aStar} from '../../src/route/astar.js'
import {buildGraph, routeOnFootpaths} from '../../src/route/footpaths.js'
import {anchor, entranceOf, googleMapsWalkingUrl, isOnCampus, parseMazeMapPath, planRoute, walkingMinutes} from '../../src/route/route.js'
import {angleDiff} from '../../src/geo/geo.js'
import {cameraHeadingFromOrientation, circularMean, circularSpread, createCalibrator} from '../../src/ar/compass.js'
import {alignmentYaw, rotateY, routeToLocal} from '../../src/ar/nav-scene.js'
import {visibleCount} from '../../src/ar/trail.js'
import {formatDistance} from '../../src/ar/pin.js'
import footpaths from '../../src/data/footpaths.json'
import data from '../../src/data/destinations.json'
import {TRAIL} from '../../src/config.js'

const WALKWAY = {lat: 56.14525, lng: -3.9201} // between the Cottrell Building and the Atrium
const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('geo', () => {
  it('measures distance and bearing', () => {
    const north100 = {lat: WALKWAY.lat + 100 / 111_195, lng: WALKWAY.lng}
    near(distanceM(WALKWAY, north100), 100, 0.5)
    near(bearingDeg(WALKWAY, north100), 0, 0.5)
  })
  it('converts GPS to local metres and back', () => {
    const p = {lat: 56.146, lng: -3.918}
    const local = toLocal(WALKWAY, p)
    near(Math.hypot(local.x, local.y), distanceM(WALKWAY, p), 0.2)
    expect(local.x).toBeGreaterThan(0) // east
    expect(local.y).toBeGreaterThan(0) // north
    const back = fromLocal(WALKWAY, local)
    near(back.lat, p.lat, 1e-9)
    near(back.lng, p.lng, 1e-9)
  })
  it('resamples a route every metre with headings', () => {
    const pts = [{x: 0, y: 0}, {x: 0, y: 10}, {x: 5, y: 10}] // north 10 m, then east 5 m
    const s = resample(pts, 1)
    expect(s).toHaveLength(16)
    expect(s[3]).toMatchObject({x: 0, y: 3, s: 3, heading: 0})
    expect(s[12].heading).toBe(90)
    expect(polylineLength(pts)).toBe(15)
  })
  it('projects a position onto the route', () => {
    const pts = [{x: 0, y: 0}, {x: 0, y: 10}, {x: 10, y: 10}]
    expect(projectOntoPolyline(pts, {x: 1, y: 4})).toMatchObject({s: 4, offset: 1})
    expect(projectOntoPolyline(pts, {x: 6, y: 12}).s).toBeCloseTo(16)
  })
  it('finds left and right turns', () => {
    const right = findTurns([{x: 0, y: 0}, {x: 0, y: 10}, {x: 10, y: 10}])
    expect(right).toHaveLength(1)
    near(right[0].angle, 90, 0.01)
    expect(findTurns([{x: 0, y: 0}, {x: 0, y: 10}, {x: -10, y: 10}])[0].angle).toBeLessThan(0)
    expect(findTurns([{x: 0, y: 0}, {x: 0.5, y: 10}, {x: 0, y: 20}])).toHaveLength(0) // gentle bend
  })
  it('smooths zig-zags but keeps corners', () => {
    const zig = [{x: 0, y: 0}, {x: 0.2, y: 5}, {x: 0, y: 10}, {x: 10, y: 10}]
    expect(simplify(zig, 0.5)).toEqual([{x: 0, y: 0}, {x: 0, y: 10}, {x: 10, y: 10}])
  })
})

describe('A*', () => {
  it('finds the shortest path, not the first one', () => {
    // a -> b -> d costs 2; a -> c -> d costs 10.
    const graph = {a: [['b', 1], ['c', 1]], b: [['d', 1]], c: [['d', 9]], d: []}
    const r = aStar({start: 'a', goal: 'd', neighbours: (n) => graph[n], heuristic: () => 0})
    expect(r).toEqual({path: ['a', 'b', 'd'], cost: 2})
  })
  it('returns null when there is no way through', () => {
    const graph = {a: [['b', 1]], b: [], c: []}
    expect(aStar({start: 'a', goal: 'c', neighbours: (n) => graph[n], heuristic: () => 0})).toBeNull()
  })
})

describe('campus footpaths (real OpenStreetMap data)', () => {
  const graph = buildGraph(footpaths)
  const dest = (id) => data.destinations.find((d) => d.id === id)

  it('has a usable network', () => {
    expect(footpaths.nodes.length).toBeGreaterThan(500)
    expect(footpaths.edges.length).toBeGreaterThan(500)
  })

  it.each(['library', 'cottrell', 'pathfoot', 'sports-centre'])('routes from the walkway to the %s entrance', (id) => {
    const to = entranceOf(dest(id))
    const r = routeOnFootpaths(graph, WALKWAY, to)
    expect(r).not.toBeNull()
    const straight = distanceM(WALKWAY, to)
    // A real walk is longer than a straight line, but not absurdly so.
    expect(r.lengthM).toBeGreaterThanOrEqual(straight - 1)
    expect(r.lengthM).toBeLessThan(straight * 3 + 150)
    expect(r.snapStartM).toBeLessThan(40)
    expect(r.snapEndM).toBeLessThan(60)
  })
})

describe('route planning', () => {
  const library = data.destinations.find((d) => d.id === 'library')
  const mmOk = async (from, to) => ({points: [from, {lat: 56.1454, lng: -3.92}, to], indoor: false, lengthM: 50})

  it('every destination has an entrance on campus', () => {
    for (const d of data.destinations.filter((place) => place.area !== 'town')) {
      const e = entranceOf(d)
      expect(isOnCampus(e)).toBe(true)
      expect(d.entrance.confirmed).toBe(false) // until checked on campus (ENTRANCES.md)
      // The entrance is near the place itself.
      expect(distanceM(e, d)).toBeLessThan(350)
    }
  })

  it('uses MazeMap when it gives an outdoor route', async () => {
    const r = await planRoute(WALKWAY, library, {mazemap: mmOk, graph: vi.fn()})
    expect(r).toMatchObject({status: 'ok', source: 'mazemap'})
    expect(r.points[0]).not.toEqual(WALKWAY)
    expect(r.points.at(-1)).toEqual(entranceOf(library))
    expect(r.minutes).toBe(walkingMinutes(r.lengthM))
  })

  describe('anchor', () => {
    const north = (m, from = WALKWAY) => ({lat: from.lat + m / 111_195, lng: from.lng})
    const east = (m, from = WALKWAY) => fromLocal(from, {x: m, y: 0})

    it('starts on the path, not at a GPS fix within 25 m of it', () => {
      const path = [east(8, north(-20)), east(8, north(40))]
      const to = east(8, north(40))
      const pts = anchor(path, WALKWAY, to)
      near(distanceM(pts[0], east(8)), 0, 0.01) // the nearest point on the path, not the fix
      expect(pts).toHaveLength(2)
      expect(pts.at(-1)).toEqual(to)
    })
    it('keeps a real-shaped MazeMap start 17 m from the GPS fix', () => {
      const path = [north(17), east(20, north(17)), east(20, north(50))]
      const pts = anchor(path, WALKWAY, path.at(-1))
      expect(pts[0]).toEqual(path[0])
      expect(distanceM(pts[0], WALKWAY)).toBeCloseTo(17, 0)
    })
    it('ignores a leg the planner added from the raw fix', () => {
      const pts = anchor([WALKWAY, east(8), east(8, north(40))], WALKWAY, east(8, north(40)))
      near(distanceM(pts[0], east(8)), 0, 0.01)
    })
    it('keeps a leg from the user when they are far from any path', () => {
      const path = [east(40), east(40, north(40))]
      const pts = anchor(path, WALKWAY, path[1])
      expect(pts[0]).toEqual(WALKWAY)
      expect(pts).toHaveLength(3)
    })
    it('only appends the entrance when it is more than 3 m from the path end', () => {
      const path = [WALKWAY, north(40)]
      expect(anchor(path, WALKWAY, north(40))).toHaveLength(2)
      expect(anchor(path, WALKWAY, north(20))).toEqual([WALKWAY, north(40), north(20)])
      const beside = anchor(path, WALKWAY, east(10, north(30)))
      expect(beside).toHaveLength(3)
      expect(beside.at(-1)).toEqual(east(10, north(30)))
    })
    it('ignores a leg the planner added to the entrance', () => {
      const door = east(10, north(40))
      const pts = anchor([north(1), north(40), door], WALKWAY, door)
      expect(pts.at(-1)).toEqual(door)
    })
    it('keeps a leg to the entrance when it is far from any path', () => {
      const door = east(30, north(40))
      const pts = anchor([WALKWAY, north(40)], WALKWAY, door)
      expect(pts.at(-1)).toEqual(door)
      expect(pts).toHaveLength(3)
    })
    it('keeps a straight fallback as it is', () => {
      const to = north(100)
      expect(anchor([WALKWAY, to], WALKWAY, to)).toEqual([WALKWAY, to])
    })
  })

  it('falls back to footpaths when MazeMap goes indoors or fails', async () => {
    const graph = async () => buildGraph(footpaths)
    const indoor = async (from, to) => ({points: [from, to], indoor: true})
    expect((await planRoute(WALKWAY, library, {mazemap: indoor, graph})).source).toBe('footpaths')
    const broken = async () => {
      throw new Error('offline')
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await planRoute(WALKWAY, library, {mazemap: broken, graph})).source).toBe('footpaths')
  })

  it('falls back to a straight line when nothing else works', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fail = async () => {
      throw new Error('x')
    }
    const r = await planRoute(WALKWAY, library, {mazemap: fail, graph: fail})
    expect(r).toMatchObject({status: 'ok', source: 'direct'})
    expect(r.points).toHaveLength(2)
  })

  it('says "outside Stirling" beyond the area covered, and links to Google Maps', async () => {
    const edinburgh = {lat: 55.9533, lng: -3.1883}
    const r = await planRoute(edinburgh, library, {mazemap: mmOk})
    expect(r.status).toBe('off-campus')
    expect(r.distanceM).toBeGreaterThan(40_000)
    const url = googleMapsWalkingUrl(library)
    expect(url).toContain('travelmode=walking')
    expect(url).toContain(`${entranceOf(library).lat},${entranceOf(library).lng}`)
  })

  it('reads a MazeMap path response and spots indoor parts', () => {
    const json = {
      path: {
        features: [
          {properties: {buildingId: null}, geometry: {coordinates: [[-3.92, 56.145], [-3.921, 56.146]]}},
          {properties: {buildingId: 7}, geometry: {coordinates: [[-3.921, 56.146], [-3.922, 56.147]]}},
        ],
      },
      pathMetrics: {distanceWalkingMeters: 210},
    }
    const r = parseMazeMapPath(json)
    expect(r.points).toHaveLength(3) // shared vertex not repeated
    expect(r.indoor).toBe(true)
    expect(r.lengthM).toBe(210)
  })
})

describe('compass maths', () => {
  it('upright phone: heading is where the back camera points', () => {
    // W3C: beta = 90 is upright; alpha rotates counter-clockwise from north.
    near(cameraHeadingFromOrientation(0, 90, 0), 0, 0.01) // north
    near(cameraHeadingFromOrientation(270, 90, 0), 90, 0.01) // east
    near(cameraHeadingFromOrientation(180, 90, 0), 180, 0.01) // south
    near(cameraHeadingFromOrientation(90, 90, 0), 270, 0.01) // west
  })
  it('is undefined when the camera looks straight down', () => {
    expect(cameraHeadingFromOrientation(0, 0, 0)).toBeNull()
  })
  it('averages across north without breaking (359° and 1° -> 0°)', () => {
    const m = circularMean([359, 1, 0])
    expect(Math.min(m, 360 - m)).toBeLessThan(0.01)
    expect(circularSpread([90, 90, 90])).toBeCloseTo(0)
    expect(circularSpread([0, 90, 180, 270])).toBeGreaterThan(60)
    expect(angleDiff(350, 10)).toBe(20)
    expect(angleDiff(10, 350)).toBe(-20)
  })
})

describe('compass calibration', () => {
  it('needs 3 s of steady readings, then gives the average', () => {
    const c = createCalibrator()
    let r
    for (let t = 0; t <= 3000; t += 50) r = c.add(120 + Math.sin(t) * 2, null, t)
    expect(r.status).toBe('done')
    near(r.heading, 120, 1.5)
  })
  it('asks for a figure-8 when readings jump around', () => {
    const c = createCalibrator()
    let r
    for (let t = 0; t <= 1000; t += 50) r = c.add(t % 200 === 0 ? 40 : 160, null, t)
    expect(r.status).toBe('unsteady')
  })
  it('treats poor iPhone compass accuracy as unsteady', () => {
    const c = createCalibrator()
    expect(c.add(10, -1, 0).status).toBe('unsteady')
    expect(c.add(10, 45, 10).status).toBe('unsteady')
  })
  it('is still collecting before 3 s', () => {
    const c = createCalibrator()
    let r
    for (let t = 0; t <= 1500; t += 50) r = c.add(200, 5, t)
    expect(r.status).toBe('collecting')
    near(r.progress, 0.53, 0.05)
  })
})

describe('AR alignment', () => {
  it('turns the route frame so the compass heading lines up with the camera', () => {
    // Whatever way the SLAM camera faces, the geo direction "heading h" must end up there.
    for (const [camX, camZ, h] of [
      [0, -1, 0],
      [1, 0, 45],
      [-0.6, 0.8, 200],
      [0.3, -0.95, 310],
    ]) {
      const yaw = alignmentYaw({x: camX, z: camZ}, h)
      const r = (h * Math.PI) / 180
      const geoDir = {x: Math.sin(r), z: -Math.cos(r)}
      const out = rotateY(geoDir, yaw)
      const len = Math.hypot(camX, camZ)
      near(out.x, camX / len, 1e-9)
      near(out.z, camZ / len, 1e-9)
    }
  })
  it('converts and cleans a GPS route into local metres from the start', () => {
    const pts = [WALKWAY, WALKWAY, {lat: WALKWAY.lat + 0.0002, lng: WALKWAY.lng}]
    const local = routeToLocal(WALKWAY, pts)
    expect(local[0]).toEqual({x: 0, y: 0})
    expect(local).toHaveLength(2) // duplicate removed
    near(local[1].y, 22.2, 0.2)
  })
})

describe('arrow trail', () => {
  it('shows the chevrons from 1.5 m to 8 m ahead', () => {
    expect(TRAIL.aheadM).toBe(8)
    expect(TRAIL.spacingM).toBe(1)
    const aS = Float32Array.from({length: 100}, (_, i) => i)
    expect(visibleCount(aS, 0)).toBe(6) // 2..7
    expect(visibleCount(aS, 50)).toBe(6) // 52..57
    expect(visibleCount(aS, 95)).toBe(3) // 97..99, the route ends
  })
  it('formats distances for people', () => {
    expect(formatDistance(4.2)).toBe('4 m')
    expect(formatDistance(123)).toBe('125 m')
    expect(formatDistance(1460)).toBe('1.5 km')
  })
})
