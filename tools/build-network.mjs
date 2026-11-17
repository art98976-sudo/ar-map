// Builds src/data/campus-network.json: ONE walking network, inside and outside, for the pilot
// building and route in tools/network-pilot.json. Generated only: no hand-drawn indoor geometry.
//
//   npm run build:network               fetch what is missing (cached in tools/.cache/), then build
//   npm run build:network -- --offline  build from the cache only (fails if anything is missing)
//
// Sources:
//   - indoor geometry: MazeMap floor tiles (walls, doors, stairs, lifts, outlines), every floor of
//     the building, decoded by src/ar/mazemap-floor.js;
//   - indoor edges: MazeMap routing between every pair of exterior doors, stairs, lifts and pilot
//     rooms, merged into one graph (points within 0.5 m on a floor are one node). A level change
//     is a stair or lift only when MazeMap's own route flags say so (STAIR / ELEVATOR), or when
//     exactly one kind of shaft lies under it; anything else is reported, never guessed;
//   - outdoor edges: src/data/footpaths.json (OSM) + verified src/data/footpath-corrections.json;
//   - blocked areas outdoors: OSM buildings, water, walls, fences, hedges, planting (Overpass);
//   - joins: each exterior door to the nearest outdoor path within 5 m, else an error.
// Frame: metres east (x) / north (y) of the campus model's origin (CAMPUS_ORIGIN, 56.1455 -3.92),
// z = MazeMap floor (0 outdoors), heightM from src/data/floor-heights.json (placeholders).
// MazeMap requests are throttled (2 a second) and cached, so a rerun makes no requests.
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {VectorTile} from '@mapbox/vector-tile'
import {PbfReader} from 'pbf'
import {decodeFloorTile, mergeFloor, tilesFor, tileUrl} from '../src/ar/mazemap-floor.js'
import {CAMPUS_ORIGIN} from '../src/map/campus-geo.js'
import {fromLocal, toLocal} from '../src/geo/geo.js'
import {buildGraph, footpathEdgeId} from '../src/route/footpaths.js'
import {
  closestOnSegment,
  createBoxIndex,
  dist,
  insidePolygon,
  polygonBoundaryDistance,
  ringCentroid,
  ringDistance,
  segmentQuad,
} from '../src/network/network-geometry.js'

export const SCHEMA_VERSION = 1
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const pilot = readJson('tools/network-pilot.json')
const floorHeights = readJson('src/data/floor-heights.json')
const footpaths = readJson('src/data/footpaths.json')
const corrections = readJson('src/data/footpath-corrections.json')
const campusBoundary = readJson('src/data/campus-boundary.json')
const destinations = readJson('src/data/destinations.json')

const OFFLINE = process.argv.includes('--offline')
const RATE = Number(/--rate=(\d+(?:\.\d+)?)/.exec(process.argv.join(' '))?.[1] ?? 2) // requests a second
const CACHE = join(root, 'tools', '.cache')
const BUILDING_ID = pilot.building.id
const FLOORS = pilot.building.floors

// Tolerances (metres).
const SNAP_M = 0.5 // route points this close on one floor are one node
const SPLIT_M = 0.25 // a node this close to another edge's middle splits it
const EXTERIOR_DOOR_M = 0.6 // a door line's centre this close to the building outline is an exterior door
const DOOR_MERGE_M = 1.2 // door lines this close are one doorway (double doors)
const DOOR_NODE_M = 1.5 // a door is on the network when a route node lies this close to its centre
const SHAFT_MERGE_M = 2 // stair / lift shapes on one floor this close are one anchor
const JOIN_M = 5 // a door joins the outdoor network only within this distance
const ROOM_NODE_M = 3 // a room is on the network when a route node lies this close to its point
const BARRIER_HALF_M = 0.15 // walls, fences and hedges are drawn this wide each side

const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const L = (lng, lat) => toLocal(CAMPUS_ORIGIN, {lat, lng})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- fetching: throttled, retried, cached ----------
const stats = {requests: 0, cached: 0, failed: 0}
let nextStart = 0
async function gate() {
  const now = Date.now()
  const at = Math.max(now, nextStart)
  nextStart = at + 1000 / RATE
  if (at > now) await sleep(at - now)
}

function cacheFile(kind, key, ext) {
  const dir = join(CACHE, kind)
  mkdirSync(dir, {recursive: true})
  return join(dir, createHash('sha1').update(key).digest('hex').slice(0, 24) + ext)
}

async function fetchRetry(url, init = {}, {timeoutMs = 25000, attempts = 5} = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    await gate()
    try {
      const res = await fetch(url, {...init, signal: AbortSignal.timeout(timeoutMs)})
      stats.requests += 1
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      await sleep(1000 * (attempt + 1))
    }
  }
  throw lastError
}

/** JSON from a URL, cached. Client errors (4xx) are cached too: asking again would not help. */
async function cachedJson(kind, url, init, options) {
  const file = cacheFile(kind, url + (init?.body ?? ''), '.json')
  if (existsSync(file)) {
    stats.cached += 1
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  if (OFFLINE) throw new Error(`--offline and not cached: ${url}`)
  const res = await fetchRetry(url, init, options)
  const out = res.ok ? {ok: true, status: res.status, json: await res.json()} : {ok: false, status: res.status}
  writeFileSync(file, JSON.stringify(out))
  return out
}

/** A floor tile (binary), cached. A missing tile (no building there) is cached as empty. */
async function cachedTile(url) {
  const file = cacheFile('tiles', url, '.mvt')
  if (existsSync(file)) {
    stats.cached += 1
    const buf = readFileSync(file)
    return buf.length ? buf : null
  }
  if (OFFLINE) throw new Error(`--offline and not cached: ${url}`)
  const res = await fetchRetry(url)
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0)
  writeFileSync(file, buf)
  return buf.length ? buf : null
}

async function pool(items, workers, fn) {
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({length: workers}, run))
}

