// Part D (?network=1): which ground arrows to draw from the map-constrained pose. Pure: the AR trip
// (trip.js -> nav-scene ground arrows) and the simulator use it every frame, so the arrows are
// redrawn after every anchor correction.
//
// - mode by confidence: >= 0.7 normal; 0.4-0.7 faded (with the minimap); < 0.4 hidden (minimap
//   only) until the next anchor lifts the confidence again;
// - only up to the next turn, door or stair or lift, on the current floor;
// - never through a wall: the arrows stop where the route ahead would cross one.
import {ARROWS_NET} from '../config.js'
import {along, routeModel} from './network-pose.js'

const models = new WeakMap()
const modelOf = (points) => {
  if (!models.has(points)) models.set(points, routeModel(points))
  return models.get(points)
}

/** The arrows' mode and opacity for a confidence. */
export function arrowMode(confidence) {
  if (!Number.isFinite(confidence) || confidence < ARROWS_NET.hideBelow) return {mode: 'hidden', opacity: 0, minimap: true}
  if (confidence < ARROWS_NET.fadeBelow) return {mode: 'faded', opacity: ARROWS_NET.fadedOpacity, minimap: true}
  return {mode: 'normal', opacity: 1, minimap: false}
}

/** Where the arrows stop: the next turn, door or floor change after s (or the end). */
export function nextStop(model, s) {
  const ahead = (list, kind, key = 's') => list.filter((x) => x[key] > s + ARROWS_NET.minAheadM).map((x) => ({s: x[key], kind}))
  const stops = [...ahead(model.turns, 'turn'), ...ahead(model.doors, 'door'), ...ahead(model.floorChanges, 'floor-change', 'sBottom'), {s: model.total, kind: 'end'}]
  return stops.sort((a, b) => a.s - b.s)[0]
}

/**
 * The arrows for a pose: {mode, opacity, minimap, untilS, stopKind, segments: [{a, b, z}]} in campus
 * metres along the route on the pose's floor, cut before the first wall crossing.
 */
export function planArrows({points, pose, crossesWall = () => false}) {
  const {mode, opacity, minimap} = arrowMode(pose?.confidence)
  const empty = {mode, opacity, minimap, untilS: pose?.s ?? 0, stopKind: null, segments: []}
  if (mode === 'hidden' || !pose?.started) return {...empty, mode: 'hidden', opacity: 0, minimap: true}
  const model = modelOf(points)
  const stop = nextStop(model, pose.s)
  const untilS = Math.min(stop.s, pose.s + ARROWS_NET.maxAheadM)
  const segments = []
  let s = pose.s
  let from = along(model, s)
  while (s < untilS - 1e-6) {
    const next = Math.min(untilS, s + ARROWS_NET.stepM)
    const to = along(model, next)
    if (to.z !== pose.z || from.seg.vertical || to.seg.vertical) break // the arrows stay on this floor
    if (crossesWall(pose.z, from, to)) return {mode, opacity, minimap, untilS: s, stopKind: 'wall', segments}
    segments.push({a: {x: from.x, y: from.y}, b: {x: to.x, y: to.y}, z: pose.z})
    s = next
    from = to
  }
  return {mode, opacity, minimap, untilS: s, stopKind: stop.kind, segments}
}
