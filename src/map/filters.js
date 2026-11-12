// The category chips on the map, and the words shown for a place's category.

const OUTDOORS = 'Outdoors'
const NOT_BUILDINGS = new Set(['food', 'bus', 'room'])

export const MAP_FILTERS = [
  {
    id: 'buildings',
    label: 'Buildings',
    icon: 'building',
    match: (d) => Boolean(d.building) && d.building !== OUTDOORS && !NOT_BUILDINGS.has(d.category),
  },
  {id: 'library', label: 'Library', icon: 'book', match: (d) => d.category === 'library'},
  {id: 'food', label: 'Food', icon: 'cup', match: (d) => d.category === 'food' || (d.tags || []).includes('food')},
  {id: 'bus', label: 'Bus', icon: 'bus', match: (d) => d.category === 'bus'},
  {id: 'sport', label: 'Sport', icon: 'dumbbell', match: (d) => d.category === 'sport'},
]

/** Does this place show under the chip? No chip selected (null) shows everything. */
export function matchesFilter(dest, filterId) {
  if (!filterId) return true
  const filter = MAP_FILTERS.find((f) => f.id === filterId)
  return filter ? filter.match(dest) : true
}

const CATEGORY_LABEL = {
  library: 'Library',
  academic: 'Academic building',
  services: 'Student services',
  sport: 'Sport',
  landmark: 'Landmark',
  living: 'Student housing',
  food: 'Food and drink',
  bus: 'Bus stop',
  room: 'Room',
  town: 'In Stirling',
  parking: 'Car park',
}

export function categoryLabel(category) {
  return CATEGORY_LABEL[category] || 'Place'
}

/**
 * The quick chips in the map's bottom sheet, in order.
 * kind 'pins': our own places (MAP_FILTERS), shown as pins and listed.
 * kind 'rooms': toilets and lifts from the 3D campus model (public/data/room-types.json).
 * kind 'search': a MazeMap room search, for what our data has no tag for.
 */
export const QUICK_CHIPS = [
  {id: 'lecture', label: 'Lecture theatres', icon: 'lecture', kind: 'search', query: 'lecture theatre'},
  {id: 'toilets', label: 'Toilets', icon: 'toilet', kind: 'rooms', type: 'toilet'},
  {id: 'food', label: 'Food', icon: 'cup', kind: 'pins'},
  {id: 'library', label: 'Library', icon: 'book', kind: 'pins'},
  {id: 'study', label: 'Study spaces', icon: 'study', kind: 'search', query: 'study'},
  {id: 'lifts', label: 'Lifts', icon: 'lift', kind: 'rooms', type: 'lift'},
  {id: 'buildings', label: 'Buildings', icon: 'building', kind: 'pins'},
  {id: 'bus', label: 'Bus', icon: 'bus', kind: 'pins'},
  {id: 'sport', label: 'Sport', icon: 'dumbbell', kind: 'pins'},
]
