// Alignment Phase 3: MazeMap's walls as rules for the AR trip, indoors.
//   - The tracked position (SLAM through the route placement) never crosses a wall. When it does,
//     the placement is wrong: the user is put back at the nearest corridor point they could have
//     reached (on the route, with no wall between), within the correction budget.
//   - The trip's progress along the route follows the tracked position's corridor point, so a lag
//     at a corner can no longer stall it (walking past the turn read as "sideways" for ever).
//   - Path matching re-runs at every door crossing and every route turn of 35° or more.
//   - A door anchor: the tracked walk crosses the line of a door the route goes through, near where
//     the route crosses it. A confirmed anchor lets the placement move by more than the budget.
//   - A confidence 0..1 that the arrows lie on the corridor: low, they fade and "Keep walking" shows.
// Route frame metres {x east, y north}; pure (no three.js), so it is tested on its own.
import {findTurns, pointAt, polylineLength} from '../geo/geo.js'
import {createSegmentIndex, ringSegments} from '../scene/scene-data.js'
import {doorCrossings, segmentCross} from './building-shell.js'
import {CORRIDOR} from '../config.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The wall rules for one floor: a shell floor from the scene (scene-data.js: wallSegs, wallIndex,
 * doors {a, b}) or from mazemap-floor.js through floorToLocal (walls as polygons, doors {a, b}).
 * crosses(a, b): walking a -> b goes through a wall (not through a doorway). Returns the first hit.
 */
export function wallRules(floor, {doorGapM = CORRIDOR.doorGapM} = {}) {
  if (!floor) return null
  const segments = floor.wallSegs ?? (floor.walls ?? []).flatMap((w) => ringSegments(w.polygon))
  if (!segments.length) return null
  const index = floor.wallIndex ?? createSegmentIndex(segments)
  const doors = (floor.doors ?? []).filter((d) => d.a && d.b)
  const doorIndex = createSegmentIndex(doors.map((d) => ({a: d.a, b: d.b})))
  const atDoor = (p) => doorIndex.near(p, doorGapM).length > 0
  return {
    level: floor.level ?? null,
    doors,
    /** Every place a polyline goes through a wall, as {x, y} (MazeMap data with no door drawn there). */
    crossingsOf(line) {
      const out = []
      for (let i = 1; i < line.length; i++) for (const {hit} of index.crossing(line[i - 1], line[i])) out.push({x: hit.x, y: hit.y})
      return out
    },
    crosses(a, b) {
      if (dist(a, b) < 1e-6) return null
      // Standing on a wall's line is not going through it (an anchor can put the user on a door's
      // wall line): a hit at the very start of the step does not count.
      for (const {hit} of index.crossing(a, b)) if (!atDoor(hit) && dist(hit, a) > CORRIDOR.onLineM) return hit
      return null
    },
  }
}

/**
 * The nearest point on the route, within [fromS - backM, fromS + aheadM], that can be reached from
 * `from` without crossing a wall: {x, y, s, d (from p)}, or null. p: the point to snap.
 */
export function nearestCorridorPoint(route, rules, p, from, fromS, {backM = CORRIDOR.backM, aheadM = CORRIDOR.aheadM, maxM = CORRIDOR.maxSnapM, stepM = 0.5, onFloor = null} = {}) {
  const total = polylineLength(route)
  const s0 = Math.max(0, fromS - backM)
  const s1 = Math.min(total, fromS + aheadM)
  let best = null
  for (let s = s0; s <= s1 + 1e-9; s += stepM) {
    // Phase 4: only the route on the user's floor (it can pass right above or below itself).
    if (onFloor && !onFloor(Math.min(s, total))) continue
    const q = pointAt(route, Math.min(s, total))
    const d = dist(q, p)
    if (d > maxM || (best && d >= best.d)) continue
    if (rules?.crosses(from, q)) continue
    best = {x: q.x, y: q.y, s: Math.min(s, total), d}
  }
  return best
}

/** Where path matching must re-run: route turns of turnMinDeg+ and door crossings, by distance along. */
export function matchPoints(route, doors = [], {turnMinDeg = CORRIDOR.turnMinDeg, turnArmM = CORRIDOR.turnArmM, doorArmM = CORRIDOR.doorArmM} = {}) {
  const turns = findTurns(route, turnMinDeg).map((t) => ({kind: 'turn', s: t.s, at: t.s + turnArmM, angle: t.angle}))
  const crossings = doorCrossings(route, doors).map((d) => ({kind: 'door', s: d.s, at: d.s + doorArmM, x: d.x, y: d.y, a: d.a, b: d.b}))
  return [...turns, ...crossings].sort((x, y) => x.at - y.at)
}