// ---------- MazeMap ----------
const poi = async (id) => {
  const r = await cachedJson('mazemap-poi', `https://api.mazemap.com/api/pois/${id}/?srid=4326`)
  if (!r.ok) throw new Error(`MazeMap POI ${id}: HTTP ${r.status}`)
  const c = r.json.point?.coordinates ?? r.json.geometry?.coordinates
  return {poiId: id, name: r.json.title ?? String(id), lng: c[0], lat: c[1], z: r.json.z}
}

function routeUrl(a, b) {
  const f = (v) => Number(v).toFixed(7)
  const q = new URLSearchParams({
    srid: '4326',
    hc: 'false',
    sourcelat: f(a.lat),
    sourcelon: f(a.lng),
    sourcez: String(a.z),
    targetlat: f(b.lat),
    targetlon: f(b.lng),
    targetz: String(b.z),
    lang: 'en',
    distanceunitstype: 'metric',
    mode: 'PEDESTRIAN',
  })
  return `https://routing.mazemap.com/routing/path/?${q}`
}

const LIFT_FLAG = /ELEVATOR|LIFT/i
const STAIR_FLAG = /STAIR/i

/**
 * A MazeMap route's stretches inside the pilot building, as polylines of {x, y, z, flags, door}.
 * flags: the flags of the route feature that leads to the point. door: the point where the route
 * came in from outdoors (the threshold of an exterior door).
 */
function indoorPolylines(json) {
  const out = []
  const entries = []
  const links = []
  let cur = null
  // MazeMap's outdoor stretches that touch the pilot building: how its routes reach the doors.
  const outdoorRuns = []
  let run = null
  let prevBuilding
  for (const f of json?.path?.features ?? []) {
    const b = f.properties?.buildingId ?? null
    const z = f.properties?.z
    const flags = f.properties?.flags ?? []
    const coords = f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates.flat() : (f.geometry?.coordinates ?? [])
    if (b === null) {
      if (!run) run = {points: [], startsAtBuilding: prevBuilding === BUILDING_ID}
      for (const c of coords) run.points.push(L(c[0], c[1]))
    } else if (run) {
      run.endsAtBuilding = b === BUILDING_ID
      if (run.startsAtBuilding || run.endsAtBuilding) outdoorRuns.push(run)
      run = null
    }
    if (b !== BUILDING_ID) {
      if (cur && cur.length > 1) out.push(cur)
      if (cur && b != null && coords[0]) links.push({toBuilding: b, ...L(coords[0][0], coords[0][1])})
      cur = null
      prevBuilding = b
      continue
    }
    for (let k = 0; k < coords.length; k++) {
      const p = {...L(coords[k][0], coords[k][1]), z, flags}
      if (!cur) {
        cur = []
        if (prevBuilding === null) {
          p.door = true
          entries.push(p)
        }
      }
      const last = cur.at(-1)
      if (last && dist(last, p) < 0.01 && last.z === z) continue
      cur.push(p)
    }
    prevBuilding = b
  }
  if (cur && cur.length > 1) out.push(cur)
  if (run?.startsAtBuilding) outdoorRuns.push({...run, endsAtBuilding: false})
  return {polylines: out, entries, links, outdoorRuns}
}

// ---------- the building and its floors ----------
console.log(`Pilot: ${pilot.route.name}`)
const bRes = await cachedJson('mazemap-building', `https://api.mazemap.com/api/buildings/${BUILDING_ID}/?srid=4326`)
if (!bRes.ok) throw new Error(`MazeMap building ${BUILDING_ID}: HTTP ${bRes.status}`)
const outlineGeom = bRes.json.fullOutline ?? bRes.json.visibleOutline
const outlineLngLat = outlineGeom.type === 'Polygon' ? [outlineGeom.coordinates] : outlineGeom.coordinates
const buildingPolys = outlineLngLat.map((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => L(lng, lat))))
const inBuilding = (p, slackM = 1) => buildingPolys.some((pl) => insidePolygon(p, pl) || polygonBoundaryDistance(p, pl) < slackM)
const mazemapFloors = Object.fromEntries((bRes.json.floors ?? []).map((f) => [f.z, f.name]))
// MazeMap's building record can miss a level its tiles and routes have (Cottrell: -1). Kept, and said.
const missingFloors = FLOORS.filter((z) => !(z in mazemapFloors))

const allLngLat = outlineLngLat.flat(2)
const box = {
  west: Math.min(...allLngLat.map((p) => p[0])) - 0.0003,
  east: Math.max(...allLngLat.map((p) => p[0])) + 0.0003,
  south: Math.min(...allLngLat.map((p) => p[1])) - 0.0002,
  north: Math.max(...allLngLat.map((p) => p[1])) + 0.0002,
}

const errors = []
const warnings = []
for (const z of missingFloors) warnings.push({kind: 'floor-not-in-building-record', z, message: `Level ${z} is not in MazeMap's floor list for this building, but its tiles and routes have it`})
const floors = {}
for (const z of FLOORS) {
  const parts = []
  const areaFill = [] // MazeMap's floor area fills (corridors, halls): read here, not by the app
  for (const t of tilesFor(box)) {
    const buf = await cachedTile(tileUrl(z, t))
    if (!buf) continue
    parts.push(decodeFloorTile(buf, t))
    const layer = new VectorTile(new PbfReader(new Uint8Array(buf))).layers['area-fill']
    for (let i = 0; layer && i < layer.length; i++) {
      const g = layer.feature(i).toGeoJSON(t.x, t.y, t.z).geometry
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      for (const polygon of polys) areaFill.push({id: layer.feature(i).properties.id, polygon})
    }
  }
  const raw = mergeFloor(parts)
  const poly = (polygon) => polygon.map((ring) => ring.map(([lng, lat]) => L(lng, lat)))
  const keep = (list) => list.map((s) => ({id: s.id, polygon: poly(s.polygon)})).filter((s) => inBuilding(ringCentroid(s.polygon[0])))
  const doors = raw.doors
    .map((d) => ({id: d.id, a: L(...d.line[0]), b: L(...d.line.at(-1))}))
    .map((d) => ({...d, centre: {x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2}, widthM: dist(d.a, d.b)}))
    .filter((d) => inBuilding(d.centre))
  for (const d of doors) {
    let near = Infinity
    let courtyard = false
    for (const pl of buildingPolys) {
      pl.forEach((ring, i) => {
        const dd = ringDistance(d.centre, ring)
        if (dd < near) {
          near = dd
          courtyard = i > 0
        }
      })
    }
    d.exterior = near < EXTERIOR_DOOR_M
    d.courtyard = d.exterior && courtyard
  }
  floors[z] = {
    walls: keep(raw.walls),
    outlines: keep(raw.outlines),
    // MazeMap's room shapes include corridors and halls: with the outlines, the walkable floor.
    rooms: keep(raw.rooms),
    areas: keep(areaFill),
    stairs: keep(raw.stairs),
    lifts: keep(raw.lifts),
    doors,
  }
  const f = floors[z]
  console.log(`Level ${z}: ${f.walls.length} walls, ${f.doors.length} door lines (${f.doors.filter((d) => d.exterior).length} exterior), ${f.stairs.length} stairs, ${f.lifts.length} lifts, ${f.outlines.length} outline pieces`)
  if (!f.outlines.length) errors.push({kind: 'no-floor-outline', z, message: `Level ${z}: MazeMap has no floor outline in this building`})
}

