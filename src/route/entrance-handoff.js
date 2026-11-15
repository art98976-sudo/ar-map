// Item 7: at a building's entrance on the way to a room, AR hands over to the indoor map, on the
// floor the door is on, with one line saying why: GPS cannot see inside, the floor plan can. A card
// counts down a few seconds with "Keep using AR", so nobody is switched against their will. Pure.
import {polylineLength, toLocal} from '../geo/geo.js'
import {t} from '../i18n/i18n.js'

export const HANDOFF = {
  atDoorM: 5, // this close to the door along the route: hand over
  countdownS: 5, // the card waits this long before opening the indoor map
}

/** Metres along the AR route to the entrance: the end of the outdoor part. null if no indoor part. */
export function doorAlongM(route) {
  const outdoor = route?.points ?? []
  if (outdoor.length < 2 || !(route?.indoorPoints?.length >= 2)) return null
  const origin = outdoor[0]
  return polylineLength(outdoor.map((p) => toLocal(origin, p)))
}

/** The floor the indoor map opens on: the door's, so the walker starts where they are. */
export function entryFloor(route, dest) {
  const z = route?.entryLevel ?? route?.indoorPoints?.[0]?.z
  return Number.isFinite(z) ? z : (dest?.floor ?? null)
}

/** Hand over now? A room with an indoor route, the trip under way, the walker at the door. */
export function atEntrance({dest, route, userS, phase, dismissed = false, doorS = doorAlongM(route)}) {
  if (dismissed || phase !== 'ready' || dest?.category !== 'room' || doorS == null || !Number.isFinite(userS)) return false
  return userS >= doorS - HANDOFF.atDoorM
}

/** The one line: "You're at the Cottrell main entrance. The indoor map takes over on Level 1: GPS can't see you inside." */
export function handoffLine({entranceName, floor}) {
  const where = entranceName ? t('handoffLine.at', {entrance: entranceName}) : t('handoffLine.atDoor')
  return `${where} ${Number.isFinite(floor) ? t('handoffLine.takesOverLevel', {level: floor}) : t('handoffLine.takesOver')}`
}

/** The indoor map's address for the handoff. */
export function indoorLink(destId, floor) {
  const query = new URLSearchParams({to: destId, from: 'ar'})
  if (Number.isFinite(floor)) query.set('floor', String(floor))
  return `/indoor?${query}`
}
