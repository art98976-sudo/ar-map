// Outdoor walking routes on OpenStreetMap footpath networks (A*).
// On campus, used when MazeMap routing is unavailable, or when its route cuts through buildings
// (GPS does not work indoors, so outdoor AR needs an outdoor path). Off campus, the only router.
import {aStar} from './astar.js'
import {fromLocal, toLocal} from '../geo/geo.js'

// Roads are walkable but we prefer proper footpaths when the detour is small.
const COST = {path: 1, steps: 1.1, road: 1.2, main: 1.5}
const CORRECTION_TYPES = new Set(['path', 'steps', 'ramp', 'road', 'main'])
const INDEX_CELL_M = 25
const CORRECTION_KEY = 'welcomeAR.footpathCorrections.v1'

/** Stable identity for an undirected source edge, independent of its position in the data file. */
export function footpathEdgeId(a, b) {
  const key = ([lat, lng]) => `${Number(lat).toFixed(7)},${Number(lng).toFixed(7)}`
  return [key(a), key(b)].sort().join('|')
}

function validCoordinatePair(point) {
  return Array.isArray(point) && point.length >= 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
}

function correctionNodeKey(lat, lng) {
  return `${lat.toFixed(7)},${lng.toFixed(7)}`
}

function makeEdgeIndex(edges, pts, cellM = INDEX_CELL_M) {
  const cells = new Map()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const a = pts[edge.a]
    const b = pts[edge.b]
    const x0 = Math.floor(Math.min(a.x, b.x) / cellM)
    const x1 = Math.floor(Math.max(a.x, b.x) / cellM)
    const y0 = Math.floor(Math.min(a.y, b.y) / cellM)
    const y1 = Math.floor(Math.max(a.y, b.y) / cellM)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push(i)
      }
    }
  }
  const bounds = pts.reduce((b, p) => ({
    x0: Math.min(b.x0, p.x),
    x1: Math.max(b.x1, p.x),
    y0: Math.min(b.y0, p.y),
    y1: Math.max(b.y1, p.y),
  }), {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity})

  return {
    cellM,
    maxRadiusFrom(p) {
      if (!Number.isFinite(bounds.x0)) return cellM
      return Math.max(
        Math.hypot(p.x - bounds.x0, p.y - bounds.y0),
        Math.hypot(p.x - bounds.x0, p.y - bounds.y1),
        Math.hypot(p.x - bounds.x1, p.y - bounds.y0),
        Math.hypot(p.x - bounds.x1, p.y - bounds.y1),
      ) + cellM
    },
    within(p, radius) {
      const seen = new Set()
      const found = []
      for (let x = Math.floor((p.x - radius) / cellM); x <= Math.floor((p.x + radius) / cellM); x++) {
        for (let y = Math.floor((p.y - radius) / cellM); y <= Math.floor((p.y + radius) / cellM); y++) {
          for (const i of cells.get(`${x},${y}`) ?? []) {
            if (!seen.has(i)) {
              seen.add(i)
              found.push(i)
            }
          }
        }
      }
      return found
    },
  }
}