/** Group points closer than m on one floor (first point of a group is its anchor). */
function groupByDistance(items, m, at) {
  const groups = []
  for (const it of items) {
    const g = groups.find((gr) => dist(at(gr[0]), at(it)) < m)
    if (g) g.push(it)
    else groups.push([it])
  }
  return groups
}

// ---------- anchors: what MazeMap routes between ----------
const anchors = []
for (const z of FLOORS) {
  const f = floors[z]
  for (const g of groupByDistance(f.doors.filter((d) => d.exterior), DOOR_MERGE_M, (d) => d.centre)) {
    const c = {x: g.reduce((s, d) => s + d.centre.x, 0) / g.length, y: g.reduce((s, d) => s + d.centre.y, 0) / g.length}
    anchors.push({kind: 'door', z, ...c, widthM: Math.max(...g.map((d) => d.widthM)), courtyard: g.some((d) => d.courtyard), mazemapDoorIds: [...new Set(g.map((d) => d.id))]})
  }
  for (const kind of ['stairs', 'lifts']) {
    const shapes = f[kind].map((s) => ({...s, c: ringCentroid(s.polygon[0])}))
    for (const g of groupByDistance(shapes, SHAFT_MERGE_M, (s) => s.c)) anchors.push({kind: kind === 'lifts' ? 'lift' : 'stairs', z, ...g[0].c})
  }
}
const rooms = []
for (const r of pilot.rooms) {
  const p = await poi(r.poiId)
  rooms.push({...p, name: r.name ?? p.name})
  anchors.push({kind: 'room', z: p.z, ...L(p.lng, p.lat), poiId: r.poiId, name: r.name ?? p.name})
}
const order = {door: 0, room: 1, lift: 2, stairs: 3}
anchors.sort((a, b) => order[a.kind] - order[b.kind] || a.z - b.z || a.x - b.x || a.y - b.y)
for (const a of anchors) Object.assign(a, fromLocal(CAMPUS_ORIGIN, a))
const pairs = []
for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) pairs.push([i, j])
// --max-pairs=N: a quick smoke run on the first N pairs (the output is then incomplete).
const MAX_PAIRS = Number(/--max-pairs=(\d+)/.exec(process.argv.join(' '))?.[1] ?? Infinity)
if (pairs.length > MAX_PAIRS) pairs.length = MAX_PAIRS
const counts = Object.fromEntries(Object.keys(order).map((k) => [k, anchors.filter((a) => a.kind === k).length]))
console.log(`Anchors: ${JSON.stringify(counts)} -> ${pairs.length} MazeMap routes (${RATE}/s when not cached)`)

// ---------- route every pair ----------
const routes = new Array(pairs.length)
let done = 0
await pool(pairs, 3, async ([i, j], n) => {
  const a = anchors[i]
  const b = anchors[j]
  try {
    const r = await cachedJson('mazemap-route', routeUrl(a, b))
    routes[n] = r.ok ? r.json : null
    if (!r.ok) {
      stats.failed += 1
      warnings.push({kind: 'route-failed', message: `MazeMap gave HTTP ${r.status} for ${a.kind} (level ${a.z}) to ${b.kind} (level ${b.z})`, x: round(a.x), y: round(a.y), z: a.z})
    }
  } catch (err) {
    stats.failed += 1
    routes[n] = null
    warnings.push({kind: 'route-failed', message: `MazeMap route ${a.kind} (level ${a.z}) to ${b.kind} (level ${b.z}): ${err.message}`, x: round(a.x), y: round(a.y), z: a.z})
  }
  done += 1
  if (done % 250 === 0) console.log(`  ${done}/${pairs.length} routes (${stats.requests} requests, ${stats.cached} cached)`)
})

// The pilot route itself: MazeMap's reference for length and entrance.
const startPoint = pilot.route.start
const targetRoom = rooms.find((r) => r.poiId === pilot.route.toPoiId) ?? (await poi(pilot.route.toPoiId))
const pilotRes = await cachedJson('mazemap-route', routeUrl(startPoint, targetRoom))
if (!pilotRes.ok) throw new Error(`MazeMap pilot route: HTTP ${pilotRes.status}`)
const pilotIndoor = indoorPolylines(pilotRes.json)

// ---------- merge the routes into one indoor graph ----------
const nodes = [] // {id, x, y, z, ...}
const nodeIndex = new Map() // node -> its index in nodes, for stable edge keys
const nodeGrid = new Map()
const gridKey = (z, i, j) => `${z}|${i}|${j}`
function newNode(props) {
  const n = {id: null, ...props}
  nodeIndex.set(n, nodes.length)
  nodes.push(n)
  return n
}
function nodeAt(p) {
  const i = Math.floor(p.x / SNAP_M)
  const j = Math.floor(p.y / SNAP_M)
  let best = null
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const n of nodeGrid.get(gridKey(p.z, i + di, j + dj)) ?? []) {
        const d = dist(n, p)
        if (d <= SNAP_M && (!best || d < best.d)) best = {n, d}
      }
    }
  }
  if (best) return best.n
  const n = newNode({x: p.x, y: p.y, z: p.z, building: p.z === 0 ? null : BUILDING_ID, type: 'path'})
  const k = gridKey(p.z, i, j)
  if (!nodeGrid.has(k)) nodeGrid.set(k, [])
  nodeGrid.get(k).push(n)
  return n
}

