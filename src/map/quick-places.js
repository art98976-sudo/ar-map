// What a quick chip lists: the nearest places of that kind, as rows for the bottom sheet and as
// destinations the place card understands. Pure apart from the two loaders at the bottom.
import {DESTINATIONS} from './destinations.js'
import {categoryLabel, matchesFilter} from './filters.js'
import {searchMazeMap} from './mazemap-search.js'
import {CATEGORY_ICON} from '../ui/icons.js'
import {distanceM} from '../geo/geo.js'

const MAX_ROWS = 30

/** "120 m" / "1.4 km". */
export function formatAway(metres) {
  if (!Number.isFinite(metres)) return ''
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : `${(metres / 1000).toFixed(1)} km`
}

const detailOf = (dest, from, showDistance) =>
  [dest.building && dest.building !== dest.name ? dest.building : categoryLabel(dest.category), dest.floor != null ? `Level ${dest.floor}` : '', from && showDistance ? formatAway(distanceM(from, dest)) : '']
    .filter(Boolean)
    .join(' · ')

/**
 * Destinations nearest `from` first, as {dest, name, detail, icon} rows. The distance is shown
 * only when `from` is the user (showDistance), not the middle of the map.
 */
export function toRows(dests, from, iconName, {showDistance = true} = {}) {
  const sorted = from ? [...dests].sort((a, b) => distanceM(from, a) - distanceM(from, b)) : dests
  return sorted.slice(0, MAX_ROWS).map((dest) => ({dest, name: dest.name, detail: detailOf(dest, from, showDistance), icon: iconName || CATEGORY_ICON[dest.category] || 'pin'}))
}

/** Our own places under one of the map filters. */
export function pinPlaces(filterId) {
  return DESTINATIONS.filter((d) => d.area !== 'town' && matchesFilter(d, filterId))
}

/** Rows of public/data/room-types.json -> destinations. */
export function roomTypeDestinations(rows = []) {
  return rows.map(([poiId, lat, lng, floor, name, building]) => ({
    id: `mm-${poiId}`,
    name,
    building,
    floor,
    category: 'room',
    lat,
    lng,
    mazemapPoi: Number(poiId),
    source: 'mazemap',
  }))
}

let roomTypes = null
/** Toilets and lifts from the campus model, fetched once. */
export async function loadRoomTypes(fetchImpl = fetch) {
  roomTypes ??= fetchImpl('/data/room-types.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((err) => {
      roomTypes = null
      throw err
    })
  return roomTypes
}

/** Rooms of a kind MazeMap knows by name (lecture theatres, study spaces). */
export function searchPlaces(query, {signal} = {}) {
  return searchMazeMap(query, {signal, rows: 20})
}
