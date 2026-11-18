// Alignment Phase 1: the building outlines (is a GPS fix indoors?) and the exterior doors near the
// user (the "Where are you?" list), from MazeMap: the campus building list (api.mazemap.com) and the
// door lines on each floor (tiles.mazemap.com, mazemap-floor.js). The geometry is door-start.js.
import {fromLocal, pointInRing, toLocal} from '../geo/geo.js'
import {loadBuildingRecords} from '../premium/buildings.js'
import {boxAround, fetchFloor} from '../ar/mazemap-floor.js'
import {entrancesOf, PLACE_LIST} from '../route/start-point.js'
import {exteriorDoors, nearestEdge} from '../route/door-start.js'
import {AR_START} from '../config.js'

const polygonsOf = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [])

/** MazeMap building records -> [{id, name, polygons ([[ring of [lng, lat]]]), levels}]. */
export function buildingShapes(records) {
  return (records || [])
    .map((b) => ({
      id: b.id,
      name: b.name ?? null,
      polygons: polygonsOf(b.fullOutline || b.visibleOutline),
      levels: [...new Set((b.floors || []).map((f) => Number(f.z)).filter(Number.isFinite))],
    }))
    .filter((b) => b.polygons.length)
}

/** The building a point {lat, lng} is in (inside its outline, not in a courtyard), or null. */
export function buildingAt(point, shapes) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null
  return shapes.find((b) => b.polygons.some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some((h) => pointInRing(point, h)))) ?? null
}

let shapesLoad = null
/** The campus building shapes, once a session (null if MazeMap could not be reached). */
export function loadBuildingShapes(load = loadBuildingRecords) {
  shapesLoad ??= load()
    .then(buildingShapes)
    .catch((err) => {
      shapesLoad = null
      console.warn('[doors] building outlines unavailable', err?.message)
      return null
    })
  return shapesLoad
}

/** The named entrances in our own data (destinations.json, start-places.json), as doors to offer. */
function knownEntrances() {
  const out = []
  for (const place of PLACE_LIST) {
    if (place.category === 'room') continue
    for (const e of entrancesOf(place)) {
      if (!e.name || !Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue
      const same = out.find((o) => Math.abs(o.lat - e.lat) < 1e-6 && Math.abs(o.lng - e.lng) < 1e-6)
      if (same) same.places.push(place.name)
      else out.push({lat: e.lat, lng: e.lng, name: e.name, places: [place.name]})
    }
  }
  return out
}

/**
 * The exterior doors within `radiusM` of `here` ({lat, lng}), unranked: [{id, lat, lng, level,
 * inwardDeg (null: a known entrance whose wall MazeMap does not pin down), name, places,
 * buildingName, recessM, x, y (metres from here)}]. Floors that fail to load are skipped.
 */
export async function doorsNear(here, {radiusM = AR_START.doorSearchM, shapes = null, loadFloor = fetchFloor, entrances = knownEntrances()} = {}) {
  const all = shapes ?? (await loadBuildingShapes())
  if (!all?.length || !here) return []
  const local = (lng, lat) => toLocal(here, {lat, lng})
  const near = all
    .map((b) => ({...b, rings: b.polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => local(lng, lat))))}))
    .filter((b) => nearestEdge({x: 0, y: 0}, b.rings).d <= radiusM)
  if (!near.length) return []
  const levels = [...new Set(near.flatMap((b) => b.levels))]
  const box = boxAround(here, radiusM)
  const floors = await Promise.allSettled((levels.length ? levels : [1]).map((level) => loadFloor(level, box)))
  const lines = floors
    .filter((f) => f.status === 'fulfilled')
    .flatMap(({value}) => value.doors.map((d) => ({id: d.id, level: value.level, a: local(...d.line[0]), b: local(...d.line.at(-1))})))
  const named = entrances.map((e) => ({...e, ...toLocal(here, e)})).filter((e) => Math.hypot(e.x, e.y) <= radiusM)
  const doors = exteriorDoors(lines, near, AR_START, {entrances: named})
  for (const e of named) {
    const door = doors
      .map((d) => ({d, m: Math.hypot(d.x - e.x, d.y - e.y)}))
      .filter(({m}) => m <= AR_START.namedDoorM)
      .sort((a, b) => a.m - b.m)[0]?.d
    if (door) {
      door.name ??= e.name
      door.places = e.places
    } else {
      // Our entrance, but no door line MazeMap draws there can say which way the wall faces: offer
      // it all the same; the route through it gives the heading (door-start.js resolveDoorHeading).
      const building = near.map((b) => ({b, m: nearestEdge(e, b.rings).d})).sort((a, b) => a.m - b.m)[0]?.b
      doors.push({id: null, level: null, x: e.x, y: e.y, widthM: null, inwardDeg: null, buildingId: building?.id ?? null, buildingName: building?.name ?? e.places[0], recessM: 0, name: e.name, places: e.places})
    }
  }
  return doors.map((d) => ({...d, ...fromLocal(here, d)}))
}