const edgeMap = new Map() // "a|b" -> edge
const edgeKey = (a, b) => [nodeIndex.get(a), nodeIndex.get(b)].sort((x, y) => x - y).join('|')
const flagsSeen = new Set()
/** An edge's properties without its ends and use count, to copy onto the pieces of a split edge. */
function edgeProps(e) {
  const props = {...e}
  delete props.from
  delete props.to
  delete props.uses
  return props
}

function addEdge(a, b, props) {
  if (a === b) return null
  const key = edgeKey(a, b)
  const old = edgeMap.get(key)
  if (old) {
    old.uses += 1
    if (props.stepFree === false) old.stepFree = false
    return old
  }
  const e = {from: a, to: b, uses: 1, ...props}
  edgeMap.set(key, e)
  return e
}

/** Stair / lift kinds whose shape is at p (inside, or within m) on floor z. */
function shaftKindsAt(p, z, m = 1.5) {
  const kinds = new Set()
  for (const [kind, list] of [['stairs', floors[z]?.stairs ?? []], ['lift', floors[z]?.lifts ?? []]]) {
    if (list.some((s) => insidePolygon(p, s.polygon) || polygonBoundaryDistance(p, s.polygon) < m)) kinds.add(kind)
  }
  return kinds
}

const thresholds = []
const ambiguousSeen = new Set()
function mergePolyline(line) {
  let prev = null
  for (const p of line) {
    for (const fl of p.flags ?? []) flagsSeen.add(fl)
    const n = nodeAt(p)
    if (p.door) thresholds.push(n)
    if (prev && prev !== n) {
      if (prev.z === n.z) {
        addEdge(prev, n, {type: 'corridor', source: 'mazemap', stepFree: !(p.flags ?? []).includes('NO_HC')})
      } else {
        const flags = p.flags ?? []
        let kind = flags.some((f) => LIFT_FLAG.test(f)) ? 'lift' : flags.some((f) => STAIR_FLAG.test(f)) ? 'stairs' : null
        let how = 'mazemap-flag'
        if (!kind) {
          const k = new Set([...shaftKindsAt(prev, prev.z), ...shaftKindsAt(n, n.z)])
          if (k.size === 1) {
            kind = [...k][0]
            how = 'shaft-shape'
          }
        }
        if (!kind) {
          const key = edgeKey(prev, n)
          if (!ambiguousSeen.has(key)) {
            ambiguousSeen.add(key)
            errors.push({kind: 'ambiguous-level-change', message: `Level ${prev.z} to ${n.z}: MazeMap gives no stair/lift flag and no single stair or lift shape is there`, x: round(prev.x), y: round(prev.y), z: prev.z, flags})
          }
        } else {
          addEdge(prev, n, {type: kind, source: 'mazemap', stepFree: kind === 'lift', levelChangeFrom: how})
        }
      }
    }
    prev = n
  }
}

const buildingLinks = new Map()
const outdoorRuns = []
// Where routes to (or from) a room end: MazeMap stops at the room's door, not at its centre.
const roomEnds = new Map() // poiId -> Map(node -> count)
const merged = [
  ...routes.map((json, n) => {
    const [i, j] = pairs[n]
    const room = anchors[j].kind === 'room' ? {poiId: anchors[j].poiId, at: 'end'} : anchors[i].kind === 'room' ? {poiId: anchors[i].poiId, at: 'start'} : null
    return {json, room}
  }),
  {json: pilotRes.json, room: {poiId: pilot.route.toPoiId, at: 'end'}},
]
for (const {json, room} of merged) {
  if (!json) continue
  const {polylines, links, outdoorRuns: runs} = indoorPolylines(json)
  for (const line of polylines) mergePolyline(line)
  for (const l of links) buildingLinks.set(l.toBuilding, l)
  outdoorRuns.push(...runs)
  if (room && polylines.length) {
    const p = room.at === 'end' ? polylines.at(-1).at(-1) : polylines[0][0]
    const n = nodeAt(p)
    if (!roomEnds.has(room.poiId)) roomEnds.set(room.poiId, new Map())
    const m = roomEnds.get(room.poiId)
    m.set(n, (m.get(n) ?? 0) + 1)
  }
}
for (const [b, l] of buildingLinks) warnings.push({kind: 'building-link', message: `Routes leave the pilot building straight into MazeMap building ${b} (not part of this network)`, x: round(l.x), y: round(l.y)})

// Split an edge where another route's node sits in its middle (a T-junction).
{
  const horizontal = [...edgeMap.values()].filter((e) => e.from.z === e.to.z)
  const index = createBoxIndex(horizontal.map((e) => ({e, box: {x0: Math.min(e.from.x, e.to.x), y0: Math.min(e.from.y, e.to.y), x1: Math.max(e.from.x, e.to.x), y1: Math.max(e.from.y, e.to.y)}})), 5)
  const splits = new Map()
  for (const n of nodes) {
    for (const {e} of index.near(n, n, SPLIT_M)) {
      if (e.from.z !== n.z || e.from === n || e.to === n) continue
      const c = closestOnSegment(n, e.from, e.to)
      if (c.d <= SPLIT_M && c.t > 0.01 && c.t < 0.99) {
        if (!splits.has(e)) splits.set(e, [])
        splits.get(e).push({n, t: c.t})
      }
    }
  }
  for (const [e, list] of splits) {
    edgeMap.delete(edgeKey(e.from, e.to))
    const chain = [e.from, ...list.sort((p, q) => p.t - q.t).map((s) => s.n), e.to]
    const props = edgeProps(e)
    for (let k = 1; k < chain.length; k++) addEdge(chain[k - 1], chain[k], props)
  }
  console.log(`Indoor: ${nodes.length} nodes, ${edgeMap.size} edges (${splits.size} split at junctions)`)
}

