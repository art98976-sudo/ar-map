// Plans the outdoor walking route from the user's GPS position to a building entrance.
//
// Order of preference:
//   1. MazeMap routing (the University's own campus paths), outdoors only
//   2. Our OpenStreetMap footpath graph with A* (works offline once loaded)
//   3. A straight line, clearly flagged, so the user still gets a direction
import {MAZEMAP} from '../config.js'
import {distanceM, fromLocal, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {loadCampusGraph, routeOnFootpaths} from './footpaths.js'

export const CAMPUS_RADIUS_M = 3000
const WALK_SPEED_MPS = 1.3 // about 4.7 km/h, a relaxed campus pace
const ROUTE_KEY = 'welcomeAR.route.v1'
export const SNAP_TO_PATH_M = 15 // GPS this close to a path means the user is ON that path
const ON_PATH_M = 0.5

/** Where the walk should end: the main entrance if we know it, otherwise the place itself. */
export function entranceOf(dest) {
  const e = dest?.entrance
  return e && Number.isFinite(e.lat) && Number.isFinite(e.lng) ? {lat: e.lat, lng: e.lng} : {lat: dest.lat, lng: dest.lng}
}

export function isOnCampus(p) {
  return distanceM(p, MAZEMAP.center) <= CAMPUS_RADIUS_M
}

export function walkingMinutes(metres) {
  return Math.max(1, Math.round(metres / WALK_SPEED_MPS / 60))
}

/** Rough walking time before a route is planned: paths are about 1.3 x the straight line. */
export function estimateWalkMinutes(from, dest) {
  if (!from || !isOnCampus(from)) return null
  return walkingMinutes(distanceM(from, entranceOf(dest)) * 1.3)
}

/** Google Maps walking directions (for people who are not on campus yet). */
export function googleMapsWalkingUrl(dest) {
  const e = entranceOf(dest)
  return `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}&travelmode=walking`
}

/** Parse a MazeMap /routing/path response. Exported for tests. */
export function parseMazeMapPath(json) {
  const feats = json?.path?.features || []
  const points = []
  let indoor = false
  for (const f of feats) {
    if (f.properties?.buildingId != null) indoor = true
    for (const [lng, lat] of f.geometry?.coordinates || []) {
      const last = points.at(-1)
      if (!last || last.lat !== lat || last.lng !== lng) points.push({lat, lng})
    }
  }
  return {points, indoor, lengthM: json?.pathMetrics?.distanceWalkingMeters ?? null}
}

async function mazemapRoute(from, to, {signal} = {}) {
  const q = new URLSearchParams({
    srid: '4326',
    hc: 'false',
    sourcelat: String(from.lat),
    sourcelon: String(from.lng),
    sourcez: '0', // outdoors
    targetlat: String(to.lat),
    targetlon: String(to.lng),
    targetz: '0', // the entrance is outside the door
    lang: 'en',
    distanceunitstype: 'metric',
    mode: 'PEDESTRIAN',
  })
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
  const res = await fetch(`https://routing.mazemap.com/routing/path/?${q}`, {signal: signal || timeout})
  if (!res.ok) throw new Error(`MazeMap routing HTTP ${res.status}`)
  return parseMazeMapPath(await res.json())
}

/**
 * Fit a planned path to the trip. A raw GPS fix is 5-15 m out, so a straight leg from it to the
 * path would cut across whatever is in between. Near a path, start at the nearest point ON it;
 * only someone genuinely far from any path gets a leg from where they stand.
 * The end works the same way: within 15 m of the entrance the route ends on the path, and the
 * destination pin marks the door. A straight last leg could cut through the building.
 */
export function anchor(points, from, to) {
  // A planner may have added its own leg from the raw fix. Measure from the real path.
  let path = points.slice()
  if (path.length > 2 && distanceM(path[0], from) <= ON_PATH_M) path.shift()
  if (path.length > 2 && distanceM(path.at(-1), to) <= ON_PATH_M) path.pop()
  if (path.length < 2) return [from, to]

  const local = path.map((p) => toLocal(from, p))
  const start = projectOntoPolyline(local, {x: 0, y: 0})
  if (start.offset > SNAP_TO_PATH_M) {
    path.unshift(from)
  } else if (start.s > 0) {
    path = [fromLocal(from, {x: start.x, y: start.y}), ...path.slice(start.segment + 1)]
  }

  if (distanceM(path.at(-1), to) <= ON_PATH_M) return path
  const end = projectOntoPolyline(path.map((p) => toLocal(to, p)), {x: 0, y: 0})
  if (end.offset > SNAP_TO_PATH_M) return [...path, to]
  const last = end.offset <= ON_PATH_M ? to : fromLocal(to, {x: end.x, y: end.y})
  const trimmed = [...path.slice(0, end.segment + 1), last]
  // Practically at the door already: nothing left of the path to walk.
  return lengthOf(trimmed) < 1 ? [from, to] : trimmed
}

function lengthOf(points) {
  let m = 0
  for (let i = 1; i < points.length; i++) m += distanceM(points[i - 1], points[i])
  return m
}

/**
 * Plan a route. Returns one of:
 *   {status: 'off-campus', distanceM}
 *   {status: 'ok', points: [{lat,lng}], lengthM, minutes, source: 'mazemap'|'footpaths'|'direct', entrance}
 */
export async function planRoute(from, dest, {mazemap = mazemapRoute, graph = loadCampusGraph} = {}) {
  if (!isOnCampus(from)) return {status: 'off-campus', distanceM: distanceM(from, MAZEMAP.center)}
  const to = entranceOf(dest)
  const done = (points, source) => {
    const pts = anchor(points, from, to)
    const lengthM = lengthOf(pts)
    return {status: 'ok', points: pts, lengthM, minutes: walkingMinutes(lengthM), source, entrance: to}
  }

  // 1. MazeMap, but only if it stays outdoors.
  try {
    const mm = await mazemap(from, to)
    if (mm.points.length >= 2 && !mm.indoor) return done(mm.points, 'mazemap')
  } catch (err) {
    console.warn('[route] MazeMap routing failed, using campus footpaths', err?.message)
  }

  // 2. Our outdoor footpath graph.
  try {
    const g = await graph()
    const fp = routeOnFootpaths(g, from, to)
    if (fp && fp.points.length >= 2) return done(fp.points, 'footpaths')
  } catch (err) {
    console.warn('[route] footpath routing failed', err?.message)
  }

  // 3. Straight line: still useful on open lawns, and the UI says it is approximate.
  return done([from, to], 'direct')
}

// ---------- the route for this trip (the AR screen reads it) ----------
export function saveTripRoute(route, storage = globalThis.sessionStorage) {
  try {
    storage.setItem(ROUTE_KEY, JSON.stringify(route))
  } catch {
    // blocked storage: the AR screen plans again
  }
}

export function readTripRoute(storage = globalThis.sessionStorage) {
  try {
    const r = JSON.parse(storage.getItem(ROUTE_KEY) || 'null')
    return r && Array.isArray(r.points) && r.points.length >= 2 ? r : null
  } catch {
    return null
  }
}
