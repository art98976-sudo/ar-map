// One floor of a MazeMap building, read straight from MazeMap's vector tiles (one tile set per
// floor level: tiles.mazemap.com/all/latest/<level>/<z>/<x>/<y>.mvt). It gives the real walls
// (polygons), doors (lines across the gap, so their length is the door width), room shapes and
// room labels, for a whole area, not only what a map happens to show.
import {VectorTile} from '@mapbox/vector-tile'
import {PbfReader} from 'pbf'
import {SHELL} from '../config.js'
import {fromLocal} from '../geo/geo.js'

/** Web Mercator tile x, y at zoom z for a point. */
export function tileOf(lng, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return {x, y}
}

/** The tiles covering a {west, south, east, north} box at zoom z. */
export function tilesFor(box, z = SHELL.tileZoom) {
  const a = tileOf(box.west, box.north, z)
  const b = tileOf(box.east, box.south, z)
  const out = []
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({x, y, z})
  return out
}

/** MazeMap writes floor levels as "2.0" in the tile path. */
export const levelPath = (level) => Number(level).toFixed(1)

export function tileUrl(level, {x, y, z}) {
  return `https://tiles.mazemap.com/all/latest/${levelPath(level)}/${z}/${x}/${y}.mvt?version=2`
}

const ringsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [])

/** One decoded tile -> plain lists in lng/lat. */
export function decodeFloorTile(buffer, {x, y, z}) {
  const tile = new VectorTile(new PbfReader(new Uint8Array(buffer)))
  const read = (name) => {
    const layer = tile.layers[name]
    const out = []
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i)
      out.push({id: f.properties.id, props: f.properties, geometry: f.toGeoJSON(x, y, z).geometry})
    }
    return out
  }
  return {
    walls: read('walls').flatMap((f) => ringsOf(f.geometry).map((polygon) => ({id: f.id, polygon}))),
    doors: read('doors').flatMap((f) => (f.geometry.type === 'LineString' ? [{id: f.id, line: f.geometry.coordinates}] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.map((line) => ({id: f.id, line})) : [])),
    rooms: read('rooms').flatMap((f) => ringsOf(f.geometry).map((polygon) => ({id: f.id, polygon}))),
    outlines: read('outlines').flatMap((f) => ringsOf(f.geometry).map((polygon) => ({id: f.id, polygon}))),
    stairs: read('stairs').flatMap((f) => ringsOf(f.geometry).map((polygon) => ({id: f.id, polygon}))),
    lifts: read('elevators').flatMap((f) => ringsOf(f.geometry).map((polygon) => ({id: f.id, polygon}))),
    labels: read('markers')
      .filter((f) => f.props.text && f.geometry.type === 'Point')
      .map((f) => ({text: String(f.props.text), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1]})),
  }
}

/** Put decoded tiles together (a wall cut by a tile edge stays as its pieces: fine for walls). */
export function mergeFloor(parts) {
  const floor = {walls: [], doors: [], rooms: [], outlines: [], stairs: [], lifts: [], labels: []}
  const seenLabels = new Set()
  for (const part of parts) {
    floor.walls.push(...part.walls)
    floor.doors.push(...part.doors)
    floor.rooms.push(...part.rooms)
    floor.outlines.push(...part.outlines)
    floor.stairs.push(...(part.stairs || []))
    floor.lifts.push(...(part.lifts || []))
    for (const l of part.labels) {
      const key = `${l.text}|${l.lng.toFixed(6)}|${l.lat.toFixed(6)}`
      if (!seenLabels.has(key)) {
        seenLabels.add(key)
        floor.labels.push(l)
      }
    }
  }
  return floor
}

/** A box `metres` around a point (through the app's one conversion, geo.js). */
export function boxAround(centre, metres) {
  const sw = fromLocal(centre, {x: -metres, y: -metres})
  const ne = fromLocal(centre, {x: metres, y: metres})
  return {west: sw.lng, east: ne.lng, south: sw.lat, north: ne.lat}
}

/** Fetch one floor level over a box. Missing tiles (outside any building) are simply empty. */
export async function fetchFloor(level, box, {fetchImpl = fetch, signal} = {}) {
  const tiles = tilesFor(box)
  const parts = await Promise.all(
    tiles.map(async (t) => {
      try {
        const res = await fetchImpl(tileUrl(level, t), {signal})
        if (!res.ok) return null
        return decodeFloorTile(await res.arrayBuffer(), t)
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        return null
      }
    }),
  )
  return {level, box, ...mergeFloor(parts.filter(Boolean))}
}
