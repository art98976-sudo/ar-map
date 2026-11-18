// Phase 3 test cases: 100 m indoor walks in the Cottrell Building on MazeMap's real level-2 walls
// and doors (campus-network.json), replayed through the real trip logic (replay.js) with a
// synthetic walk that knows the truth (synth-walk.js). Used by indoor-walls-replay.test.js.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import * as THREE from 'three'
import {decodeFloorTile} from '../../../src/ar/mazemap-floor.js'
import network from '../../../src/data/campus-network.json'
import {createArTrip} from '../../../src/ar/trip.js'
import {synthWalk} from '../../../src/replay/synth-walk.js'
import {replayTrip} from '../../../src/replay/replay.js'
import {arrowCorridorError, tripMetrics} from '../../../src/replay/metrics.js'
import {routeOnNetwork} from '../../../src/route/network-router.js'
import {buildScene} from '../../../src/scene/scene-data.js'
import {CAMPUS_ORIGIN} from '../../../src/map/campus-geo.js'
import {fromLocal, localBearing, pointAt, toLocal} from '../../../src/geo/geo.js'

export const LEVEL = 2
const ll = ([x, y]) => {
  const p = fromLocal(CAMPUS_ORIGIN, {x, y})
  return [p.lng, p.lat]
}

// Item 9: MazeMap's own stair and lift shapes, from the recorded Cottrell tile (level 2, zoom 18,
// tests/fixtures/mazemap-tiles). Only that one tile is recorded (MazeMap is out of this sandbox's
// reach), so it covers two stair cores and two lifts. A stair core or a lift shaft stands straight
// up, so its level-2 footprint is used on the floors above and below it too.
const RECORDED_TILE = {file: 'tests/fixtures/mazemap-tiles/2.0-18-128217-81440.mvt', x: 128217, y: 81440, z: 18}
let recorded = null
function recordedShafts() {
  if (recorded) return recorded
  const raw = decodeFloorTile(readFileSync(resolve(process.cwd(), RECORDED_TILE.file)), RECORDED_TILE)
  const local = (s, type) => ({type, id: s.id, polygon: s.polygon, ring: s.polygon[0].map(([lng, lat]) => toLocal(CAMPUS_ORIGIN, {lat, lng}))})
  recorded = [...raw.stairs.map((s) => local(s, 'stairs')), ...raw.lifts.map((s) => local(s, 'lift'))]
  return recorded
}
const inRing = (ring, p) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
/** The recorded MazeMap shape of this stair or lift node, or null when none was recorded there. */
export function recordedShaftFor(n) {
  return recordedShafts().find((s) => s.type === n.type && inRing(s.ring, n)) ?? null
}

/** One Cottrell floor as mazemap-floor.js returns it: walls, doors, and stair and lift shapes. */
function floorOf(level, box, {shapes = 'recorded'} = {}) {
  const near = (ring) => ring.some(([x, y]) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)
  // Where no shape was recorded: a 3 m square around the network's node stands for MazeMap's.
  const square = (n) => [[[n.x - 1.5, n.y - 1.5], [n.x + 1.5, n.y - 1.5], [n.x + 1.5, n.y + 1.5], [n.x - 1.5, n.y + 1.5], [n.x - 1.5, n.y - 1.5]].map(ll)]
  const shafts = (type) => {
    const out = new Map()
    for (const n of network.nodes.filter((m) => m.z === level && m.type === type && near([[m.x, m.y]]))) {
      const real = shapes === 'recorded' ? recordedShaftFor(n) : null
      // Several nodes can sit in one recorded shape: it is one stair or lift.
      if (real) out.set(`r${real.id}`, {id: real.id, polygon: real.polygon, recorded: true})
      else out.set(n.id, {id: n.id, polygon: square(n), recorded: false})
    }
    return [...out.values()]
  }
  return {
    level,
    walls: network.areas.blocked.filter((w) => w.kind === 'wall' && w.z === level && near(w.polygon[0])).map((w, i) => ({id: `w${level}-${i}`, polygon: w.polygon.map((ring) => ring.map(ll))})),
    doors: network.doorLines.filter((d) => d.z === level && near([d.a])).map((d, i) => ({id: `d${level}-${i}`, line: [ll(d.a), ll(d.b)]})),
    rooms: [],
    outlines: [],
    stairs: shafts('stairs'),
    lifts: shafts('lift'),
    labels: [],
  }
}

/**
 * A route through Cottrell between two network nodes (on any floors), and its floors. Points keep
 * their floor (z), height (h, from the network) and the kind of edge leading to them (edgeType).
 */
