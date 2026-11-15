// The home map reopens where the student last left it: the centre, zoom and turn of the map after
// they moved it themselves. Kept in this browser only (localStorage). It is where the map was
// looking, never where the student was, and nothing is sent anywhere.
import {HOME_MAP, MAZEMAP} from '../config.js'

const KEY = 'welcomeAR.lastView.v1'

/** A view worth reopening: real numbers, on or near the campus, at a zoom MazeMap can show. */
export function validView(view) {
  if (!view || typeof view !== 'object') return null
  const {lng, lat, zoom, bearing = 0} = view
  if (![lng, lat, zoom, bearing].every(Number.isFinite)) return null
  if (Math.abs(lng - MAZEMAP.center.lng) > HOME_MAP.lastViewRangeDeg || Math.abs(lat - MAZEMAP.center.lat) > HOME_MAP.lastViewRangeDeg) return null
  if (zoom < HOME_MAP.lastViewMinZoom || zoom > 22) return null
  return {lng, lat, zoom, bearing}
}

/** The view saved last time, or null (none, broken or off campus). */
export function readLastView(storage = globalThis.localStorage) {
  try {
    return validView(JSON.parse(storage?.getItem(KEY) || 'null'))
  } catch {
    return null
  }
}

export function saveLastView(view, storage = globalThis.localStorage) {
  const ok = validView(view)
  if (!ok) return
  try {
    storage?.setItem(KEY, JSON.stringify({lng: +ok.lng.toFixed(6), lat: +ok.lat.toFixed(6), zoom: +ok.zoom.toFixed(2), bearing: Math.round(ok.bearing)}))
  } catch {
    // storage full or blocked: the map opens on Campus Central next time
  }
}

/**
 * Save the view each time the student finishes moving the map. A move the app makes (flying to a
 * place, framing a route, the opening) has no originalEvent and is not saved.
 */
export function watchLastView(map, storage = globalThis.localStorage) {
  const onEnd = (event) => {
    if (!event?.originalEvent) return
    const c = map.getCenter()
    saveLastView({lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing()}, storage)
  }
  map.on('moveend', onEnd)
  return () => map.off('moveend', onEnd)
}
