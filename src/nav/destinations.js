// The destination list, recent searches, and the destination chosen for this trip.
// Recent searches live only in this browser (localStorage). Nothing is sent anywhere.
import data from '../data/destinations.json'

const RECENT_KEY = 'welcomeAR.recent.v1'
const CURRENT_KEY = 'welcomeAR.destination.v1'
const MAX_RECENT = 6

export const DESTINATIONS = data.destinations
export const POPULAR = data.popularOrder.map((id) => DESTINATIONS.find((d) => d.id === id)).filter(Boolean)
export const TOWN_PLACES = DESTINATIONS.filter((d) => d.area === 'town')

function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback // private mode or corrupted data
  }
}
function write(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: the app keeps working without it
  }
}

/** Keep only the fields we need, so stored data stays small and predictable. */
function slim(dest) {
  const {id, name, building = '', floor = null, category = 'room', lat, lng, mazemapPoi = null, source = 'local'} = dest
  return {id, name, building, floor, category, lat, lng, mazemapPoi, source}
}

export function getRecent(storage = window.localStorage) {
  const list = read(storage, RECENT_KEY, [])
  return Array.isArray(list) ? list.filter((d) => d && d.id && d.name) : []
}

export function addRecent(dest, storage = window.localStorage) {
  const next = [slim(dest), ...getRecent(storage).filter((d) => d.id !== dest.id)].slice(0, MAX_RECENT)
  write(storage, RECENT_KEY, next)
  return next
}

export function clearRecent(storage = window.localStorage) {
  write(storage, RECENT_KEY, [])
}

/** Remember the trip's destination for the camera screen (survives a reload, not a new tab). */
export function setCurrentDestination(dest, storage = window.sessionStorage) {
  write(storage, CURRENT_KEY, slim(dest))
}

/** Find a destination by id: our list first, then the one stored for this trip. */
export function findDestination(id, storage = window.sessionStorage) {
  if (!id) return null
  const local = DESTINATIONS.find((d) => d.id === id)
  if (local) return local
  const current = read(storage, CURRENT_KEY, null)
  return current && current.id === id ? current : null
}
