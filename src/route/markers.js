// Item 8: calibration signs at the main entrances and the Bus Hub (src/data/markers.json).
// Each sign's QR code opens /c/<id>. That sets the trip's start to the spot in front of the sign,
// and, where the sign's facing direction is known, the heading too: the walker stands with their
// back to the sign, so AR starts from an exact place and direction (camera tracking carries on
// from there), with no GPS or compass needed. Pure, apart from reading the data file.
import data from '../data/markers.json'
import {fromLocal, toLocal} from '../geo/geo.js'

export const MARKERS = data.markers
export const STAND_OUT_M = 1.5 // the walker stands this far in front of the sign
export const SITE = 'https://stirling-welcome-ar.vercel.app'

export function findMarker(id) {
  return MARKERS.find((m) => m.id === id) ?? null
}

/** The address a sign's QR code holds. */
export function markerUrl(id, origin = SITE) {
  return `${origin}/c/${encodeURIComponent(id)}`
}

/** The spot STAND_OUT_M in front of the sign, along the way it faces (the sign itself if unknown). */
export function standingSpot(marker) {
  if (!Number.isFinite(marker.facingDeg)) return {lat: marker.lat, lng: marker.lng}
  const a = (marker.facingDeg * Math.PI) / 180
  const here = toLocal(marker, marker)
  return fromLocal(marker, {x: here.x + Math.sin(a) * STAND_OUT_M, y: here.y + Math.cos(a) * STAND_OUT_M})
}

/**
 * The trip start for a sign, in the start-point.js format of a door start: headingDeg is the way the
 * walker faces with the sign (and the door) behind them, which AR takes as its starting direction.
 */
export function markerStart(marker) {
  const spot = standingSpot(marker)
  return {
    type: 'place',
    placeId: marker.place,
    entranceId: `sign-${marker.id}`,
    name: marker.label,
    entranceName: 'sign',
    lat: spot.lat,
    lng: spot.lng,
    headingDeg: Number.isFinite(marker.facingDeg) ? marker.facingDeg : null,
    facing: null,
    markerId: marker.id,
  }
}

/** The /c/<id> path: the sign's id, or null. */
export function markerIdFromPath(pathname) {
  const m = /^\/c\/([\w.-]+)\/?$/.exec(pathname || '')
  return m ? decodeURIComponent(m[1]) : null
}
