// Outdoor walking routes on the OpenStreetMap campus footpath network (A*).
// Used when MazeMap routing is unavailable, or when its route cuts through buildings
// (GPS does not work indoors, so outdoor AR needs an outdoor path).
import {aStar} from './astar.js'
import {fromLocal, toLocal} from '../geo/geo.js'

// Roads are walkable but we prefer proper footpaths when the detour is small.
const COST = {path: 1, steps: 1.1, road: 1.2}

/** Build a routable graph from footpaths.json data ({nodes: [[lat,lng]], edges: [[a,b,m,type]]}). */
export function buildGraph(data) {
  const [s, w, n, e] = data.bbox
  const origin = {lat: (s + n) / 2, lng: (w + e) / 2}
  const pts = data.nodes.map(([lat, lng]) => toLocal(origin, {lat, lng}))
  const adj = pts.map(() => [])
  const edges = data.edges.map(([a, b, m, type]) => {
    const cost = m * (COST[type] ?? 1)
    adj[a].push([b, cost])
    adj[b].push([a, cost])
    return {a, b, cost, length: m}
  })
  return {origin, pts, adj, edges}
}

/** Nearest point on any path to p (local metres). */
function snap(graph, p) {
  let best = null
  for (const edge of graph.edges) {
    const A = graph.pts[edge.a]
    const B = graph.pts[edge.b]
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / len2))
    const x = A.x + dx * t
    const y = A.y + dy * t
    const d = Math.hypot(p.x - x, p.y - y)
    if (!best || d < best.d) best = {edge, t, x, y, d}
  }
  return best
}

/**
 * Walking route between two GPS points.
 * Returns {points: [{lat,lng}], lengthM, snapStartM, snapEndM} or null if no path connects them.
 */
export function routeOnFootpaths(graph, from, to) {
  const pFrom = toLocal(graph.origin, from)
  const pTo = toLocal(graph.origin, to)
  const s = snap(graph, pFrom)
  const g = snap(graph, pTo)
  if (!s || !g) return null

  // Both points on the same path segment: walk straight along it.
  let localPts
  if (s.edge === g.edge) {
    localPts = [pFrom, {x: s.x, y: s.y}, {x: g.x, y: g.y}, pTo]
  } else {
    // Virtual start/goal nodes split their segments, so the route can begin mid-path.
    const START = -1
    const GOAL = -2
    const part = (edge, t, toA) => edge.cost * (toA ? t : 1 - t)
    const neighbours = (node) => {
      if (node === START) return [[s.edge.a, part(s.edge, s.t, true)], [s.edge.b, part(s.edge, s.t, false)]]
      const list = graph.adj[node].slice()
      if (node === g.edge.a) list.push([GOAL, part(g.edge, g.t, true)])
      if (node === g.edge.b) list.push([GOAL, part(g.edge, g.t, false)])
      return list
    }
    const heuristic = (node) => {
      if (node < 0) return 0
      const q = graph.pts[node]
      return Math.hypot(q.x - g.x, q.y - g.y)
    }
    const found = aStar({start: START, goal: GOAL, neighbours, heuristic})
    if (!found) return null
    localPts = [pFrom, {x: s.x, y: s.y}, ...found.path.filter((n) => n >= 0).map((n) => graph.pts[n]), {x: g.x, y: g.y}, pTo]
  }

  let length = 0
  for (let i = 1; i < localPts.length; i++) length += Math.hypot(localPts[i].x - localPts[i - 1].x, localPts[i].y - localPts[i - 1].y)
  return {
    points: localPts.map((p) => fromLocal(graph.origin, p)),
    lengthM: length,
    snapStartM: s.d,
    snapEndM: g.d,
  }
}

let graphPromise = null
/** Load and build the campus graph once (130 kB JSON, fetched only when needed). */
export function loadCampusGraph() {
  graphPromise ||= import('../data/footpaths.json').then((m) => buildGraph(m.default))
  return graphPromise
}
