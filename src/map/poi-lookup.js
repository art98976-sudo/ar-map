// A MazeMap room opened from a link (#/?to=mm-<poiId>) in a fresh tab or on another device:
// fetch it by its id and build the same destination object the search gives.
import {MAZEMAP} from '../config.js'

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').trim()

/** The poiId in a room destination id ("mm-1002085033"), or null. */
export function poiIdFrom(id) {
  const m = /^mm-(\d{3,})$/.exec(String(id ?? ''))
  return m ? m[1] : null
}

/**
 * A MazeMap /api/pois/<id>/ answer -> destination, as parseMazeMapResults makes. Null if it is not
 * a usable place on our campus (deleted, no position, no name, another university's campus).
 */
export function poiToDestination(json) {
  const coords = json?.point?.coordinates
  const name = strip(json?.title)
  if (!json?.poiId || !Array.isArray(coords) || !name || /^null$/i.test(name) || json.deleted) return null
  if (json.campusId != null && Number(json.campusId) !== Number(MAZEMAP.campusId)) return null
  return {
    id: `mm-${json.poiId}`,
    name,
    building: strip(json.buildingName),
    floor: typeof json.z === 'number' ? json.z : null,
    category: 'room',
    kind: (json.types || []).map((t) => strip(t.name)).filter(Boolean).join(', '),
    lat: coords[1],
    lng: coords[0],
    mazemapPoi: json.poiId,
    code: json.identifier ? strip(json.identifier) : null,
    source: 'mazemap',
  }
}

/**
 * Fetch a room by poiId. Resolves to a destination, or null if there is no such place here;
 * rejects only when MazeMap cannot be reached (so the screen can say "check your connection").
 */
export async function fetchPoiDestination(poiId, {fetchImpl = fetch, signal} = {}) {
  const res = await fetchImpl(`https://api.mazemap.com/api/pois/${encodeURIComponent(poiId)}/?srid=4326`, {signal})
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`MazeMap place lookup failed (HTTP ${res.status})`)
  return poiToDestination(await res.json())
}
