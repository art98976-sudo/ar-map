// Alignment Phase 4: floor changes from SLAM's height, not from route progress.
// The floor the user is on changes only when the camera has climbed (or dropped) about a floor
// since the last confirmed floor, near one of the route's stairs or lifts, in that link's
// direction. The floor's walls then switch, and the user is re-anchored at the landing: the stair
// or lift position on the new floor, which MazeMap knows exactly.
// A lift is a wait and a ride in place; a switchback stair walks out and back while climbing:
// neither moves route progress usefully, so progress never decides the floor indoors.
// Route frame metres {x east, y north}; pure (no three.js).
import {toLocal} from '../geo/geo.js'
import {FLOOR_CHANGE, INDOOR} from '../config.js'

/**
 * The route's floor changes: [{s, fromLevel, toLevel, riseM, foot {x, y}, top {x, y}, kind}].
 * points: the route's points [{lat, lng, z, h?, edgeType?}]; origin: the route frame's origin.
 * sceneLinks (scene-data.js buildScene().links, optional) say whether each is a stair or a lift.
 */
export function routeFloorLinks(points, origin, sceneLinks = []) {
  const local = points.map((p) => toLocal(origin, p))
  const sAt = []
  local.forEach((q, i) => sAt.push(i ? sAt[i - 1] + Math.hypot(q.x - local[i - 1].x, q.y - local[i - 1].y) : 0))
  const out = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a.z || !b.z || a.z === b.z) continue
    const riseM = Number.isFinite(a.h) && Number.isFinite(b.h) && a.h !== b.h ? b.h - a.h : levelRise(a.z, b.z)
    const scene = sceneLinks.find((l) => Math.abs(l.s - sAt[i]) < FLOOR_CHANGE.linkMatchM && l.fromLevel === a.z && l.toLevel === b.z)
    const run = sAt[i] - sAt[i - 1]
    const kind = scene?.kind ?? (b.edgeType === 'lift' || a.edgeType === 'lift' ? 'lift' : b.edgeType === 'stairs' || run >= 1 ? 'stairs' : 'unknown')
    out.push({index: i, s: sAt[i - 1], sTop: sAt[i], fromLevel: a.z, toLevel: b.z, riseM, foot: local[i - 1], top: local[i], kind})
  }
  return out
}

/** Floors are counted in order and MazeMap skips 0: -1 is directly below 1. */
function levelRise(from, to) {
  const index = (z) => (z > 0 ? z - 1 : z)
  return (index(to) - index(from)) * INDOOR.floorHeightM
}

const near = (p, q) => (p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity)

/**
 * Watches the camera's height for floor changes.
 * level: the floor the user is on (0 outdoors). camY: the camera's SLAM height (metres, up).
 * update({camY, here, s, routeLevel}) once a frame with tracking NORMAL; here: the tracked
 * position (route frame), s: route progress, routeLevel: the route's level at s (it decides only
 * going in or out of a building: through a door the height does not change).
 * Returns {switched: {from, to, link, landing {x, y}, landingS} | null, inTransit}.
 */
export function createFloorWatch(links, {level, camY}) {
  let current = level ?? 0
  let baseY = camY
  return {
    get level() {
      return current
    },
    /** How far the camera has climbed (> 0) or dropped since the floor was confirmed. */
    riseM(camY) {
      return camY - baseY
    },
    /** The user says (or an anchor shows) which floor they are on: count from here. */
    confirm(nextLevel, camY) {
      current = nextLevel
      baseY = camY
    },
    update({camY, here = null, s = null, routeLevel = null}) {
      const out = {switched: null, inTransit: false}
      // Through a door: outdoors (0) and a floor, with no change of height.
      if (Number.isFinite(routeLevel) && (current === 0) !== (routeLevel === 0)) {
        current = routeLevel
        baseY = camY
        return out
      }
      if (current === 0) return out
      const dy = camY - baseY
      out.inTransit = Math.abs(dy) >= FLOOR_CHANGE.transitM
      let best = null
      for (const link of links) {
        // The route's way through the link, or back the other way.
        const forward = link.fromLevel === current
        const back = link.toLevel === current
        if (!forward && !back) continue
        const rise = forward ? link.riseM : -link.riseM
        if (Math.sign(dy) !== Math.sign(rise)) continue
        const needed = Math.max(FLOOR_CHANGE.minRiseM, FLOOR_CHANGE.riseShare * Math.abs(rise))
        if (Math.abs(dy) < needed || Math.abs(dy) > Math.abs(rise) * FLOOR_CHANGE.maxRiseShare + 1) continue
        const close = Math.min(near(here, link.foot), near(here, link.top)) <= FLOOR_CHANGE.nearM || (Number.isFinite(s) && Math.abs(s - link.s) <= FLOOR_CHANGE.nearM)
        if (!close) continue
        const miss = Math.abs(dy - rise)
        if (!best || miss < best.miss) best = {link, forward, rise, miss}
      }
      if (!best) return out
      const {link, forward, rise} = best
      const from = current
      current = forward ? link.toLevel : link.fromLevel
      baseY += rise // the climb beyond this floor still counts towards the next one
      out.switched = {from, to: current, link, landing: forward ? link.top : link.foot, landingS: forward ? link.sTop : link.s}
      out.inTransit = Math.abs(camY - baseY) >= FLOOR_CHANGE.transitM
      return out
    },
  }
}
