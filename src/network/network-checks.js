// Automatic checks for the campus walking network (src/data/campus-network.json). Pure functions on
// the JSON, shared by tests/unit/network.test.js, tools/network-report.mjs and the /#/geometry
// viewer (which draws every failure in red).
import {aStar} from '../route/astar.js'
import {
  closestOnSegment,
  createBoxIndex,
  dist,
  insidePolygon,
  polygonBoundaryDistance,
  polygonBox,
  polygonCrossings,
  pt,
} from './network-geometry.js'

export const CHECK = {
  walkableToleranceM: 0.3, // an edge may stray this far outside a walkable area
  sampleStepM: 0.5, // edges are tested for walkable areas every this far
  doorGapM: 0.5, // a wall crossing this close to a door line passes through the door gap
  doorwayM: 1, // outside the walkable area this close to a door or threshold: expected (wall thickness)
  onRouteM: 1, // a failure this close to the network's pilot route, on its floor, is on it
  pilotCorridorM: 5, // within this of MazeMap's pilot route (but not on the route): "near the pilot route"
  doorEndM: 0.6, // a door's join may cross its own building's outline this close to the door
  openingM: 1.5, // a path may cross a wall/fence/hedge this close to a mapped gate
  pilotLengthTolerance: 0.15, // A* within 15% of MazeMap's route length
}

const INDOOR_TYPES = new Set(['corridor', 'stairs', 'lift'])
const DOOR_TYPES = new Set(['door', 'entrance'])
const LINE_BARRIERS = new Set(['wall', 'fence', 'hedge', 'retaining_wall', 'city_wall', 'guard_rail', 'handrail'])
// Which OSM passage tag makes a crossing of which blocked kind legitimate.
const PASSAGE_EXEMPT = {bridge: new Set(['water']), tunnel: new Set(['building']), covered: new Set(['building']), indoor: new Set(['building'])}

/** Lookups for a network: nodes by id, polygons as {x, y}, spatial indexes. Cached per object. */
const prepared = new WeakMap()
export function prepare(net) {
  if (prepared.has(net)) return prepared.get(net)
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]))
  const out = new Map(net.nodes.map((n) => [n.id, []])) // walking direction respected
  const touching = new Map(net.nodes.map((n) => [n.id, []])) // every edge at a node
  for (const e of net.edges) {
    if (e.oneWay !== 'reverse') out.get(e.from)?.push([e.to, e.lengthM, e])
    if (e.oneWay !== 'forward') out.get(e.to)?.push([e.from, e.lengthM, e])
    touching.get(e.from)?.push(e)
    touching.get(e.to)?.push(e)
  }
  const toPoly = (polygon) => polygon.map((ring) => ring.map(pt))
  const byZ = (list) => {
    const m = new Map()
    for (const a of list) {
      const polygon = toPoly(a.polygon)
      if (!m.has(a.z)) m.set(a.z, [])
      m.get(a.z).push({...a, polygon, box: polygonBox(polygon)})
    }
    return m
  }
  const blocked = byZ(net.areas?.blocked ?? [])
  const walkable = byZ(net.areas?.walkable ?? [])
  const index = (m) => new Map([...m].map(([z, list]) => [z, createBoxIndex(list, 10)]))
  const doorLines = new Map()
  for (const d of net.doorLines ?? []) {
    if (!doorLines.has(d.z)) doorLines.set(d.z, [])
    const a = pt(d.a)
    const b = pt(d.b)
    doorLines.get(d.z).push({a, b, exterior: d.exterior, box: {x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y)}})
  }
  const p = {
    nodeById,
    out,
    touching,
    blocked,
    walkable,
    blockedIndex: index(blocked),
    walkableIndex: index(walkable),
    doorIndex: new Map([...doorLines].map(([z, list]) => [z, createBoxIndex(list, 5)])),
    openings: (net.openings ?? []).map((o) => ({...o, box: {x0: o.x, y0: o.y, x1: o.x, y1: o.y}})),
  }
  p.openingIndex = createBoxIndex(p.openings, 10)
  prepared.set(net, p)
  return p
}

