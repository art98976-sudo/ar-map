// Facts about the 3D campus model (public/data/stirling_campus.glb) shared by the map layer,
// the room-centre build tool and the AR trip. No three.js here, so it is cheap to import.
import {fromLocal} from '../geo/geo.js'

// The model's (0,0,0): ground level at this point. Units are metres, x east, y up, -z north.
export const CAMPUS_ORIGIN = {lat: 56.1455, lng: -3.92}

/** "teaching_COTT_A3LT_1002084999" -> "1002084999". Room meshes end in their MazeMap poiId. */
export function poiIdOf(name) {
  const m = /_(\d{6,})$/.exec(name || '')
  return m ? m[1] : null
}

/** "B_Cottrell_Building_L2" -> 2, "B_Robbins_Centre_L-1" -> -1. Only floor nodes match. */
export function floorLevelOf(name) {
  const m = /^B_.+_L(-?\d+)$/.exec(name || '')
  return m ? Number(m[1]) : null
}

/** A floor part: "..._L2_walls" -> 'walls'. */
export function floorPartOf(name) {
  const m = /_L-?\d+_(slab|walls|lintels)$/.exec(name || '')
  return m ? m[1] : null
}

/** Metres east/north of the model origin -> GPS point. */
export function modelToLatLng(east, north) {
  return fromLocal(CAMPUS_ORIGIN, {x: east, y: north})
}

/**
 * Which floor of a building to draw when the map shows `level`: that floor if it has one,
 * else the nearest one below, else its lowest. Returns null for a building with no floors.
 */
export function floorToShow(levels, level) {
  if (!levels.length) return null
  if (levels.includes(level)) return level
  const below = levels.filter((l) => l < level)
  return below.length ? Math.max(...below) : Math.min(...levels)
}
