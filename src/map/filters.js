// The category chips on the map, and the words shown for a place's category.
import {t} from '../i18n/i18n.js'

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

const CATEGORIES = new Set(['library', 'academic', 'services', 'sport', 'landmark', 'living', 'food', 'bus', 'room', 'town', 'parking'])

export function categoryLabel(category) {
  return t(CATEGORIES.has(category) ? `cat.${category}` : 'cat.place')
}

// Item 13: a chip's label is read when it is drawn, in the language in use.
const chip = (c) => Object.defineProperty(c, 'label', {get: () => t(`chip.${c.id}`), enumerable: true})

/**
 * The quick chips in the map's bottom sheet, in order.
 * kind 'pins': our own places (MAP_FILTERS), shown as pins and listed.
 * kind 'rooms': toilets and lifts from the 3D campus model (public/data/room-types.json).
 * kind 'search': a MazeMap room search, for what our data has no tag for.
 */
export const QUICK_CHIPS = [
  {id: 'lecture', icon: 'lecture', kind: 'search', query: 'lecture theatre'},
  {id: 'toilets', icon: 'toilet', kind: 'rooms', type: 'toilet'},
  {id: 'food', icon: 'cup', kind: 'pins'},
  {id: 'library', icon: 'book', kind: 'pins'},
  {id: 'study', icon: 'study', kind: 'search', query: 'study'},
  {id: 'lifts', icon: 'lift', kind: 'rooms', type: 'lift'},
  {id: 'buildings', icon: 'building', kind: 'pins'},
  {id: 'bus', icon: 'bus', kind: 'pins'},
  {id: 'sport', icon: 'dumbbell', kind: 'pins'},
].map(chip)
