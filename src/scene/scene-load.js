// Load what the scene needs (Step 1): only the floor levels the route uses, and on each level only
// the tiles around the route's own points on it.
import {FIT, SCENE} from '../config.js'
import {fromLocal, toLocal} from '../geo/geo.js'
import {fetchFloor} from '../ar/mazemap-floor.js'
import {buildScene, OUTDOOR} from './scene-data.js'
import {fitRoute} from './fit-route.js'

/** {level: {west, south, east, north}}: a box around the route's points on each level. */
export function levelBoxes(route, marginM = SCENE.marginM) {
  const origin = route[0]
  const byLevel = new Map()
  for (const p of route) {
    if (!Number.isFinite(p.z) || p.z === OUTDOOR) continue // outdoors has no floor tiles
    const {x, y} = toLocal(origin, p)
    const b = byLevel.get(p.z) ?? {x0: x, x1: x, y0: y, y1: y}
    byLevel.set(p.z, {x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), y0: Math.min(b.y0, y), y1: Math.max(b.y1, y)})
  }
  const out = {}
  for (const [level, b] of byLevel) {
    const sw = fromLocal(origin, {x: b.x0 - marginM, y: b.y0 - marginM})
    const ne = fromLocal(origin, {x: b.x1 + marginM, y: b.y1 + marginM})
    out[level] = {west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat}
  }
  return out
}

/** Fetch the route's floors and build the scene. route: MazeMap points with z. */
export async function loadScene(route, origin = route[0], {fetchImpl = fetch, signal} = {}) {
  const boxes = levelBoxes(route)
  const entries = await Promise.all(Object.entries(boxes).map(async ([level, box]) => [level, await fetchFloor(Number(level), box, {fetchImpl, signal})]))
  return buildScene({route, origin, floors: Object.fromEntries(entries)})
}

/**
 * Step 2: MazeMap's route, fitted to the scene. This is the route everything uses. If the floors
 * cannot be loaded in time, the route is still fitted outdoors (the start kink) and marked so.
 * Returns the parsed MazeMap route with fitted points, plus `fitted` for ?debug=route.
 */
export async function fitMazeMapRoute(mm, {from = null, fetchImpl = fetch, timeoutMs = FIT.loadTimeoutMs} = {}) {
  if (!mm.points || mm.points.length < 2) return mm
  // The route starts where the user is, so the start kink is measured from them, not from the
  // network node MazeMap began at.
  const first = mm.points[0]
  const user = from && (Math.abs(from.lat - first.lat) > 1e-6 || Math.abs(from.lng - first.lng) > 1e-6) ? {lat: from.lat, lng: from.lng, z: first.z ?? OUTDOOR} : null
  const raw = user ? [user, ...mm.points] : mm.points
  let scene
  let sceneLoaded = true
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    scene = await Promise.race([loadScene(raw, raw[0], {fetchImpl}), timeout])
  } catch (err) {
    console.warn('[route] floors not loaded, fitting outdoors only', err?.message)
    scene = buildScene({route: raw, origin: raw[0], floors: {}})
    sceneLoaded = false
  }
  const fitted = fitRoute(scene)
  const points = fitted.latlng
  const firstIndoor = points.findIndex((p) => Number.isFinite(p.z) && p.z !== OUTDOOR)
  // Outdoors up to the door: the first point on a floor is the door the walk goes in by.
  // The door is where the outdoor walk ends (marked outdoors, as MazeMap marks its last step).
  const door = firstIndoor > 0 ? points[firstIndoor] : null
  const lastOut = firstIndoor > 0 ? points[firstIndoor - 1] : null
  const atDoor = door && lastOut && Math.abs(door.lat - lastOut.lat) < 5e-6 && Math.abs(door.lng - lastOut.lng) < 5e-6
  const outdoorPoints = firstIndoor < 0 ? points : atDoor ? points.slice(0, firstIndoor) : [...points.slice(0, firstIndoor), {...door, z: OUTDOOR}]
  return {
    ...mm,
    points,
    outdoorPoints,
    fitted: {
      raw,
      lengthM: fitted.lengthM,
      repairs: fitted.repairs.map((r) => ({...r, ...fromLocal(scene.origin, r)})),
      doors: fitted.doors.length,
      startSavedM: fitted.startSavedM,
      sceneLoaded,
      problems: scene.problems,
    },
  }
}