// Stair and lift ends.
for (const e of edgeMap.values()) {
  if (e.type === 'stairs' || e.type === 'lift') {
    e.from.type = e.type
    e.to.type = e.type
  }
}

// Doors: the route node at each exterior doorway.
const nearestNode = (p, z, maxM) => {
  let best = null
  for (const n of nodes) {
    if (n.z !== z) continue
    const d = dist(n, p)
    if (d <= maxM && (!best || d < best.d)) best = {n, d}
  }
  return best
}
const doorNodes = []
for (const a of anchors.filter((x) => x.kind === 'door')) {
  const hit = nearestNode(a, a.z, DOOR_NODE_M)
  let n = hit?.n
  if (!n) {
    n = newNode({x: a.x, y: a.y, z: a.z, building: BUILDING_ID, type: 'door'})
    errors.push({kind: 'door-not-on-network', message: `Exterior door on level ${a.z}: no MazeMap route passes within ${DOOR_NODE_M} m`, x: round(a.x), y: round(a.y), z: a.z})
  }
  if (n.type === 'stairs' || n.type === 'lift') warnings.push({kind: 'door-at-shaft', message: `A door node is also a ${n.type} end`, x: round(n.x), y: round(n.y), z: n.z})
  if (hit && n.type === 'door') {
    // Two door lines resolved to one node: keep the first, note the other.
    warnings.push({kind: 'doors-share-node', message: `Two exterior doorways resolve to one network node`, x: round(n.x), y: round(n.y), z: n.z})
    continue
  }
  n.type = 'door'
  n.door = {widthM: round(a.widthM), courtyard: a.courtyard, mazemapDoorIds: a.mazemapDoorIds, offsetM: round(hit?.d ?? 0)}
  doorNodes.push(n)
}
// A route threshold (where MazeMap walks in from outdoors) with no exterior door line near it.
// A threshold with door lines right at it is an exterior door too: recessed entrances (under a
// canopy) sit metres inside MazeMap's building outline, where the outline rule cannot see them.
for (const n of new Set(thresholds)) {
  if (n.type === 'door' || doorNodes.some((d) => d.z === n.z && dist(d, n) <= DOOR_NODE_M)) continue
  const lines = (floors[n.z]?.doors ?? []).filter((d) => closestOnSegment(n, d.a, d.b).d <= DOOR_NODE_M)
  if (!lines.length) continue
  if (n.type === 'stairs' || n.type === 'lift') warnings.push({kind: 'door-at-shaft', message: `A door node is also a ${n.type} end`, x: round(n.x), y: round(n.y), z: n.z})
  n.type = 'door'
  n.door = {widthM: round(Math.max(...lines.map((d) => d.widthM))), courtyard: false, mazemapDoorIds: [...new Set(lines.map((d) => d.id))], offsetM: 0, from: 'mazemap-threshold'}
  doorNodes.push(n)
}
for (const n of new Set(thresholds)) {
  if (!doorNodes.some((d) => d.z === n.z && dist(d, n) <= DOOR_NODE_M)) warnings.push({kind: 'threshold-without-door', message: `MazeMap walks in from outdoors here, but no exterior door line is within ${DOOR_NODE_M} m`, x: round(n.x), y: round(n.y), z: n.z})
}

// Entrances: the door(s) MazeMap's pilot route enters by, and the destination's suggested entrance.
const entranceDoors = new Set()
const pilotEntranceDoors = new Set()
for (const p of pilotIndoor.entries) {
  const hit = doorNodes.map((n) => ({n, d: n.z === p.z ? dist(n, p) : Infinity})).sort((x, y) => x.d - y.d)[0]
  if (hit && hit.d <= DOOR_NODE_M) {
    entranceDoors.add(hit.n)
    pilotEntranceDoors.add(hit.n)
  } else {
    errors.push({kind: 'pilot-entrance-not-a-door', message: `MazeMap's pilot route enters on level ${p.z} where no exterior door node is within ${DOOR_NODE_M} m`, x: round(p.x), y: round(p.y), z: p.z})
  }
}
const suggested = destinations.destinations.find((d) => d.building === pilot.building.name && d.entrance && d.id === pilot.building.name.split(' ')[0].toLowerCase())
if (suggested) {
  const e = L(suggested.entrance.lng, suggested.entrance.lat)
  const hit = doorNodes.map((n) => ({n, d: dist(n, e)})).sort((x, y) => x.d - y.d)[0]
  if (hit && hit.d <= JOIN_M) entranceDoors.add(hit.n)
  else warnings.push({kind: 'suggested-entrance-not-a-door', message: `destinations.json entrance for ${suggested.name} has no exterior door within ${JOIN_M} m`, x: round(e.x), y: round(e.y), z: 0})
}
for (const n of entranceDoors) n.type = 'entrance'

// Rooms.
const roomNodes = []
for (const r of rooms) {
  const p = L(r.lng, r.lat)
  // The node MazeMap's routes to this room end at (most often), else a node next to its point.
  const ends = [...(roomEnds.get(r.poiId) ?? new Map())].filter(([n]) => n.z === r.z).sort((a, b) => b[1] - a[1] || dist(a[0], p) - dist(b[0], p))
  const near = nearestNode(p, r.z, ROOM_NODE_M)
  const n = ends[0]?.[0] ?? near?.n
  if (!n) {
    errors.push({kind: 'room-not-on-network', message: `${r.name}: no MazeMap route ends at the room on level ${r.z}, and no node is within ${ROOM_NODE_M} m of it`, x: round(p.x), y: round(p.y), z: r.z})
    continue
  }
  const offset = dist(n, p)
  if (offset > 15) warnings.push({kind: 'room-far-from-point', message: `${r.name}: routes end ${offset.toFixed(1)} m from the room's point`, x: round(n.x), y: round(n.y), z: n.z})
  n.type = 'room'
  n.room = {poiId: r.poiId, name: r.name, offsetM: round(offset), from: ends.length ? 'route-ends' : 'nearest-node', routesEndingHere: ends[0]?.[1] ?? 0}
  roomNodes.push(n)
}

