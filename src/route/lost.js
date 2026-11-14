// Item 8: "I'm lost". One tap during a trip re-centres on the walker, plans again from where they
// are, and names the nearest place they can see ("You are near the Sports Centre"). Pure.
import {distanceM, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {landmarkPhrase} from './guidance.js'

export const LOST = {nearM: 150, roughM: 50}

// OpenStreetMap's names, as people on campus say them (as in trip-steps.js).
const NAME_FIXES = {'Atrium / Andrew Miller Building': 'Andrew Miller Building', 'RG Bormont Building': 'RG Bomont Building', 'Gannochy Sports Centre': 'Sports Centre', 'INTO building': 'INTO Building'}

/**
 * The nearest named place to a fix: a campus place (its centre or entrance) or a named building
 * from the landmark data (its outline). {name, distanceM} or null when none within nearM.
 */
export function nearestPlace(fix, {destinations = [], osm = null} = {}, nearM = LOST.nearM) {
  if (!fix || !Number.isFinite(fix.lat)) return null
  let best = null
  const consider = (name, d) => {
    if (name && Number.isFinite(d) && d <= nearM && (!best || d < best.distanceM)) best = {name: NAME_FIXES[name] ?? name, distanceM: d}
  }
  for (const p of destinations) {
    if (p.area === 'town' || !Number.isFinite(p.lat)) continue
    consider(p.name, Math.min(distanceM(fix, p), p.entrance ? distanceM(fix, p.entrance) : Infinity))
  }
  for (const a of osm?.areas ?? []) {
    if (a.kind === 'water' || a.pts.length < 3) continue
    const ring = a.pts.map(([lat, lng]) => toLocal(fix, {lat, lng}))
    consider(a.name, projectOntoPolyline([...ring, ring[0]], {x: 0, y: 0}).offset)
  }
  return best
}

/** The one line: where they are, and that a new route is on its way. */
export function lostMessage(near, accuracyM = null) {
  const rough = Number.isFinite(accuracyM) && accuracyM > LOST.roughM
  const where = near ? `You are near ${landmarkPhrase(near.name)}.` : 'There is no named place close by.'
  return `${where}${rough ? ' Your position is approximate.' : ''} New route from here.`
}
