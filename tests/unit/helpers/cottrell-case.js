// Phase 3 test cases: 100 m indoor walks in the Cottrell Building on MazeMap's real level-2 walls
// and doors (campus-network.json), replayed through the real trip logic (replay.js) with a
// synthetic walk that knows the truth (synth-walk.js). Used by indoor-walls-replay.test.js.
import * as THREE from 'three'
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

/** A route on level 2 between two network nodes, and its floor as mazemap-floor.js returns it. */
export function cottrellCase(fromId, toId) {
  const node = (id) => network.nodes.find((n) => n.id === id)
  const at = (n) => ({...fromLocal(CAMPUS_ORIGIN, n), z: LEVEL})
  const r = routeOnNetwork(network, at(node(fromId)), at(node(toId)))
  const points = r.points.map((p) => ({lat: p.lat, lng: p.lng, z: LEVEL}))
  const xs = r.points.map((p) => p.x)
  const ys = r.points.map((p) => p.y)
  const box = {x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 30, y1: Math.max(...ys) + 30}
  const near = (ring) => ring.some(([x, y]) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)
  const floor = {
    level: LEVEL,
    walls: network.areas.blocked.filter((w) => w.kind === 'wall' && w.z === LEVEL && near(w.polygon[0])).map((w, i) => ({id: `w${i}`, polygon: w.polygon.map((ring) => ring.map(ll))})),
    doors: network.doorLines.filter((d) => d.z === LEVEL && near([d.a])).map((d, i) => ({id: `d${i}`, line: [ll(d.a), ll(d.b)]})),
    rooms: [],
    outlines: [],
    stairs: [],
    lifts: [],
    labels: [],
  }
  const route = {status: 'ok', source: 'mazemap', points, lengthM: r.lengthM, totalM: r.lengthM, entrance: points.at(-1), entryLevel: LEVEL}
  return {route, floor, lengthM: r.lengthM}
}

/** Replay one synthetic walk of a case; the trip gets the real walls through its scene. */
export async function runCase(c, seed, {drift = {}} = {}) {
  const local = c.route.points.map((p) => toLocal(c.route.points[0], p))
  // Where the walker faces at the start: the route's first 2 m, as synth-walk.js has it.
  const startDeg = localBearing(pointAt(local, 0), pointAt(local, 2))
  // A door start: the user stands at the start, facing the corridor; the door's heading is 5° off.
  const startPoint = {type: 'door', name: 'Cottrell Building', entranceName: 'door', lat: c.route.points[0].lat, lng: c.route.points[0].lng, floor: LEVEL, headingDeg: startDeg + (seed % 2 ? 5 : -5), doorFacing: 'inside'}
  const record = synthWalk({route: c.route, destination: {id: 'test', name: 'Test', category: 'room', floor: LEVEL, ...c.route.points.at(-1)}, startPoint, seed, drift: {compassBiasDeg: 30, ...drift}})
  const loadScene = (points, origin) => Promise.resolve(buildScene({route: points, origin, floors: {[LEVEL]: c.floor}}))
  const result = await replayTrip(record, {THREE, createArTrip, loadScene})
  return {result, corridor: arrowCorridorError(result), metrics: tripMetrics(result)}
}

export const CASES = [
  ['n150', 'n235'], // 98 m, 4 turns of 35°+, 2 doors
  ['n363', 'n1131'], // 97 m, 8 turns
]

