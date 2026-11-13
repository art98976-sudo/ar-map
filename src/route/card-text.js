// The words on the destination card: "1 min · 95 m", "Enter by Cottrell main entrance, then
// Level 2", "Stairs or lift needed". Pure, so it is tested without a map or a network.
import {formatDistance} from '../ar/pin.js'
import {distanceM} from '../geo/geo.js'
import {normalize} from '../map/search.js'
import {CARD, ROUTING} from '../config.js'
import {walkingMinutes} from './route.js'

/** "1 min · 95 m" from a walking distance in metres; null without one. */
export function walkSummary(metres) {
  if (!Number.isFinite(metres) || metres < 0) return null
  return `${walkingMinutes(metres)} min · ${formatDistance(Math.max(1, metres))}`
}

/** Before a route is planned: the straight line, times how much longer paths usually are. */
export function estimatedWalkM(from, to) {
  if (!from || !to) return null
  return distanceM(from, to) * CARD.pathFactor
}

/** The card's grey line under the name, or '' when it would only repeat the name. */
export function subtitleFor(name, subtitle) {
  return subtitle && normalize(subtitle) !== normalize(name) ? subtitle : ''
}

const short = (name) => String(name || '').replace(/ Building$/, '')

/**
 * The name of the door a route goes in by. A known main entrance of the building (from our
 * places) when the route's door is near it; otherwise "<Building> entrance".
 *   places: our destination list. door: {lat, lng} where the route enters, or null if not planned yet.
 */
export function entranceNameFor(dest, door, places) {
  if (!dest?.building) return null
  const building = normalize(dest.building)
  const inBuilding = places.filter((p) => p.entrance && (normalize(p.building) === building || normalize(p.name) === building))
  const known = inBuilding.find((p) => !door || distanceM(p.entrance, door) <= CARD.sameDoorM)
  if (known) return `${short(known.name)} main entrance`
  return `${short(dest.building)} entrance`
}

/**
 * The indoor lines for a room: "Enter by X, then Level n", and whether stairs or a lift are
 * needed (the room's level differs from the level the route comes in at, once that is known).
 */
export function indoorLines(dest, {entranceName, entryLevel = null} = {}) {
  if (dest?.category !== 'room' || dest.floor == null || !entranceName) return {enter: null, stairs: false}
  return {
    enter: `Enter by ${entranceName}, then Level ${dest.floor}`,
    stairs: Number.isFinite(entryLevel) && entryLevel !== dest.floor,
  }
}

/**
 * What the marker at the end of the AR walk says (6.4). A room, with indoor AR off, ends at the
 * building's door: the marker names that entrance. Anything else: the place's own name.
 */
export function markerName(dest, door, places, indoorAR = false) {
  if (dest?.category === 'room' && !indoorAR) return entranceNameFor(dest, door, places) ?? dest.name
  return dest?.name ?? null
}

/** Is the user's GPS too rough to trust the walk time? */
export function locationApproximate(fix) {
  return Boolean(fix && Number.isFinite(fix.accuracy) && fix.accuracy > CARD.approximateM)
}

/** The trip pill: "Cottrell · 120 m · 2 min". The same words in AR and on the map trip. */
export function tripPillText(name, metres) {
  const minutes = Math.max(1, Math.round(metres / ROUTING.walkSpeedMps / 60))
  return `${name.replace(/ Building$/, '')} · ${formatDistance(metres)} · ${minutes} min`
}
