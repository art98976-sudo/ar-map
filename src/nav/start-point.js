// Where a trip starts from: the phone's GPS, or a place or pin the user chose.
// A manual start knows exactly where the user stands, so AR runs on motion tracking from there.
// No DOM and no map here, so this can move to a native app unchanged.
import extraPlaces from '../data/start-places.json'
import {bearingDeg, compassPoint, distanceM} from '../geo/geo.js'
import {DESTINATIONS, POPULAR} from './destinations.js'
import {landmarkPhrase} from './guidance.js'

const START_KEY = 'welcomeAR.start.v1'
const RECENT_KEY = 'welcomeAR.startRecent.v1'
const MAX_RECENT = 5
const MIN_DOOR_M = 3 // a door closer to the place's centre than this says nothing about direction

export const START = {
  weakGpsM: 25, // GPS worse than this: suggest choosing a start instead
  liveGpsM: 15, // GPS this good, a few times running: offer to switch back to it
}

export const GPS_START = Object.freeze({type: 'gps'})
export const PLACE_LIST = [...DESTINATIONS, ...extraPlaces.places]
export const POPULAR_STARTS = POPULAR
const OUTDOOR = new Set(['bus', 'landmark', 'town', 'parking'])

const read = (storage, key, fallback) => {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback // private mode or corrupted data
  }
}
const write = (storage, key, value) => {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: the app carries on without remembering
  }
}

export const isManual = (start) => start?.type === 'place' || start?.type === 'map'

/** The start chosen in this session, GPS if none. */
export function getStart(storage = globalThis.sessionStorage) {
  const start = read(storage, START_KEY, null)
  return isManual(start) && Number.isFinite(start.lat) && Number.isFinite(start.lng) ? start : GPS_START
}

export function setStart(start, storage = globalThis.sessionStorage) {
  write(storage, START_KEY, start)
  return start
}

/** Which way someone faces standing at a door with it behind them; null if unknown. */
export function outwardHeading(centre, door) {
  if (!centre || !door || distanceM(centre, door) < MIN_DOOR_M) return null
  return Math.round(bearingDeg(centre, door))
}

/**
 * The doors of a place: its `entrances` list if it has one, otherwise its main entrance.
 * Each is {id, name, lat, lng, headingDeg, facing}. `facing` is words such as "the loch".
 */
export function entrancesOf(place) {
  const named = (e) => ({
    id: e.id,
    name: e.name,
    lat: e.lat,
    lng: e.lng,
    headingDeg: Number.isFinite(e.headingDeg) ? e.headingDeg : outwardHeading(place, e),
    facing: e.facing ?? null,
  })
  if (place.entrances?.length) return place.entrances.map(named)
  const door = place.entrance
  const hasDoor = door && Number.isFinite(door.lat) && Number.isFinite(door.lng)
  return [
    named({
      id: 'main',
      name: OUTDOOR.has(place.category) ? null : 'main entrance',
      lat: hasDoor ? door.lat : place.lat,
      lng: hasDoor ? door.lng : place.lng,
      headingDeg: door?.headingDeg,
      facing: door?.facing,
    }),
  ]
}

export function startFromPlace(place, entrance = entrancesOf(place)[0]) {
  return {
    type: 'place',
    placeId: place.id,
    entranceId: entrance.id,
    name: place.name,
    entranceName: entrance.name,
    lat: entrance.lat,
    lng: entrance.lng,
    headingDeg: entrance.headingDeg,
    facing: entrance.facing,
  }
}

export function startFromPin({lat, lng}) {
  return {type: 'map', name: 'Pin on the map', entranceName: null, lat, lng, headingDeg: null, facing: null}
}

/** A start seen as a destination, for the swap button. */
export function startAsDestination(start) {
  const place = start.placeId && DESTINATIONS.find((d) => d.id === start.placeId)
  if (place) return place
  return {id: `start-${Math.round(start.lat * 1e5)}-${Math.round(start.lng * 1e5)}`, name: start.name, category: 'landmark', building: '', floor: null, lat: start.lat, lng: start.lng}
}

/** "Cottrell main entrance", "Bus Hub", "Pin on the map". */
export function startLabel(start) {
  const short = start.name.replace(/ Building$/, '')
  return start.entranceName ? `${short} ${start.entranceName}` : short
}

/** The one short line on the AR screen: where to stand, and which way to face. */
export function standHereText(start) {
  if (start.type === 'map') return 'Stand where you put the pin.'
  const at = `Stand at ${landmarkPhrase(startLabel(start))}`
  if (start.facing) return `${at}, facing ${start.facing}.`
  if (start.headingDeg == null) return `${at}.`
  return `${at}, with the door behind you, facing ${compassPoint(start.headingDeg)}.`
}

// ---------- recent starting points ----------
export function getRecentStarts(storage = globalThis.localStorage) {
  const list = read(storage, RECENT_KEY, [])
  return Array.isArray(list) ? list.filter((p) => p?.id && p.name && PLACE_LIST.some((d) => d.id === p.id)) : []
}

export function addRecentStart(place, storage = globalThis.localStorage) {
  const {id, name, category, building = ''} = place
  const next = [{id, name, category, building, lat: place.lat, lng: place.lng}, ...getRecentStarts(storage).filter((p) => p.id !== id)].slice(0, MAX_RECENT)
  write(storage, RECENT_KEY, next)
  return next
}

export function clearRecentStarts(storage = globalThis.localStorage) {
  write(storage, RECENT_KEY, [])
}

/** The full record of a place picked from a list. Recents store only a little. */
export const placeById = (id) => PLACE_LIST.find((d) => d.id === id) ?? null
