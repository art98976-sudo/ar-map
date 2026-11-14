// Item 12: places a student pins ("My lectures", "My halls"), shown on the home sheet beside Recent.
// Kept in this browser only (localStorage). Nothing is sent anywhere.

const KEY = 'welcomeAR.saved.v1'
const MAX = 30
export const SAVED_GROUPS = [
  {id: 'lectures', label: 'My lectures'},
  {id: 'halls', label: 'My halls'},
  {id: 'other', label: 'Other places'},
]
const groupIds = new Set(SAVED_GROUPS.map((g) => g.id))

/** The few fields needed to open the place again (as Recent keeps them). */
function slim(dest) {
  const {id, name, building = '', floor = null, category = 'room', lat, lng, mazemapPoi = null, source = 'local'} = dest
  return {id, name, building, floor, category, lat, lng, mazemapPoi, source}
}

/** Every saved place: [{group, place}], newest first. */
export function getSaved(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) || '[]')
    return Array.isArray(list) ? list.filter((s) => groupIds.has(s?.group) && s.place?.id && s.place?.name) : []
  } catch {
    return []
  }
}

function write(list, storage) {
  try {
    storage?.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage full or blocked: works for this visit only
  }
}

/** The group a place is saved in, or null. */
export function savedGroup(id, storage = globalThis.localStorage) {
  return getSaved(storage).find((s) => s.place.id === id)?.group ?? null
}

/** Save a place in a group (moving it if it was in another). */
export function savePlace(dest, group, storage = globalThis.localStorage) {
  if (!groupIds.has(group) || !dest?.id) return getSaved(storage)
  const next = [{group, place: slim(dest)}, ...getSaved(storage).filter((s) => s.place.id !== dest.id)].slice(0, MAX)
  write(next, storage)
  return next
}

export function unsavePlace(id, storage = globalThis.localStorage) {
  const next = getSaved(storage).filter((s) => s.place.id !== id)
  write(next, storage)
  return next
}

/** For the home sheet: the groups that have places, in their fixed order. */
export function savedByGroup(storage = globalThis.localStorage) {
  const all = getSaved(storage)
  return SAVED_GROUPS.map((g) => ({...g, places: all.filter((s) => s.group === g.id).map((s) => s.place)})).filter((g) => g.places.length)
}