/** Build a routable graph from OSM data plus explicit, separate manual corrections. */
export function buildGraph(data, corrections = {}) {
  const [s, w, n, e] = data.bbox
  const origin = {lat: (s + n) / 2, lng: (w + e) / 2}
  const pts = data.nodes.map(([lat, lng]) => toLocal(origin, {lat, lng}))
  const coordinates = data.nodes.map((point) => point)
  const nodeByCoordinate = new Map(coordinates.map(([lat, lng], i) => [correctionNodeKey(lat, lng), i]))
  const adj = pts.map(() => [])
  const removed = new Set(corrections.removeEdges ?? [])
  const edges = []
  for (const [a, b, m, type, widthM = null, direction = 'both', wheelchair = null, surface = null] of data.edges) {
    if (removed.has(footpathEdgeId(coordinates[a], coordinates[b]))) continue
    const edgeDirection = ['both', 'forward', 'reverse'].includes(direction) ? direction : 'both'
    const edgeWidthM = Number.isFinite(widthM) && widthM > 0 ? widthM : null
    const cost = m * (COST[type] ?? 1)
    if (edgeDirection !== 'reverse') adj[a].push([b, cost])
    if (edgeDirection !== 'forward') adj[b].push([a, cost])
    edges.push({a, b, cost, length: m, type, direction: edgeDirection, widthM: edgeWidthM, wheelchair, surface, source: 'osm'})
  }

  const getNode = (lng, lat, elevation = 0) => {
    const key = correctionNodeKey(lat, lng)
    if (nodeByCoordinate.has(key)) return nodeByCoordinate.get(key)
    const index = pts.length
    nodeByCoordinate.set(key, index)
    coordinates.push([lat, lng])
    pts.push({...toLocal(origin, {lat, lng}), z: Number.isFinite(elevation) ? elevation : 0})
    adj.push([])
    return index
  }

  for (const feature of corrections.paths ?? []) {
    const coordinates = feature?.geometry?.coordinates
    const props = feature?.properties ?? {}
    if (props.verified !== true || feature?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) continue
    const type = CORRECTION_TYPES.has(props.type) ? props.type : 'path'
    const widthM = Number.isFinite(props.widthM) && props.widthM > 0 ? props.widthM : null
    const direction = ['both', 'forward', 'reverse'].includes(props.direction) ? props.direction : 'both'
    for (let i = 1; i < coordinates.length; i++) {
      const from = coordinates[i - 1]
      const to = coordinates[i]
      if (!validCoordinatePair(from) || !validCoordinatePair(to)) continue
      const a = getNode(from[0], from[1], from[2])
      const b = getNode(to[0], to[1], to[2])
      if (a === b) continue
      const A = pts[a]
      const B = pts[b]
      const length = Math.hypot(B.x - A.x, B.y - A.y)
      if (length < 0.1) continue
      const cost = length * (COST[type] ?? 1)
      const edge = {a, b, cost, length, type, widthM, direction, wheelchair: props.wheelchair ?? null, source: 'correction'}
      edges.push(edge)
      if (direction !== 'reverse') adj[a].push([b, cost])
      if (direction !== 'forward') adj[b].push([a, cost])
    }
  }

  // Keep the manual feature metadata at its node; points do not create an unverified path.
  const nodeFeatures = new Map()
  for (const feature of corrections.points ?? []) {
    const [lng, lat] = feature?.geometry?.coordinates ?? []
    if (feature?.properties?.verified !== true || feature?.geometry?.type !== 'Point' || !validCoordinatePair([lng, lat])) continue
    const node = getNode(lng, lat, feature.geometry.coordinates[2])
    nodeFeatures.set(node, feature.properties ?? {})
  }

  // Components use undirected connectivity even when a corrected edge is one-way.
  const component = new Array(pts.length).fill(-1)
  const connected = pts.map(() => [])
  for (const edge of edges) {
    connected[edge.a].push(edge.b)
    connected[edge.b].push(edge.a)
  }
  const sizes = []
  for (let i = 0; i < pts.length; i++) {
    if (component[i] >= 0) continue
    const id = sizes.length
    let size = 0
    const stack = [i]
    component[i] = id
    while (stack.length) {
      const node = stack.pop()
      size += 1
      for (const next of connected[node]) {
        if (component[next] < 0) {
          component[next] = id
          stack.push(next)
        }
      }
    }
    sizes.push(size)
  }
  const mainComponent = sizes.indexOf(Math.max(...sizes))
  return {origin, pts, adj, edges, component, mainComponent, nodeFeatures, edgeIndex: makeEdgeIndex(edges, pts)}
}

