// Routing on the connected campus walking network (src/data/campus-network.json): one A* over
// outdoor paths, doors, corridors, stairs and lifts. Used by planRoute() only with ?network=1.
//
// Points are metres east/north of the campus model origin (CAMPUS_ORIGIN), z = MazeMap floor
// (0 outdoors). "Inside a building" is decided by MazeMap's building outline in the network data,
// never by the floor number, so a ground-floor indoor start (z 0 from GPS) still starts indoors.
import {aStar} from './astar.js'
import {CAMPUS_ORIGIN} from '../map/campus-geo.js'
import {fromLocal, toLocal} from '../geo/geo.js'
import {NETWORK} from '../config.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return {x, y, t, d: Math.hypot(p.x - x, p.y - y)}
}

function insideRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const insidePolygon = (p, polygon) => insideRing(p, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(p, hole))

/** Lookups for a network, built once per network object. */
const prepared = new WeakMap()
export function prepareNetwork(net) {
  if (prepared.has(net)) return prepared.get(net)
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]))
  const buildings = (net.areas?.blocked ?? []).filter((b) => b.kind === 'building' && b.source === 'mazemap' && b.building != null)
  const edges = net.edges.map((e) => ({...e, a: nodeById.get(e.from), b: nodeById.get(e.to)})).filter((e) => e.a && e.b)
  const p = {nodeById, buildings, edges}
  prepared.set(net, p)
  return p
}

/** The MazeMap building a point (campus metres) is inside, or null. */
export function buildingAt(net, p) {
  const hit = prepareNetwork(net).buildings.find((b) => insidePolygon(p, b.polygon))
  return hit ? hit.building : null
}

/** Is a point close enough to the network to route on it (inside a building, or near an outdoor path)? */
export function inNetworkArea(net, p, maxM = NETWORK.areaSnapM) {
  if (buildingAt(net, p) != null) return true
  return prepareNetwork(net).edges.some((e) => e.type === 'outdoor' && closestOnSegment(p, e.a, e.b).d <= maxM)
}

/**
 * A building's ground floor at a point (GPS has no floor): the lowest above-ground floor whose
 * MazeMap shapes contain the point. On a slope that is level 1 at one end and level 2 at the other.
 * Without shapes there, the floor of the nearest MazeMap threshold (where routes walk in).
 */
function groundFloorAt(net, p, building) {
  const floors = [...new Set((net.areas?.walkable ?? []).filter((w) => w.z > 0 && w.building === building && !w.derived).map((w) => w.z))].sort((a, b) => a - b)
  for (const z of floors) {
    if (net.areas.walkable.some((w) => w.z === z && w.building === building && !w.derived && insidePolygon(p, w.polygon))) return z
  }
  const near = (net.thresholds ?? []).filter((t) => t.z !== 0).map((t) => ({t, d: dist(t, p)})).sort((a, b) => a.d - b.d)[0]
  if (near) return near.t.z
  const nodes = net.nodes.filter((n) => n.building === building && n.z !== 0)
  return nodes.sort((a, b) => dist(a, p) - dist(b, p))[0]?.z ?? null
}

const costOf = (e) => e.lengthM * (e.type === 'stairs' ? NETWORK.stairsCost : 1)
const allowed = (e, stepFree) => !stepFree || (e.type !== 'stairs' && e.stepFree !== false)

/** The nearest edge a point can join: outdoors, or a corridor on one floor. */
function snapTo(net, p, {indoorFloor = null, stepFree = false} = {}) {
  let best = null
  for (const e of prepareNetwork(net).edges) {
    if (!allowed(e, stepFree)) continue
    if (indoorFloor == null ? e.type !== 'outdoor' : e.type !== 'corridor' || e.a.z !== indoorFloor || e.b.z !== indoorFloor) continue
    const c = closestOnSegment(p, e.a, e.b)
    if (!best || c.d < best.c.d) best = {e, c}
  }
  return best
}

/** Where a trip end lies on the network: {kind: 'outdoor'|'indoor', floor, building}. */
export function placeOf(net, p, z = null) {
  const building = buildingAt(net, p)
  if (building == null) return {kind: 'outdoor', floor: 0, building: null}
  const floor = Number.isFinite(z) && z !== 0 ? z : groundFloorAt(net, p, building)
  return {kind: 'indoor', floor, building}
}

const adjacencies = new WeakMap()
/** id -> [{next, cost, edge}], walking each edge only the way it may be walked. */
function adjacency(net, stepFree) {
  if (!adjacencies.has(net)) adjacencies.set(net, {})
  const cache = adjacencies.get(net)
  const key = stepFree ? 'stepFree' : 'all'
  if (cache[key]) return cache[key]
  const adj = new Map()
  const add = (from, next, edge) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from).push({next, cost: costOf(edge), edge})
  }
  for (const e of net.edges) {
    if (!allowed(e, stepFree)) continue
    if (e.oneWay !== 'reverse') add(e.from, e.to, e)
    if (e.oneWay !== 'forward') add(e.to, e.from, e)
  }
  cache[key] = adj
  return adj
}

