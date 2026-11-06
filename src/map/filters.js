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