// ---------- outdoor: OSM footpaths + verified corrections ----------
const startLocal = L(startPoint.lng, startPoint.lat)
const pilotPts = (pilotRes.json.path?.features ?? []).flatMap((f) => (f.geometry?.coordinates ?? []).map(([lng, lat]) => L(lng, lat)))
const allPts = [...pilotPts, ...buildingPolys.flat(2), startLocal]
const margin = pilot.outdoorMarginM ?? 150
const area = {
  x0: Math.min(...allPts.map((p) => p.x)) - margin,
  x1: Math.max(...allPts.map((p) => p.x)) + margin,
  y0: Math.min(...allPts.map((p) => p.y)) - margin,
  y1: Math.max(...allPts.map((p) => p.y)) + margin,
}
const campusRing = campusBoundary.geometry.coordinates[0].map(([lng, lat]) => L(lng, lat))
const inArea = (p) => p.x >= area.x0 && p.x <= area.x1 && p.y >= area.y0 && p.y <= area.y1 && insidePolygon(p, [campusRing])
const areaSW = fromLocal(CAMPUS_ORIGIN, {x: area.x0, y: area.y0})
const areaNE = fromLocal(CAMPUS_ORIGIN, {x: area.x1, y: area.y1})
const bbox = [areaSW.lat, areaSW.lng, areaNE.lat, areaNE.lng].map((v) => v.toFixed(6)).join(',')

// OSM: blocked areas, gaps in barriers, and which footpaths are bridges / covered passages.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
const overpassQuery = `[out:json][timeout:90];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["natural"~"^(water|scrub|wetland)$"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
  way["landuse"="flowerbed"](${bbox});
  way["barrier"~"^(wall|fence|hedge|retaining_wall|city_wall|guard_rail|handrail)$"](${bbox});
  node["barrier"](${bbox});
  way["highway"]["bridge"](${bbox});
  way["highway"]["tunnel"](${bbox});
  way["highway"]["covered"](${bbox});
  way["highway"]["indoor"](${bbox});
);
out geom;`
let osm = null
for (const url of OVERPASS) {
  try {
    const r = await cachedJson('overpass', url, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'StirlingWelcomeAR/0.1 (campus network build script)'}, body: `data=${encodeURIComponent(overpassQuery)}`}, {timeoutMs: 120000, attempts: 2})
    if (r.ok) {
      osm = r.json
      break
    }
  } catch (err) {
    console.warn(`${url} failed (${err.message}), trying the next server`)
  }
}
if (!osm) errors.push({kind: 'no-osm-blocked-areas', message: 'Overpass did not answer: outdoor blocked areas (walls, water, planting) are missing'})

const blocked = []
const openings = []
const passages = new Map() // footpathEdgeId -> 'bridge' | 'covered' | 'tunnel' | 'indoor'
const GAP_BARRIERS = /^(gate|entrance|kissing_gate|lift_gate|swing_gate|bollard|stile|turnstile|cycle_barrier|block|chain|full-height_turnstile|sliding_gate|wicket_gate)$/
const ringOf = (geometry) => geometry.map((g) => L(g.lon, g.lat))
const isClosed = (ring) => ring.length > 3 && dist(ring[0], ring.at(-1)) < 0.01
for (const el of osm?.elements ?? []) {
  const tags = el.tags ?? {}
  if (el.type === 'node') {
    if (GAP_BARRIERS.test(tags.barrier ?? '')) openings.push({...L(el.lon, el.lat), kind: tags.barrier, osmId: el.id})
    continue
  }
  if (el.type === 'way' && tags.highway) {
    const g = el.geometry ?? []
    const kind = tags.bridge && tags.bridge !== 'no' ? 'bridge' : tags.tunnel && tags.tunnel !== 'no' ? 'tunnel' : tags.indoor && tags.indoor !== 'no' ? 'indoor' : tags.covered && tags.covered !== 'no' ? 'covered' : null
    if (kind) for (let i = 1; i < g.length; i++) passages.set(footpathEdgeId([g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]), kind)
    continue
  }
  const kind = tags.building ? 'building' : tags.natural === 'water' || tags.natural === 'wetland' || tags.waterway === 'riverbank' ? 'water' : tags.natural === 'scrub' || tags.landuse === 'flowerbed' ? 'planting' : tags.barrier ? tags.barrier : null
  if (!kind) continue
  const ways = el.type === 'relation' ? (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry) : [el.geometry ?? []]
  for (const g of ways) {
    const ring = ringOf(g)
    if (ring.length < 2) continue
    if (tags.barrier && !tags.building) {
      // A wall, fence or hedge is a line: a thin blocked strip along each piece of it.
      for (let i = 1; i < ring.length; i++) blocked.push({z: 0, kind, source: 'osm', osmId: el.id, polygon: segmentQuad(ring[i - 1], ring[i], BARRIER_HALF_M)})
    } else if (isClosed(ring)) {
      blocked.push({z: 0, kind, source: 'osm', osmId: el.id, polygon: [ring]})
    }
  }
}
// The pilot building, as MazeMap draws it, blocks outdoor walking too (its doors are the way in).
for (const pl of buildingPolys) blocked.push({z: 0, kind: 'building', source: 'mazemap', building: BUILDING_ID, polygon: pl})
// Indoors: MazeMap's walls block, per floor.
for (const z of FLOORS) for (const w of floors[z].walls) blocked.push({z, kind: 'wall', source: 'mazemap', building: BUILDING_ID, polygon: w.polygon})

