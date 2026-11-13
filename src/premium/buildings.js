// Building shapes for the premium map's 3D buildings.
// The 12 University buildings come from MazeMap's building outlines; their height is
// estimated from the number of floors (MazeMap does not give heights).
import {MAZEMAP} from '../config.js'
import {fromLocal, toLocal} from '../geo/geo.js'

export const FLOOR_HEIGHT_M = 3.8
export const ROOF_M = 1.2

/** Estimated height in metres of a building with this many floors. */
export function heightForFloors(floors) {
  const n = Math.max(1, Number(floors) || 1)
  return Math.round((n * FLOOR_HEIGHT_M + ROOF_M) * 10) / 10
}

/**
 * The ring pushed outwards by `metres` from its centre. Used to leave out the street-map
 * copy of a building we already draw from MazeMap's outline.
 */
export function growRing(ring, metres) {
  const n = ring.length
  // Through the app's one lat/lng <-> metres conversion (geo.js), about the ring's centre.
  const centre = {lng: ring.reduce((s, p) => s + p[0], 0) / n, lat: ring.reduce((s, p) => s + p[1], 0) / n}
  return ring.map(([lng, lat]) => {
    const {x, y} = toLocal(centre, {lat, lng})
    const d = Math.hypot(x, y) || 1
    const k = (d + metres) / d
    const p = fromLocal(centre, {x: x * k, y: y * k})
    return [p.lng, p.lat]
  })
}

/** MazeMap's building list -> GeoJSON for a fill-extrusion layer. */
export function buildingFeatures(buildings) {
  const features = []
  for (const b of buildings || []) {
    const geometry = b.fullOutline || b.visibleOutline
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) continue
    features.push({
      type: 'Feature',
      id: b.id,
      properties: {id: b.id, name: b.name, height: heightForFloors(b.floors?.length), tone: b.id % 3},
      geometry,
    })
  }
  return {type: 'FeatureCollection', features}
}

/** One MultiPolygon around all the buildings, a few metres wider. */
export function outlineMask(collection, metres = 6) {
  const polygons = []
  for (const f of collection.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const p of polys) polygons.push([growRing(p[0], metres)])
  }
  return {type: 'MultiPolygon', coordinates: polygons}
}

let cache = null
export function loadBuildings({fetchImpl = fetch} = {}) {
  cache ??= fetchImpl(`https://api.mazemap.com/api/buildings/?campusid=${MAZEMAP.campusId}&srid=4326`)
    .then((r) => {
      if (!r.ok) throw new Error(`buildings ${r.status}`)
      return r.json()
    })
    .then((j) => buildingFeatures(j.buildings))
    .catch((err) => {
      cache = null
      throw err
    })
  return cache
}