/**
 * The guard for one trip. route: the route in route-frame metres.
 * It keeps the walk as SLAM measured it (camera world {x, z}) and reads it through the CURRENT
 * placement every frame, so a correction moving the placement is never mistaken for walking
 * through a wall, and the guard never has to pause while one eases in.
 * step({cam, toRoute, s, walkedM}) once a frame with tracking NORMAL; cam: the camera's world
 * position, toRoute: world -> route frame now, s: the trip's progress. Returns:
 *   snap        {to: {x, y}, s, by (m)}: the walk since the last good point went through a wall: put
 *               the user at `to`, the nearest corridor point reachable from that good point
 *   blocked     it went through a wall and no corridor point could be reached (confidence drops)
 *   progressS   the progress the tracked position supports, when it differs by more than progressGapM
 *   events      the match points passed this frame ([{kind: 'turn' | 'door', ...}]): re-run matching
 *   doorAnchor  {by: {dx, dy}, door}: the walk crossed a route door's line near the route's crossing
 * The caller applies a snap only if the correction budget allows (route-matcher.js), then calls
 * accept(cam) so the walk goes on from there.
 */
export function createCorridorGuard(route, {levelAtS = null} = {}) {
  let rules = null
  let points = matchPoints(route)
  let next = 0
  let goodCam = null // the last camera position (world) that was on the right side of every wall
  let recent = [] // the walk (world), for door crossings: [{x, z, walkedM}]
  let lastS = 0

  let openings = [] // where the route itself goes through a wall line: a doorway, drawn or not

  /** The floor's walls and doors; match points already passed are not run again. */
  function setFloor(floor) {
    rules = wallRules(floor)
    points = matchPoints(route, rules?.doors ?? [])
    // The route's way through: its door crossings, and any wall it crosses where MazeMap drew no
    // door (a data gap). A walk through a wall near one of these is going through that opening:
    // SLAM puts people half a metre to the side as a matter of course, not through the wall.
    openings = rules ? [...points.filter((m) => m.kind === 'door').map((m) => ({x: m.x, y: m.y})), ...rules.crossingsOf(route)] : []
    next = points.findIndex((m) => m.at > lastS)
    if (next < 0) next = points.length
  }

  /** Where the walk (through the placement now) crossed this door's line, or null. */
  function walkCrossing(door, toRoute) {
    for (let i = recent.length - 1; i > 0; i--) {
      const hit = segmentCross(toRoute(recent[i - 1]), toRoute(recent[i]), door.a, door.b)
      if (hit) return hit
    }
    return null
  }

  return {
    setFloor,
    get hasWalls() {
      return Boolean(rules)
    },
    get matchPoints() {
      return points
    },
    /** The user is where the camera is now (a snap, an anchor, "I'm here"): the walk goes on from here. */
    accept(cam) {
      goodCam = {x: cam.x, z: cam.z}
    },
    reset() {
      goodCam = null
      recent = []
    },
    step({cam, toRoute, s, walkedM = 0, level = null}) {
      const out = {snap: null, blocked: false, progressS: null, events: [], doorAnchor: null}
      const onFloor = levelAtS && Number.isFinite(level) ? (q) => levelAtS(q) === level : null
      lastS = s
      if (!goodCam) goodCam = {x: cam.x, z: cam.z}
      if (!recent.length || Math.hypot(recent.at(-1).x - cam.x, recent.at(-1).z - cam.z) >= 0.25) {
        recent.push({x: cam.x, z: cam.z, walkedM})
        while (recent.length > 2 && walkedM - recent[0].walkedM > CORRIDOR.recentM) recent.shift()
      }
      const p = toRoute(cam)
      let here = p
      if (rules) {
        const from = toRoute(goodCam)
        const hit = rules.crosses(from, p)
        const atOpening = hit && openings.some((o) => dist(o, hit) <= CORRIDOR.openingM)
        if (hit && !atOpening) {
          // Through a wall: the placement is wrong. Back to the nearest corridor point reachable
          // from the last good position.
          const to = nearestCorridorPoint(route, rules, p, from, s, {onFloor})
          if (to) {
            out.snap = {to: {x: to.x, y: to.y}, s: to.s, by: to.d, hit}
            here = to
          } else {
            out.blocked = true
            out.from = from
          }
        } else goodCam = {x: cam.x, z: cam.z}
        // The progress follows the tracked position's corridor point (no wall between them).
        if (!out.blocked) {
          const c = out.snap ? {s: out.snap.s} : nearestCorridorPoint(route, rules, here, here, s, {maxM: CORRIDOR.maxLateralM, onFloor})
          if (c && Math.abs(c.s - s) > CORRIDOR.progressGapM) out.progressS = c.s
        }
      } else if (Number.isFinite(level) && level === 0) {
        // Phase 5, outdoors (no walls): the progress follows the tracked position too, so the turn
        // from the path into a doorway cannot stall it. Wider: an outdoor start came from GPS.
        const c = nearestCorridorPoint(route, null, p, p, s, {maxM: CORRIDOR.outdoorLateralM, onFloor})
        if (c && Math.abs(c.s - s) > CORRIDOR.progressGapM) out.progressS = c.s
      }
      // The match points passed: re-run path matching there; a door may also be an anchor.
      const sNow = out.progressS ?? s
      while (next < points.length && sNow >= points[next].at) {
        const m = points[next++]
        out.events.push(m)
        if (m.kind === 'door' && !out.doorAnchor) {
          const crossed = walkCrossing(m, toRoute)
          if (crossed && dist(crossed, m) <= CORRIDOR.doorConfirmM) out.doorAnchor = {by: {dx: m.x - crossed.x, dy: m.y - crossed.y}, door: m}
        }
      }
      return out
    },
  }
}