export function cottrellRoute(fromId, toId, {stepFree = false, shapes = 'recorded'} = {}) {
  const node = (id) => network.nodes.find((n) => n.id === id)
  const at = (n) => ({...fromLocal(CAMPUS_ORIGIN, n), z: n.z})
  const r = routeOnNetwork(network, at(node(fromId)), at(node(toId)), {stepFree})
  const points = r.points.map((p) => ({lat: p.lat, lng: p.lng, z: p.z, h: p.heightM ?? 0, edgeType: p.edgeType}))
  const xs = r.points.map((p) => p.x)
  const ys = r.points.map((p) => p.y)
  const box = {x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 30, y1: Math.max(...ys) + 30}
  const levels = [...new Set(points.map((p) => p.z).filter((z) => z !== 0))]
  const floors = Object.fromEntries(levels.map((z) => [z, floorOf(z, box, {shapes})]))
  const route = {status: 'ok', source: 'mazemap', points, lengthM: r.lengthM, totalM: r.lengthM, entrance: points.at(-1), entryLevel: points[0].z}
  return {route, floors, floor: floors[points[0].z], lengthM: r.lengthM, startLevel: points[0].z, endLevel: points.at(-1).z}
}

/** A route on level 2 between two network nodes (Phase 3's 100 m walks). */
export function cottrellCase(fromId, toId) {
  return cottrellRoute(fromId, toId)
}

/** Replay one synthetic walk of a case; the trip gets the real walls through its scene. */
export async function runCase(c, seed, {drift = {}, gpsStart = false, overrides = {}} = {}) {
  const local = c.route.points.map((p) => toLocal(c.route.points[0], p))
  // Where the walker faces at the start: the route's first 2 m, as synth-walk.js has it.
  const startDeg = localBearing(pointAt(local, 0), pointAt(local, 2))
  // A door start: the user stands at the start, facing the corridor; the door's heading is 5° off.
  const level = c.startLevel ?? LEVEL
  // Outdoors (Phase 5): a GPS start, as the location step allows it (the walk's own GPS errors).
  const startPoint = gpsStart ? null : {type: 'door', name: 'Cottrell Building', entranceName: 'door', lat: c.route.points[0].lat, lng: c.route.points[0].lng, floor: level, headingDeg: startDeg + (seed % 2 ? 5 : -5), doorFacing: 'inside'}
  const record = synthWalk({route: c.route, destination: {id: 'test', name: 'Test', category: 'room', floor: c.endLevel ?? level, ...c.route.points.at(-1)}, startPoint, seed, drift: {compassBiasDeg: 30, ...drift}})
  const loadScene = (points, origin) => Promise.resolve(buildScene({route: points, origin, floors: c.floors}))
  const result = await replayTrip(record, {THREE, createArTrip, loadScene, overrides})
  return {result, corridor: arrowCorridorError(result), metrics: tripMetrics(result)}
}

// Phase 4: 14 routes through Cottrell with 21 floor changes: stairs and lifts, up and down, one
// and two floors at a time (the -1 <-> 2 lift is 7 m), and back-to-back changes in one core.
export const FLOOR_CASES = [
  ['n833', 'n676', false], // lift 3->2, lift 2->-1
  ['n1139', 'n1008', false], // stairs 2->3, 3->4
  ['n1036', 'n912', false], // stairs 4->3
  ['n489', 'n387', false], // stairs 3->2, 2->-1
  ['n773', 'n1', false], // stairs 3->2, 2->1
  ['n319', 'n281', false], // stairs 1->2
  ['n402', 'n190', false], // stairs -1->1, 1->2
  ['n263', 'n413', false], // lift 2->-1
  ['n115', 'n335', true], // lift 2->3, 3->4 (step-free)
  ['n679', 'n733', false], // lift 3->4
  ['n269', 'n830', false], // lift 2->3
  ['n423', 'n960', false], // lift -1->2, 2->3
  ['n731', 'n761', false], // lift 4->3
  ['n1178', 'n16', false], // stairs 2->1
]

// Phase 5: from the paths outside into Cottrell, through 10 different doors (level 1 and the
// hillside level-2 doors, and the car park's recessed entrance at -79,-28).
export const DOOR_CASES = [
  ['n1284', 'n1114'], // door 9,-90 (level 1)
  ['n1896', 'n225'], // door -15,-121 (level 2)
  ['n1906', 'n818'], // door 77,-184 (level 2)
  ['n1845', 'n43'], // door 25,-131 (level 2)
  ['n1825', 'n428'], // door 44,-129 (level 1)
  ['n1649', 'n919'], // door 75,-144 (level 1)
  ['n1884', 'n651'], // door -56,-66 (level 2)
  ['n1856', 'n987'], // door 62,-159 (level 2)
  ['n1841', 'n545'], // door -6,-95 (level 2)
  ['n1924', 'n644'], // door -79,-28 (level 1, the recessed car-park entrance)
]

export const CASES = [
  ['n150', 'n235'], // 98 m, 4 turns of 35°+, 2 doors
  ['n363', 'n1131'], // 97 m, 8 turns
]