const graph = buildGraph(footpaths, corrections)
const coordOf = (i) => fromLocal(graph.origin, graph.pts[i])
const outdoorNode = new Map()
function outNode(i) {
  if (outdoorNode.has(i)) return outdoorNode.get(i)
  const ll = coordOf(i)
  const n = newNode({...L(ll.lng, ll.lat), z: 0, building: null, type: 'path'})
  outdoorNode.set(i, n)
  return n
}
const osmCoord = (i) => (i < footpaths.nodes.length ? footpaths.nodes[i] : null)
let outdoorCount = 0
for (const e of graph.edges) {
  const A = coordOf(e.a)
  const B = coordOf(e.b)
  if (!inArea(L(A.lng, A.lat)) || !inArea(L(B.lng, B.lat))) continue
  const a = outNode(e.a)
  const b = outNode(e.b)
  if (a === b) continue
  const ca = osmCoord(e.a)
  const cb = osmCoord(e.b)
  const osmId = e.source === 'osm' && ca && cb ? footpathEdgeId(ca, cb) : null
  const edge = addEdge(a, b, {
    type: 'outdoor',
    source: e.source === 'correction' ? 'manual' : 'osm',
    widthM: e.widthM ?? null,
    stepFree: e.type === 'steps' ? false : e.wheelchair === 'no' ? false : true,
    oneWay: e.direction === 'both' ? false : e.direction,
    verified: e.source === 'correction',
    osmType: e.type,
    passage: osmId ? (passages.get(osmId) ?? null) : null,
  })
  if (edge) outdoorCount += 1
}
console.log(`Outdoor: ${outdoorNode.size} nodes, ${outdoorCount} edges in the pilot area (${passages.size} OSM bridge/covered/tunnel pieces, ${blocked.filter((b) => b.z === 0).length} blocked areas, ${openings.length} barrier openings)`)

// ---------- join each door to the outdoor network ----------
for (const d of doorNodes) {
  let best = null
  for (const e of edgeMap.values()) {
    if (e.type !== 'outdoor') continue
    const c = closestOnSegment(d, e.from, e.to)
    if (!best || c.d < best.c.d) best = {e, c}
  }
  if (!best || best.c.d > JOIN_M) {
    errors.push({kind: 'door-not-joined', message: `${d.type === 'entrance' ? 'Entrance' : 'Door'} on level ${d.z}${d.door?.courtyard ? ' (courtyard)' : ''}: no outdoor path within ${JOIN_M} m${best ? ` (nearest ${best.c.d.toFixed(1)} m)` : ''}`, nodeRef: d, x: round(d.x), y: round(d.y), z: d.z, nearestM: round(best?.c.d)})
    continue
  }
  const {e, c} = best
  let target
  if (dist(c, e.from) <= SNAP_M) target = e.from
  else if (dist(c, e.to) <= SNAP_M) target = e.to
  else {
    // Split the path where the door's connection meets it.
    target = newNode({x: c.x, y: c.y, z: 0, building: null, type: 'path'})
    edgeMap.delete(edgeKey(e.from, e.to))
    const props = edgeProps(e)
    addEdge(e.from, target, props)
    addEdge(target, e.to, props)
  }
  addEdge(d, target, {type: 'door', source: 'join', widthM: d.door?.widthM ?? null, stepFree: null, verified: false, joinM: round(c.d)})
}

// ---------- proposals for doors that do not join ----------
// Never routed: MazeMap's own outdoor approach to the door, cut where it meets an OSM path, written
// to tools/network-proposed-corrections.json for checking on site. A checked one is copied into
// src/data/footpath-corrections.json with verified: true, and the next build joins the door.
const proposals = []
{
  const joined = new Set([...edgeMap.values()].filter((e) => e.type === 'door').flatMap((e) => [e.from, e.to]))
  const osmEdges = [...edgeMap.values()].filter((e) => e.type === 'outdoor')
  const nearPath = (q) => {
    let best = Infinity
    for (const e of osmEdges) best = Math.min(best, closestOnSegment(q, e.from, e.to).d)
    return best
  }
  for (const d of doorNodes) {
    if (joined.has(d)) continue
    let best = null
    for (const run of outdoorRuns) {
      const pts = run.points
      if (pts.length < 2) continue
      let line = null
      if (run.endsAtBuilding && dist(pts.at(-1), d) <= DOOR_NODE_M) line = pts.slice().reverse()
      else if (run.startsAtBuilding && dist(pts[0], d) <= DOOR_NODE_M) line = pts.slice()
      if (!line) continue
      // Walk out from the door until the approach reaches an OSM path (within 1 m).
      const cut = [line[0]]
      let reached = false
      let length = 0
      for (let i = 1; i < line.length && !reached && length < 80; i++) {
        const a = line[i - 1]
        const b = line[i]
        const steps = Math.max(1, Math.ceil(dist(a, b) / 0.5))
        for (let s = 1; s <= steps; s++) {
          const q = {x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps}
          if (nearPath(q) <= 1) {
            cut.push(q)
            length += dist(cut.at(-2), q)
            reached = true
            break
          }
        }
        if (!reached) {
          length += dist(cut.at(-1), b)
          cut.push(b)
        }
      }
      if (reached && (!best || length < best.length)) best = {cut, length}
    }
    const ll = (q) => {
      const g = fromLocal(CAMPUS_ORIGIN, q)
      return [Number(g.lng.toFixed(7)), Number(g.lat.toFixed(7))]
    }
    if (best) {
      proposals.push({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: [ll(d), ...best.cut.slice(1).map(ll)]},
        properties: {type: 'path', verified: false, source: 'mazemap-approach', doorLevel: d.z, lengthM: round(best.length), note: `Proposed: MazeMap's outdoor approach to the ${d.type} at (${round(d.x)}, ${round(d.y)}) level ${d.z}. Walk it, then copy into footpath-corrections.json with verified: true.`},
      })
    } else {
      warnings.push({kind: 'no-proposal', message: `No MazeMap outdoor approach reaches an OSM path from this ${d.type}`, x: round(d.x), y: round(d.y), z: d.z})
    }
  }
}
writeFileSync(join(root, 'tools', 'network-proposed-corrections.json'), `${JSON.stringify({_readme: 'Generated by tools/build-network.mjs. NOT used for routing. Each path is MazeMap\'s outdoor approach from an unjoined door to the nearest OSM path. Check each one on site; copy the good ones into src/data/footpath-corrections.json paths with verified: true.', generatedAt: new Date().toISOString(), paths: proposals}, null, 2)}\n`)
console.log(`Proposed door connections (unverified, not routed): ${proposals.length}`)