/**
 * Route between two points. from / to: {lat, lng, z?, floor?}; to.poiId (a MazeMap room) ends at
 * the network's room node when it has one. Returns null when there is no path, else
 * {points: [{lat, lng, x, y, z, heightM, edgeType, nodeId}], lengthM, nodeIds, edgeIds, doors,
 *  floorChanges, entranceNodeId, startPlace, endPlace}. edgeType is the kind of edge that leads
 * to the point ('start' for the first, 'access' for the walk on to or off the network).
 */
export function routeOnNetwork(net, from, to, {stepFree = false} = {}) {
  const {nodeById} = prepareNetwork(net)
  const adj = adjacency(net, stepFree)
  const zOf = (q) => (Number.isFinite(q?.z) ? q.z : Number.isFinite(q?.floor) ? q.floor : null)
  const pFrom = toLocal(CAMPUS_ORIGIN, from)
  const pTo = toLocal(CAMPUS_ORIGIN, to)
  const startPlace = placeOf(net, pFrom, zOf(from))
  const endPlace = placeOf(net, pTo, zOf(to))
  const s = snapTo(net, pFrom, {indoorFloor: startPlace.kind === 'indoor' ? startPlace.floor : null, stepFree})
  if (!s) return null
  const roomNode = to.poiId != null ? net.nodes.find((n) => n.room && String(n.room.poiId) === String(to.poiId)) : null
  const g = roomNode ? null : snapTo(net, pTo, {indoorFloor: endPlace.kind === 'indoor' ? endPlace.floor : null, stepFree})
  if (!roomNode && !g) return null

  const START = '__start'
  const GOAL = roomNode ? roomNode.id : '__goal'
  const part = (snap, toA) => costOf(snap.e) * (toA ? snap.c.t : 1 - snap.c.t)
  const neighbours = (id) => {
    if (id === START) {
      const out = []
      if (s.e.oneWay !== 'forward') out.push([s.e.from, part(s, true)])
      if (s.e.oneWay !== 'reverse') out.push([s.e.to, part(s, false)])
      return out
    }
    const out = (adj.get(id) ?? []).map((e) => [e.next, e.cost])
    if (g) {
      if (id === g.e.from && g.e.oneWay !== 'reverse') out.push([GOAL, part(g, true)])
      if (id === g.e.to && g.e.oneWay !== 'forward') out.push([GOAL, part(g, false)])
    }
    return out
  }
  const goalAt = roomNode ?? {x: g.c.x, y: g.c.y}
  const heuristic = (id) => (id === START || id === GOAL ? 0 : dist(nodeById.get(id), goalAt))
  const found = aStar({start: START, goal: GOAL, neighbours, heuristic, maxVisits: 500_000})
  if (!found) return null

  const nodeIds = found.path.filter((id) => id !== START && id !== '__goal')
  const levels = Object.values(net.floors ?? {})[0]?.levels ?? {}
  const pts = []
  const edgeIds = []
  let lengthM = 0
  const push = (q, z, edgeType, nodeId = null, legM = null) => {
    const prev = pts.at(-1)
    if (prev) lengthM += legM ?? dist(prev, q)
    const ll = fromLocal(CAMPUS_ORIGIN, q)
    pts.push({lat: ll.lat, lng: ll.lng, x: q.x, y: q.y, z, heightM: z === 0 ? 0 : (levels[z] ?? null), edgeType, nodeId})
  }
  const startZ = startPlace.kind === 'indoor' ? startPlace.floor : 0
  push(pFrom, startZ, 'start')
  if (s.c.d > 0.05) push({x: s.c.x, y: s.c.y}, startZ, 'access')
  edgeIds.push(s.e.id)
  let prev = null
  for (const id of nodeIds) {
    const n = nodeById.get(id)
    const e = prev ? adj.get(prev).find((x) => x.next === id).edge : s.e
    if (prev) edgeIds.push(e.id)
    const vertical = prev && nodeById.get(prev).z !== n.z && (e.type === 'stairs' || e.type === 'lift')
    push(n, n.z, e.type, n.id, vertical ? e.lengthM : null)
    prev = id
  }
  if (g) {
    if (g.e.id !== edgeIds.at(-1)) edgeIds.push(g.e.id)
    const endZ = endPlace.kind === 'indoor' ? endPlace.floor : 0
    push({x: g.c.x, y: g.c.y}, endZ, g.e.type)
    if (g.c.d > 0.05) push(pTo, endZ, 'access')
  }

  const doors = nodeIds.filter((id) => ['door', 'entrance'].includes(nodeById.get(id).type))
  const floorChanges = []
  let entranceNodeId = null
  for (let i = 1; i < nodeIds.length; i++) {
    const a = nodeById.get(nodeIds[i - 1])
    const b = nodeById.get(nodeIds[i])
    if (a.z === 0 && b.z !== 0 && !entranceNodeId) entranceNodeId = b.id
    if (a.z !== b.z && a.z !== 0 && b.z !== 0) {
      const e = adj.get(a.id).find((x) => x.next === b.id).edge
      floorChanges.push({fromLevel: a.z, toLevel: b.z, type: e.type, nodeId: a.id})
    }
  }
  return {points: pts, lengthM, nodeIds, edgeIds, doors, floorChanges, entranceNodeId, startPlace, endPlace}
}

let networkPromise = null
/** Load the network once (1.7 MB; fetched only when ?network=1 asks for it). */
export function loadNetwork() {
  networkPromise ||= import('../data/campus-network.json').then((m) => m.default)
  return networkPromise
}