const at = (n) => ({x: n.x, y: n.y, z: n.z})
const fail = (message, extra = {}) => ({message, ...extra})

/** Nodes reachable from one node, walking each edge only the way it may be walked. */
export function reachableFrom(net, startId) {
  const {out} = prepare(net)
  const seen = new Set([startId])
  const stack = [startId]
  while (stack.length) {
    const id = stack.pop()
    for (const [next] of out.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return seen
}

// ---------- the six checks ----------

export function checkRoomsReachable(net) {
  const {nodeById} = prepare(net)
  const rooms = net.nodes.filter((n) => n.type === 'room')
  const entrances = net.nodes.filter((n) => n.type === 'entrance')
  const failures = []
  if (!rooms.length) failures.push(fail('The network has no room node'))
  if (!entrances.length) failures.push(fail('The network has no entrance node'))
  for (const e of entrances) {
    const seen = reachableFrom(net, e.id)
    for (const r of rooms) {
      if (!seen.has(r.id)) failures.push(fail(`${r.room?.name ?? r.id} cannot be reached from entrance ${e.id}`, {nodeIds: [e.id, r.id], ...at(nodeById.get(r.id))}))
    }
  }
  return {id: 'rooms-reachable', title: 'Every room is reachable from every entrance', failures}
}

export function checkDoors(net) {
  const {nodeById, touching} = prepare(net)
  const failures = []
  for (const d of net.nodes.filter((n) => DOOR_TYPES.has(n.type))) {
    const edges = touching.get(d.id) ?? []
    const other = (e) => nodeById.get(e.from === d.id ? e.to : e.from)
    const indoor = edges.some((e) => INDOOR_TYPES.has(e.type) && other(e)?.z !== 0)
    const outdoor = edges.some((e) => (e.type === 'door' || e.type === 'outdoor') && other(e)?.z === 0)
    if (!indoor || !outdoor) {
      const missing = [!indoor && 'indoor', !outdoor && 'outdoor'].filter(Boolean).join(' and ')
      failures.push(fail(`${d.type === 'entrance' ? 'Entrance' : 'Door'} ${d.id} on level ${d.z}${d.door?.courtyard ? ' (courtyard)' : ''} has no ${missing} edge`, {nodeIds: [d.id], ...at(d)}))
    }
  }
  return {id: 'doors-joined', title: 'Every door has an indoor and an outdoor edge', failures}
}

export function checkFloorsConnected(net) {
  const {nodeById} = prepare(net)
  const failures = []
  for (const [building, info] of Object.entries(net.floors ?? {})) {
    const levels = Object.keys(info.levels).map(Number)
    const parent = new Map(levels.map((z) => [z, z]))
    const find = (z) => (parent.get(z) === z ? z : find(parent.get(z)))
    const used = new Set()
    for (const e of net.edges) {
      if (e.type !== 'stairs' && e.type !== 'lift') continue
      const a = nodeById.get(e.from)
      const b = nodeById.get(e.to)
      if (String(a?.building) !== building || String(b?.building) !== building) continue
      if (!parent.has(a.z) || !parent.has(b.z)) continue
      used.add(a.z)
      used.add(b.z)
      parent.set(find(a.z), find(b.z))
    }
    const groups = new Map()
    for (const z of levels) {
      const r = find(z)
      if (!groups.has(r)) groups.set(r, [])
      groups.get(r).push(z)
    }
    if (groups.size > 1) {
      failures.push(fail(`${info.name}: floors are not all joined by stairs or lifts: ${[...groups.values()].map((g) => `{${g.join(', ')}}`).join(' ')}`, {building}))
    }
    for (const z of levels) if (!used.has(z) && levels.length > 1) failures.push(fail(`${info.name}: level ${z} has no stair or lift edge`, {building, z}))
  }
  return {id: 'floors-connected', title: 'Every floor is connected by stairs or a lift', failures}
}

/** The z an edge is walked on (horizontal edges and door joins), or null for a level change. */
function walkZ(a, b, e) {
  if (e.type === 'door') return 0
  return a.z === b.z ? a.z : null
}

export function checkBlockedCrossings(net) {
  const p = prepare(net)
  const failures = []
  for (const e of net.edges) {
    const a = p.nodeById.get(e.from)
    const b = p.nodeById.get(e.to)
    if (!a || !b) continue
    const z = walkZ(a, b, e)
    if (z == null) continue
    const index = p.blockedIndex.get(z)
    if (!index) continue
    const doorEnd = e.type === 'door' ? (a.z !== 0 ? a : b) : null
    for (const area of index.near(a, b)) {
      if (e.passage && PASSAGE_EXEMPT[e.passage]?.has(area.kind)) continue
      let hits = polygonCrossings(a, b, area.polygon)
      if (area.kind === 'wall') hits = hits.filter((h) => !(p.doorIndex.get(z)?.near(h, h, CHECK.doorGapM) ?? []).some((d) => closestOnSegment(h, d.a, d.b).d <= CHECK.doorGapM))
      if (LINE_BARRIERS.has(area.kind) && area.source === 'osm') hits = hits.filter((h) => !p.openingIndex.near(h, h, CHECK.openingM).some((o) => dist(o, h) <= CHECK.openingM))
      if (doorEnd) hits = hits.filter((h) => dist(h, doorEnd) > CHECK.doorEndM)
      // A path wholly inside a building, the water or planting crosses no edge: test its middle.
      const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}
      const inside = !hits.length && !LINE_BARRIERS.has(area.kind) && area.kind !== 'wall' && !doorEnd && insidePolygon(mid, area.polygon) && polygonBoundaryDistance(mid, area.polygon) > CHECK.walkableToleranceM
      if (hits.length || inside) {
        const h = hits[0] ?? mid
        failures.push(fail(`${e.type} edge ${e.id} (${e.source}) ${inside ? 'runs inside' : 'crosses'} a ${area.kind} (${area.source}${area.osmId ? ` ${area.osmId}` : ''}) on level ${z}`, {edgeIds: [e.id], x: Number(h.x.toFixed(2)), y: Number(h.y.toFixed(2)), z}))
        break
      }
    }
  }
  return {id: 'no-blocked-crossing', title: 'No edge crosses a wall or blocked area', failures}
}

/** Is p on a walkable area of level z (within the tolerance)? */
function onWalkable(p, z, prep) {
  const index = prep.walkableIndex.get(z)
  if (!index) return false
  return index.near(p, p, CHECK.walkableToleranceM).some((w) => insidePolygon(p, w.polygon) || polygonBoundaryDistance(p, w.polygon) <= CHECK.walkableToleranceM)
}

/** Within CHECK.doorwayM of a door line, a door node or a MazeMap threshold on level z? */
function nearDoorway(q, z, net, prep) {
  const m = CHECK.doorwayM
  if ((prep.doorIndex.get(z)?.near(q, q, m) ?? []).some((d) => closestOnSegment(q, d.a, d.b).d <= m)) return true
  if ((net.thresholds ?? []).some((t) => t.z === z && dist(t, q) <= m)) return true
  // A door join is walked at z 0, but its doorway is the door node's floor.
  return net.nodes.some((n) => (n.type === 'door' || n.type === 'entrance') && (n.z === z || z === 0) && dist(n, q) <= m)
}

/**
 * Every edge inside a walkable area. A miss within CHECK.doorwayM of a doorway is listed in
 * `expected` (MazeMap's thresholds sit in the thickness of the wall), not as a failure.
 */
export function checkWalkable(net) {
  const p = prepare(net)
  const failures = []
  const expected = []
  for (const e of net.edges) {
    const a = p.nodeById.get(e.from)
    const b = p.nodeById.get(e.to)
    if (!a || !b) continue
    const z = walkZ(a, b, e)
    const samples = []
    if (z == null) {
      // A stair or lift: each end on its own floor.
      for (const n of [a, b]) samples.push({x: n.x, y: n.y, z: n.z})
    } else {
      const n = Math.max(1, Math.ceil(dist(a, b) / CHECK.sampleStepM))
      for (let i = 0; i <= n; i++) samples.push({x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, z})
    }
    let bad = null
    let doorway = null
    for (const q of samples) {
      if (onWalkable(q, q.z, p)) continue
      if (nearDoorway(q, q.z, net, p)) doorway ??= q
      else {
        bad = q
        break
      }
    }
    const at = (q) => ({edgeIds: [e.id], x: Number(q.x.toFixed(2)), y: Number(q.y.toFixed(2)), z: q.z})
    if (bad) failures.push(fail(`${e.type} edge ${e.id} (${e.source}) leaves the walkable area of level ${bad.z}`, at(bad)))
    else if (doorway) expected.push(fail(`${e.type} edge ${e.id} (${e.source}) is outside the walkable area within ${CHECK.doorwayM} m of a doorway on level ${doorway.z}`, at(doorway)))
  }
  return {id: 'inside-walkable', title: `Every edge lies inside a walkable area (${CHECK.walkableToleranceM} m tolerance)`, failures, expected}
}

/**
 * A* on the network from a point outdoors to a node: the start joins the nearest outdoor edge.
 * Returns {lengthM, nodeIds, edgeIds, snapM, entranceNodeId} or null.
 */
export function routeOnNetwork(net, start, goalId) {
  const p = prepare(net)
  const goal = p.nodeById.get(goalId)
  if (!goal) return null
  let snap = null
  for (const e of net.edges) {
    if (e.type !== 'outdoor') continue
    const a = p.nodeById.get(e.from)
    const b = p.nodeById.get(e.to)
    const c = closestOnSegment(start, a, b)
    if (!snap || c.d < snap.c.d) snap = {e, a, b, c}
  }
  if (!snap) return null
  const START = '__start'
  const neighbours = (id) => {
    if (id === START) {
      const {e, a, b, c} = snap
      const outs = []
      if (e.oneWay !== 'reverse') outs.push([b.id, dist(c, b), null])
      if (e.oneWay !== 'forward') outs.push([a.id, dist(c, a), null])
      return outs.map(([n, cost]) => [n, cost])
    }
    return (p.out.get(id) ?? []).map(([n, cost]) => [n, cost])
  }
  const heuristic = (id) => (id === START ? 0 : dist(p.nodeById.get(id), goal))
  const found = aStar({start: START, goal: goalId, neighbours, heuristic, maxVisits: 500_000})
  if (!found) return null
  const nodeIds = found.path.filter((id) => id !== START)
  const edgeIds = []
  for (let i = 1; i < nodeIds.length; i++) {
    const e = (p.out.get(nodeIds[i - 1]) ?? []).find(([n]) => n === nodeIds[i])?.[2]
    if (e) edgeIds.push(e.id)
  }
  // The walk starts along the edge the start point snapped onto.
  if (!edgeIds.includes(snap.e.id)) edgeIds.unshift(snap.e.id)
  const entrance = nodeIds.map((id) => p.nodeById.get(id)).find((n) => DOOR_TYPES.has(n.type))
  return {lengthM: found.cost + snap.c.d, nodeIds, edgeIds, snapM: snap.c.d, start: {x: snap.c.x, y: snap.c.y, z: 0}, entranceNodeId: entrance?.id ?? null}
}

export function checkPilotRoute(net) {
  const failures = []
  const pilot = net.pilot
  const result = {id: 'pilot-route', title: `Pilot route: A* within ${CHECK.pilotLengthTolerance * 100}% of MazeMap and the same entrance`, failures, route: null}
  if (!pilot?.roomNodeId) {
    failures.push(fail('The pilot room is not on the network'))
    return result
  }
  const route = routeOnNetwork(net, pilot.start, pilot.roomNodeId)
  result.route = route
  if (!route) {
    failures.push(fail(`No path on the network from ${pilot.start.name} to the pilot room`, {x: pilot.start.x, y: pilot.start.y, z: 0}))
    return result
  }
  const ref = pilot.mazemap.lengthM
  const ratio = route.lengthM / ref - 1
  if (!Number.isFinite(ref) || Math.abs(ratio) > CHECK.pilotLengthTolerance) {
    failures.push(fail(`Network route ${route.lengthM.toFixed(0)} m vs MazeMap ${ref} m (${(ratio * 100).toFixed(1)}%)`, {edgeIds: route.edgeIds}))
  }
  const expected = pilot.mazemap.entranceNodeIds ?? []
  if (!expected.length) failures.push(fail('MazeMap\'s pilot entrance is not a door node of the network'))
  else if (!expected.includes(route.entranceNodeId)) {
    const got = prepare(net).nodeById.get(route.entranceNodeId)
    failures.push(fail(`Network route enters by ${route.entranceNodeId ?? 'no door'}, MazeMap by ${expected.join(', ')}`, {nodeIds: [route.entranceNodeId, ...expected].filter(Boolean), ...(got ? at(got) : {})}))
  }
  return result
}

/**
 * Split a check's failures: on the pilot route (naming an edge or node the network's pilot route
 * uses, or located within CHECK.onRouteM of it on its floor; unlocated failures count too), near it
 * (within CHECK.pilotCorridorM of MazeMap's pilot route, not used by it) and elsewhere. Only
 * `onPilot` fails the pilot gate; the rest are site checks.
 */
export function pilotScope(net, result) {
  const {nodeById} = prepare(net)
  const route = pilotRoute(net)
  const edgeIds = new Set(route?.edgeIds ?? [])
  const nodeIds = new Set(route?.nodeIds ?? [])
  const segs = []
  for (let i = 1; i < (route?.nodeIds.length ?? 0); i++) segs.push([nodeById.get(route.nodeIds[i - 1]), nodeById.get(route.nodeIds[i])])
  if (route?.start && route.nodeIds.length) segs.unshift([route.start, nodeById.get(route.nodeIds[0])])
  const onRoute = (q) => segs.some(([a, b]) => (a.z === q.z || b.z === q.z || (q.z === 0 && (a.z === 0 || b.z === 0))) && closestOnSegment(q, a, b).d <= CHECK.onRouteM)
  const pts = net.pilot?.mazemap?.points ?? []
  const nearMazeMap = (q) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay, az] = pts[i - 1]
      const [bx, by, bz] = pts[i]
      if (az !== q.z && bz !== q.z) continue
      if (closestOnSegment(q, {x: ax, y: ay}, {x: bx, y: by}).d <= CHECK.pilotCorridorM) return true
    }
    return false
  }
  const onPilot = []
  const nearPilot = []
  const siteChecks = []
  for (const f of result.failures) {
    const locs = []
    if (Number.isFinite(f.x)) locs.push({x: f.x, y: f.y, z: f.z ?? 0})
    for (const id of f.nodeIds ?? []) if (nodeById.has(id)) locs.push(nodeById.get(id))
    const named = (f.edgeIds ?? []).some((id) => edgeIds.has(id)) || (f.nodeIds ?? []).some((id) => nodeIds.has(id))
    if (!locs.length || named || locs.some(onRoute) || !route) onPilot.push(f)
    else if (locs.some(nearMazeMap)) nearPilot.push(f)
    else siteChecks.push(f)
  }
  return {onPilot, nearPilot, siteChecks: [...nearPilot, ...siteChecks]}
}

const pilotRoutes = new WeakMap()
/** The network's pilot route (A* from the pilot start to the pilot room), cached per network. */
export function pilotRoute(net) {
  if (!pilotRoutes.has(net)) pilotRoutes.set(net, net.pilot?.roomNodeId ? routeOnNetwork(net, net.pilot.start, net.pilot.roomNodeId) : null)
  return pilotRoutes.get(net)
}

/** All checks, in the order the task lists them. */
export function runChecks(net) {
  return [checkRoomsReachable(net), checkDoors(net), checkFloorsConnected(net), checkBlockedCrossings(net), checkWalkable(net), checkPilotRoute(net)]
}

/** Every node and edge id named by a failed check (the viewer draws these red). */
export function failedIds(results) {
  const nodes = new Set()
  const edges = new Set()
  for (const r of results) {
    for (const f of r.failures) {
      for (const id of f.nodeIds ?? []) nodes.add(id)
      for (const id of f.edgeIds ?? []) edges.add(id)
    }
  }
  return {nodes, edges}
}