// ---------- write ----------
const levels = floorHeights[String(BUILDING_ID)]?.levels ?? {}
const heightOf = (n) => (n.z === 0 ? null : Number.isFinite(levels[n.z]) ? levels[n.z] : null)
for (const z of FLOORS) if (!Number.isFinite(levels[z])) errors.push({kind: 'no-floor-height', z, message: `Level ${z}: no height in src/data/floor-heights.json`})

// Only nodes that some edge uses, or that carry a meaning (an unconnected door is kept to show the error).
const used = new Set()
for (const e of edgeMap.values()) {
  used.add(e.from)
  used.add(e.to)
}
const kept = nodes.filter((n) => used.has(n) || n.type !== 'path')
kept.forEach((n, i) => (n.id = `n${i}`))
for (const err of errors) {
  if (err.nodeRef) {
    err.nodeId = err.nodeRef.id
    delete err.nodeRef
  }
}
const edges = [...edgeMap.values()].map((e, i) => {
  const run = dist(e.from, e.to)
  const rise = e.from.z !== e.to.z ? Math.abs((heightOf(e.to) ?? 0) - (heightOf(e.from) ?? 0)) : 0
  const out = {
    id: `e${i}`,
    from: e.from.id,
    to: e.to.id,
    type: e.type,
    lengthM: round(e.type === 'lift' ? run + rise : Math.hypot(run, rise)),
    widthM: round(e.widthM ?? null),
    stepFree: e.stepFree ?? null,
    oneWay: e.oneWay ?? false,
    verified: e.verified ?? false,
    source: e.source,
  }
  if (e.passage) out.passage = e.passage
  if (e.osmType) out.osmType = e.osmType
  if (e.levelChangeFrom) out.levelChangeFrom = e.levelChangeFrom
  if (e.joinM != null) out.joinM = e.joinM
  if (e.uses > 1) out.routes = e.uses
  return out
})
const outNodes = kept.map((n) => {
  const o = {id: n.id, x: round(n.x), y: round(n.y), z: n.z, heightM: heightOf(n), building: n.building, type: n.type}
  if (n.door) o.door = n.door
  if (n.room) o.room = n.room
  return o
})
const ring2 = (ring) => ring.map((p) => [round(p.x), round(p.y)])
const poly2 = (polygon) => polygon.map(ring2)
const walkable = [{id: 'walk-campus', z: 0, building: null, kind: 'campus', source: 'osm', polygon: poly2([campusRing])}]
for (const z of FLOORS) {
  floors[z].outlines.forEach((o, i) => walkable.push({id: `walk-${z}-${i}`, z, building: BUILDING_ID, kind: 'floor', source: 'mazemap', polygon: poly2(o.polygon)}))
  floors[z].rooms.forEach((o, i) => walkable.push({id: `walk-${z}-r${i}`, z, building: BUILDING_ID, kind: 'room', source: 'mazemap', polygon: poly2(o.polygon)}))
  floors[z].areas.forEach((o, i) => walkable.push({id: `walk-${z}-a${i}`, z, building: BUILDING_ID, kind: 'area', source: 'mazemap', polygon: poly2(o.polygon)}))
}
const startXY = L(startPoint.lng, startPoint.lat)

const out = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  generator: 'tools/build-network.mjs',
  origin: CAMPUS_ORIGIN,
  frame: 'x metres east, y metres north of origin (the campus GLB origin); z = MazeMap floor (0 outdoors); heightM above the building level-1 floor (outdoors: null, ground not modelled)',
  pilot: {
    name: pilot.route.name,
    building: BUILDING_ID,
    start: {name: startPoint.name, poiId: startPoint.poiId, x: round(startXY.x), y: round(startXY.y), z: 0},
    roomNodeId: roomNodes.find((n) => n.room?.poiId === pilot.route.toPoiId)?.id ?? null,
    mazemap: {
      lengthM: pilotRes.json.pathMetrics?.distanceWalkingMeters ?? null,
      entranceNodeIds: [...pilotEntranceDoors].map((n) => n.id),
      entries: pilotIndoor.entries.map((p) => ({x: round(p.x), y: round(p.y), z: p.z})),
      points: (pilotRes.json.path?.features ?? []).flatMap((f) => (f.geometry?.coordinates ?? []).map(([lng, lat]) => {
        const p = L(lng, lat)
        return [round(p.x), round(p.y), f.properties?.z ?? 0]
      })),
    },
  },
  floors: {
    [BUILDING_ID]: {
      name: pilot.building.name,
      measured: floorHeights[String(BUILDING_ID)]?.measured ?? false,
      levels: Object.fromEntries(FLOORS.map((z) => [z, levels[z] ?? null])),
      mazemapNames: Object.fromEntries(FLOORS.map((z) => [z, mazemapFloors[z] ?? null])),
      notInBuildingRecord: missingFloors,
    },
  },
  nodes: outNodes,
  edges,
  areas: {
    walkable,
    blocked: blocked.map((b, i) => ({id: `block-${i}`, z: b.z, building: b.building ?? null, kind: b.kind, source: b.source, ...(b.osmId ? {osmId: b.osmId} : {}), polygon: poly2(b.polygon)})),
  },
  doorLines: FLOORS.flatMap((z) => floors[z].doors.map((d) => ({z, a: [round(d.a.x), round(d.a.y)], b: [round(d.b.x), round(d.b.y)], exterior: d.exterior}))),
  openings: openings.map((o) => ({x: round(o.x), y: round(o.y), kind: o.kind, osmId: o.osmId})),
  errors,
  warnings,
  build: {
    anchors: counts,
    routesRequested: pairs.length,
    routesFailed: stats.failed,
    httpRequests: stats.requests,
    cacheHits: stats.cached,
    mazemapFlagsSeen: [...flagsSeen].sort(),
    outdoorArea: {x0: round(area.x0), y0: round(area.y0), x1: round(area.x1), y1: round(area.y1)},
  },
}
writeFileSync(join(root, 'src', 'data', 'campus-network.json'), JSON.stringify(out))
console.log(`campus-network.json: ${outNodes.length} nodes, ${edges.length} edges, ${errors.length} errors, ${warnings.length} warnings (${stats.requests} requests, ${stats.cached} from cache)`)