/** Nearest point to p (local metres) on any path, or only on one connected network. */
function snap(graph, p, onlyComponent = null) {
  let best = null
  let radius = graph.edgeIndex.cellM
  const maxRadius = graph.edgeIndex.maxRadiusFrom(p)
  while (true) {
    for (const index of graph.edgeIndex.within(p, radius)) {
      const edge = graph.edges[index]
      if (onlyComponent != null && graph.component[edge.a] !== onlyComponent) continue
      const A = graph.pts[edge.a]
      const B = graph.pts[edge.b]
      const dx = B.x - A.x
      const dy = B.y - A.y
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / len2))
      const x = A.x + dx * t
      const y = A.y + dy * t
      const d = Math.hypot(p.x - x, p.y - y)
      if (d <= radius && (!best || d < best.d)) best = {edge, t, x, y, d}
    }
    if (best) return best
    if (radius >= maxRadius) return null
    radius = Math.min(radius * 2, maxRadius)
  }
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
  const route = routeBetween(graph, pFrom, pTo, s, g)
  if (route) return route
  if (graph.component[s.edge.a] === graph.component[g.edge.a]) return null
  // One end landed on an isolated bit of path. Walk to the main network instead.
  return routeBetween(graph, pFrom, pTo, snap(graph, pFrom, graph.mainComponent), snap(graph, pTo, graph.mainComponent))
}

function routeBetween(graph, pFrom, pTo, s, g) {
  // Both points on one segment can use it directly only in its allowed direction.
  let localPts
  const sameEdgeForward = s.edge.direction !== 'reverse' && s.t <= g.t
  const sameEdgeReverse = s.edge.direction !== 'forward' && s.t >= g.t
  if (s.edge === g.edge && (sameEdgeForward || sameEdgeReverse)) {
    localPts = [pFrom, {x: s.x, y: s.y}, {x: g.x, y: g.y}, pTo]
  } else {
    // Virtual start/goal nodes split their segments, so the route can begin mid-path.
    const START = -1
    const GOAL = -2
    const part = (edge, t, toA) => edge.cost * (toA ? t : 1 - t)
    const neighbours = (node) => {
      if (node === START) {
        const out = []
        if (s.edge.direction !== 'forward') out.push([s.edge.a, part(s.edge, s.t, true)])
        if (s.edge.direction !== 'reverse') out.push([s.edge.b, part(s.edge, s.t, false)])
        return out
      }
      const list = graph.adj[node].slice()
      if (node === g.edge.a && g.edge.direction !== 'reverse') list.push([GOAL, part(g.edge, g.t, true)])
      if (node === g.edge.b && g.edge.direction !== 'forward') list.push([GOAL, part(g.edge, g.t, false)])
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

/** The nearest walkable point to a GPS point: {lat, lng, offsetM}. */
export function nearestOnPaths(graph, p) {
  const hit = snap(graph, toLocal(graph.origin, p), graph.mainComponent)
  return hit ? {...fromLocal(graph.origin, {x: hit.x, y: hit.y}), offsetM: hit.d} : null
}

let townGraphPromise = null
/** Load and build the Stirling-wide graph once (about 290 kB gzipped, only for off-campus trips). */
export function loadTownGraph() {
  townGraphPromise ||= import('../data/town-footpaths.json').then((m) => buildGraph(m.default))
  return townGraphPromise
}

let graphPromise = null
/** Load and build the campus graph once (130 kB JSON, fetched only when needed). */
export function loadCampusGraph() {
  graphPromise ||= Promise.all([
    import('../data/footpaths.json'),
    import('../data/footpath-corrections.json'),
  ]).then(([paths, corrections]) => {
    let active = corrections.default
    try {
      const local = globalThis.localStorage?.getItem(CORRECTION_KEY)
      if (local) active = JSON.parse(local)
    } catch (error) {
      console.warn('[route] local path corrections unavailable', error?.message)
    }
    return buildGraph(paths.default, active)
  })
  return graphPromise
}
