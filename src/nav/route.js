// Plans the outdoor walking route from the user's GPS position to a building entrance.
//
// Order of preference:
//   1. MazeMap routing (the University's own campus paths), outdoors only
//   2. Our OpenStreetMap footpath graph with A* (works offline once loaded)
//   3. A straight line, clearly flagged, so the user still gets a direction
import {MAZEMAP} from '../config.js'
import {distanceM} from '../geo/geo.js'
import {loadCampusGraph, routeOnFootpaths} from './footpaths.js'

export const CAMPUS_RADIUS_M = 3000
const WALK_SPEED_MPS = 1.3 // about 4.7 km/h, a relaxed campus pace
const ROUTE_KEY = 'welcomeAR.route.v1'

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

/** Make sure the route starts exactly at the user and ends exactly at the entrance. */
function anchor(points, from, to) {
  const out = points.slice()
  if (!out.length || distanceM(out[0], from) > 0.5) out.unshift(from)
  if (distanceM(out.at(-1), to) > 0.5) out.push(to)
  return out
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