/**
 * Confidence 0..1 that the arrows lie on the corridor, from what the trip can see (never the truth):
 *   - walking without an anchor or a confident match: SLAM drifts per metre, so it falls (decayM);
 *   - the corrections path matching keeps making (the innovation): each says how far off the arrows
 *     were just before it; the arrows' expected error, the shift plus the turn carried out to
 *     CORRIDOR.innovationAheadM, is held and fades as the user walks on (innovationHalfM);
 *   - the error ALONG the corridor: SLAM's scale is a few percent out, and only a matched corner
 *     (or a sign, later) fixes it; a door gap does not. It grows per metre since the last matched
 *     corner, and matters only where the arrows go round a turn: there it puts them to the side
 *     by about that error times the sine of the turn (turnSin, from the trip);
 *   - a wall crossing that could not be put right; a poor match; tracking not NORMAL.
 */
export function createAlignConfidence({decayM = CORRIDOR.decayM} = {}) {
  let goodAtM = 0
  let blockedUntil = -Infinity
  let innovationM = 0
  let innovationAtM = 0
  let alongAtM = 0
  let alongStartM = 0 // how far along the corridor it may already have been, when last fixed
  let value = 1
  let why = null
  return {
    confirm(walkedM) {
      goodAtM = walkedM
    },
    /** The walk was matched round a corner (or placed by an anchor that fixes it): the along error is reset. */
    alongFixed(walkedM, startM = 0) {
      alongAtM = walkedM
      alongStartM = startM
    },
    /** The arrows' expected error from the along-corridor error, at a turn of this |sin|, in metres. */
    alongErrorM(walkedM, turnSin) {
      return (alongStartM + CORRIDOR.alongDriftPerM * Math.max(0, walkedM - alongAtM)) * turnSin
    },
    blocked(time) {
      blockedUntil = time + CORRIDOR.violationHoldS
    },
    /** A correction was made: {dx, dy (m), yaw (rad)}. */
    corrected({dx = 0, dy = 0, yaw = 0}, walkedM) {
      const e = Math.hypot(dx, dy) + CORRIDOR.innovationAheadM * Math.abs(Math.sin(yaw))
      const held = innovationM * 0.5 ** ((walkedM - innovationAtM) / CORRIDOR.innovationHalfM)
      innovationM = Math.max(held, e)
      innovationAtM = walkedM
    },
    /** The arrows' expected error from the corrections so far, in metres, now. */
    expectedErrorM(walkedM) {
      return innovationM * 0.5 ** ((walkedM - innovationAtM) / CORRIDOR.innovationHalfM)
    },
    update({walkedM, time, residualM = null, tracking = 'NORMAL', turnSin = 0}) {
      let c = Math.max(0, 1 - (walkedM - goodAtM) / decayM)
      const e = Math.max(this.expectedErrorM(walkedM), this.alongErrorM(walkedM, turnSin))
      if (e > CORRIDOR.fadeErrorM) c = Math.min(c, CORRIDOR.fadeBelow - 0.01)
      else if (e > CORRIDOR.dimErrorM) c = Math.min(c, CORRIDOR.dimBelow - 0.01)
      if (Number.isFinite(residualM) && residualM > CORRIDOR.poorResidualM) c = Math.min(c, CORRIDOR.poorCap)
      if (time < blockedUntil) c = Math.min(c, 0.2)
      if (tracking !== 'NORMAL') c = Math.min(c, 0.3)
      value = c
      why = {decay: Math.round(Math.max(0, 1 - (walkedM - goodAtM) / decayM) * 100) / 100, expectedM: Math.round(this.expectedErrorM(walkedM) * 100) / 100, alongM: Math.round(this.alongErrorM(walkedM, turnSin) * 100) / 100, residualM, blocked: time < blockedUntil, tracking}
      return c
    },
    get value() {
      return value
    },
    /** What set the last value (for ?debug=1 and field logs). */
    get why() {
      return why
    },
  }
}

/** The arrows' opacity for a confidence, and whether "Keep walking" shows instead. */
export function arrowsForConfidence(c) {
  if (c < CORRIDOR.fadeBelow) return {opacity: CORRIDOR.fadedOpacity, keepWalking: true}
  if (c < CORRIDOR.dimBelow) return {opacity: CORRIDOR.dimOpacity, keepWalking: false}
  return {opacity: 1, keepWalking: false}
}

