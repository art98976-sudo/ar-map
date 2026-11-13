// Load what the scene needs (Step 1): only the floor levels the route uses, and on each level only
// the tiles around the route's own points on it.
import {SCENE} from '../config.js'
import {fromLocal, toLocal} from '../geo/geo.js'
import {fetchFloor} from '../ar/mazemap-floor.js'
import {buildScene, OUTDOOR} from './scene-data.js'

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
