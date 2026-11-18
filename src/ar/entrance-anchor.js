// Fix 3: re-align at the building entrance, with no markers and no scanning step.
//
// GPS and the compass get worse next to and inside buildings, so a correct path can end up a few
// metres off or turned. The door the route goes in by is known exactly (MazeMap). When route
// progress reaches it, the AR path is put back on it: the user is placed at the door, and the
// path is turned so its direction through the door matches the way the user has just walked
// (SLAM). From there SLAM carries the position indoors; GPS only says when the user has gone back
// outside. A compass swinging near steel or concrete never turns the arrows: the last good
// heading is kept.
// Pure functions and small state machines: no DOM, no three.js.
import {ENTRANCE} from '../config.js'
import {angleDiff, localBearing, pointAt} from '../geo/geo.js'

/**
 * Where the door is along a route that goes indoors: the first point on a floor (z ≠ 0) after an
 * outdoor stretch. Returns its index, or -1 for a route that never enters a building.
 */
export function entranceIndex(points) {
  const first = points.findIndex((p) => Number.isFinite(p.z) && p.z !== 0)
  return first > 0 ? first : -1
}

/**
 * Should the path be re-anchored now, and how?
 * route: route-frame polyline [{x, y}] (x east, y north). doorS: the door's distance along it.
 * s: the user's progress along it. track: the user's recent walk in the route frame, oldest
 * first (from SLAM). Returns null (not at the door) or {s, at, turnDeg, walkedM}:
 * put the user at `at` (the door), and turn the path `turnDeg` clockwise about them (0 when the
 * walk is too short, or the turn too large, to trust).
 */
export function planEntranceAnchor({route, doorS, s, track = []}, cfg = ENTRANCE) {
  // At the door: from just before it (progress is never exact) to nearM after it (a slow frame).
  if (!Number.isFinite(doorS) || !Number.isFinite(s) || s < doorS - cfg.beforeM || s > doorS + cfg.nearM) return null
  const at = pointAt(route, doorS)
  // The walk: from the point walkM back along the track to now.
  let walkedM = 0
  let from = track.at(-1)
  for (let i = track.length - 1; i > 0 && walkedM < cfg.walkM; i--) {
    walkedM += Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y)
    from = track[i - 1]
  }
  let turnDeg = 0
  if (walkedM >= cfg.minWalkM && track.length >= 2) {
    const walkDeg = localBearing(from, track.at(-1)) // the way the user walked, in the route frame
    const corridorDeg = localBearing(pointAt(route, Math.max(0, doorS - cfg.corridorM)), pointAt(route, doorS + cfg.corridorM))
    // The route frame sees the walk turned by (walk - corridor) from the corridor. Turning the
    // path that much clockwise makes the walk run along the corridor through the door.
    const diff = angleDiff(corridorDeg, walkDeg)
    if (Math.abs(diff) <= cfg.maxTurnDeg) turnDeg = diff
  }
  return {s: doorS, at, turnDeg, walkedM}
}

/**
 * GPS indoors. While the user is inside, a fix never moves the position (indoor GPS is noise);
 * it only tells, after `outsideFixes` good fixes in a row, that the user has gone back outside.
 */
export function createIndoorGpsGate(cfg = ENTRANCE) {
  let goodRun = 0
  return {
    /** A new fix. indoors: the user is inside by route progress. Returns {use, outside}. */
    update(fix, indoors) {
      goodRun = Number.isFinite(fix?.accuracy) && fix.accuracy <= cfg.outsideAccuracyM ? goodRun + 1 : 0
      const outside = goodRun >= cfg.outsideFixes
      return {use: !indoors || outside, outside: indoors && outside}
    },
  }
}

/**
 * The compass heading to steer with. While the compass swings more than holdSwingDeg against the
 * camera (it does near steel and concrete), the last good heading is kept instead of the live one.
 */
export function createHeadingHold(cfg = ENTRANCE) {
  let lastGood = null
  let holding = false
  return {
    /** heading: the live (smoothed) compass; swingDeg: how much it swung lately against the camera. */
    update(heading, swingDeg) {
      holding = Number.isFinite(swingDeg) && swingDeg > cfg.holdSwingDeg && lastGood != null
      if (!holding && Number.isFinite(heading)) lastGood = heading
      return holding ? lastGood : heading
    },
    get holding() {
      return holding
    },
  }
}
