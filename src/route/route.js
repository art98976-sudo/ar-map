// Plans the outdoor walking route from the user's GPS position to a building entrance.
//
// Order of preference:
// A trip wholly on campus:
//   1. MazeMap routing (the University's own campus paths), outdoors only
//   2. Our OpenStreetMap campus footpath graph with A* (works offline once loaded)
//   3. MazeMap's route through a building, if that is all there is
//   4. A straight line, clearly flagged, so the user still gets a direction
// A trip with either end off campus: the Stirling-wide OpenStreetMap graph, then the straight line.
// The AR screen plans again as the user crosses on to campus, so MazeMap takes over from there.
import campusBoundary from '../data/campus-boundary.json'
import {MAZEMAP, ROUTING, TOWN_BBOX} from '../config.js'
import {distanceM, fromLocal, pointInRing, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {loadCampusGraph, loadTownGraph, routeOnFootpaths} from './footpaths.js'

const ROUTE_KEY = 'welcomeAR.route.v1'

/** Where the walk should end: the main entrance if we know it, otherwise the place itself. */
export function entranceOf(dest) {
  const e = dest?.entrance
  return e && Number.isFinite(e.lat) && Number.isFinite(e.lng) ? {lat: e.lat, lng: e.lng} : {lat: dest.lat, lng: dest.lng}
}

/** Inside the University's boundary. */
export function isOnCampus(p) {
  return pointInRing(p, campusBoundary.geometry.coordinates[0])
}

/** Inside the area AR walking directions cover: all of Stirling and the campus. */
export function isInStirling(p) {
  const [south, west, north, east] = TOWN_BBOX
  return p.lat >= south && p.lat <= north && p.lng >= west && p.lng <= east
}

export function walkingMinutes(metres) {
  return Math.max(1, Math.round(metres / ROUTING.walkSpeedMps / 60))
}

/** Rough walking time before a route is planned: paths are about 1.3 x the straight line. */
export function estimateWalkMinutes(from, dest) {
  if (!from || !isInStirling(from)) return null
  return walkingMinutes(distanceM(from, entranceOf(dest)) * 1.3)
}

/** Google Maps walking directions (for people outside the area AR covers). */
export function googleMapsWalkingUrl(dest) {
  const e = entranceOf(dest)
  return `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}&travelmode=walking`
}

/** Parse a MazeMap /routing/path response. Exported for tests. */
export function parseMazeMapPath(json) {
  const feats = json?.path?.features || []
  const points = []
  const outdoorPoints = [] // from the start up to the first door
  let indoor = false
  for (const f of feats) {
    if (f.properties?.buildingId != null) indoor = true
    for (const [lng, lat] of f.geometry?.coordinates || []) {
      const last = points.at(-1)
      if (!last || last.lat !== lat || last.lng !== lng) points.push({lat, lng})
      if (!indoor) {
        const lastOut = outdoorPoints.at(-1)
        if (!lastOut || lastOut.lat !== lat || lastOut.lng !== lng) outdoorPoints.push({lat, lng})
      }
    }
  }
  const endsIndoor = feats.at(-1)?.properties?.buildingId != null
  return {points, outdoorPoints, indoor, endsIndoor, lengthM: json?.pathMetrics?.distanceWalkingMeters ?? null}
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
 * Fit a planned path to the trip. A raw GPS fix is often several metres out, so a straight leg
 * from it to the path would cut across whatever is in between. Near a path, start at the nearest
 * point ON it; only someone genuinely far from any path gets a leg from where they stand. The
 * entrance is appended only when it is more than 3 m from the final path point.
 */
export function anchor(points, from, to) {
  // A planner may have added its own leg from the raw fix. Measure from the real path.
  let path = points.slice()
  if (path.length > 2 && distanceM(path[0], from) <= ROUTING.onPathM) path.shift()
  if (path.length > 2 && distanceM(path.at(-1), to) <= ROUTING.onPathM) path.pop()
  if (path.length < 2) return [from, to]

  const local = path.map((p) => toLocal(from, p))
  const start = projectOntoPolyline(local, {x: 0, y: 0})
  if (start.offset > ROUTING.snapToPathM) {
    path.unshift(from)
  } else if (start.s > 0) {
    path = [fromLocal(from, {x: start.x, y: start.y}), ...path.slice(start.segment + 1)]
  }

  if (distanceM(path.at(-1), to) <= ROUTING.entranceAppendM) return path
  return [...path, to]
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
export async function planRoute(from, dest, {mazemap = mazemapRoute, graph = loadCampusGraph, townGraph = loadTownGraph} = {}) {
  if (!isInStirling(from)) return {status: 'off-campus', distanceM: distanceM(from, MAZEMAP.center)}
  const to = entranceOf(dest)
  const onCampus = isOnCampus(from) && isOnCampus(to)
  const done = (points, source, target = to) => {
    const pts = anchor(points, from, target)
    const lengthM = lengthOf(pts)
    console.info('[route]', source, pts.length, 'points')
    return {status: 'ok', points: pts, lengthM, minutes: walkingMinutes(lengthM), source, entrance: target}
  }

  // 1. MazeMap, as long as it stays outdoors. If it ends indoors (a room), walk to that door.
  let throughBuilding = null
  if (onCampus) {
    try {
      const mm = await mazemap(from, to)
      if (mm.points.length >= 2) {
        if (!mm.indoor) return done(mm.points, 'mazemap')
        if (mm.endsIndoor && mm.outdoorPoints.length >= 2) return done(mm.outdoorPoints, 'mazemap', mm.outdoorPoints.at(-1))
        throughBuilding = mm.points
      }
    } catch (err) {
      console.warn('[route] MazeMap routing failed, using campus footpaths', err?.message)
    }
  }

  // 2. Our outdoor footpath graph.
  try {
    const g = await (onCampus ? graph : townGraph)()
    const fp = routeOnFootpaths(g, from, to)
    if (fp && fp.points.length >= 2) return done(fp.points, 'footpaths')
  } catch (err) {
    console.warn('[route] footpath routing failed', err?.message)
  }

  // 3. MazeMap's way through a building: GPS is poor indoors, but it is still a real way there.
  if (throughBuilding) return done(throughBuilding, 'mazemap')

  // 4. Straight line: still useful on open lawns, and the UI says it is approximate.
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
