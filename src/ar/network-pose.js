// The map-constrained pose for ?network=1 (Part C): where the user is on the planned network route,
// kept on the route's edges and inside its walls, with a confidence score.
//
// Frame: campus metres (x east, y north of CAMPUS_ORIGIN), z = MazeMap floor (0 outdoors), the
// frame of campus-network.json and of a network route's points.
//
// - start: outdoors from GPS (accuracy <= 15 m, outside any building outline); indoors from the
//   picked start (a room or entrance).
// - move: camera tracking displacements. GPS is ignored inside a building outline.
// - heading: the compass gives the first estimate; after ~4.5 m of straight walking on a straight
//   stretch of route, the difference between the walked and the edge direction is removed (locked).
// - snap: the pose is matched on to the route's edges on its floor, at most a corridor's half
//   width to the side, and never moved through a wall.
// - anchors: at doors (a door gap is where you must be), at turns that match the route's turns,
//   and at stairs / lifts once the height change confirms the floor.
// - floor: the pose cannot pass a floor change until tracking's height change is within 30% of the
//   expected height difference (src/data/floor-heights.json).
// - confidence 0..1: tracking state, metres walked since the last anchor, distance off the route.
import {POSE} from '../config.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180
const bearing = (dx, dy) => (toDeg(Math.atan2(dx, dy)) + 360) % 360
/** Turn a displacement clockwise by deg (compass sense): bearing b becomes b + deg. */
const rotate = ({x, y}, deg) => {
  const r = toRad(deg)
  return {x: x * Math.cos(r) + y * Math.sin(r), y: -x * Math.sin(r) + y * Math.cos(r)}
}

function segCross(p1, p2, q1, q2) {
  const rx = p2.x - p1.x
  const ry = p2.y - p1.y
  const sx = q2.x - q1.x
  const sy = q2.y - q1.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / den
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return {x: p1.x + rx * t, y: p1.y + ry * t}
}

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return {x: a.x + dx * t, y: a.y + dy * t, t, d: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)}
}

/**
 * Wall test from a network: crossesWall(z, a, b) is true when walking a -> b on floor z goes
 * through a MazeMap wall, except within POSE.doorGapM of a door line (walls are open at doors).
 */
export function wallTesterFrom(net) {
  const byZ = new Map()
  for (const w of net?.areas?.blocked ?? []) {
    if (w.kind !== 'wall') continue
    if (!byZ.has(w.z)) byZ.set(w.z, [])
    for (const ring of w.polygon) for (let i = 1; i < ring.length; i++) byZ.get(w.z).push([{x: ring[i - 1][0], y: ring[i - 1][1]}, {x: ring[i][0], y: ring[i][1]}])
  }
  const doors = new Map()
  for (const d of net?.doorLines ?? []) {
    if (!doors.has(d.z)) doors.set(d.z, [])
    doors.get(d.z).push([{x: d.a[0], y: d.a[1]}, {x: d.b[0], y: d.b[1]}])
  }
  return function crossesWall(z, a, b) {
    const segs = byZ.get(z)
    if (!segs) return false
    const x0 = Math.min(a.x, b.x) - 0.01
    const x1 = Math.max(a.x, b.x) + 0.01
    const y0 = Math.min(a.y, b.y) - 0.01
    const y1 = Math.max(a.y, b.y) + 0.01
    for (const [p, q] of segs) {
      if (Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1 || Math.max(p.y, q.y) < y0 || Math.min(p.y, q.y) > y1) continue
      const hit = segCross(a, b, p, q)
      if (!hit) continue
      if ((doors.get(z) ?? []).some(([da, db]) => closestOnSegment(hit, da, db).d <= POSE.doorGapM)) continue
      return true
    }
    return false
  }
}

/** The route as segments with distance along it, the floors each can be walked on, and anchors. */
export function routeModel(points) {
  const segs = []
  let s = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = dist(a, b)
    const type = b.edgeType
    const vertical = a.z !== b.z && type !== 'door' && type !== 'access'
    const floors = a.z === b.z ? [a.z] : vertical ? [] : [a.z, b.z]
    segs.push({i, a, b, s0: s, s1: s + len, len, type, floors, vertical})
    s += len
  }
  const total = s
  const turns = []
  for (let k = 1; k < segs.length; k++) {
    const p = segs[k - 1]
    const q = segs[k]
    if (p.vertical || q.vertical || p.len < 1 || q.len < 1) continue
    const angle = wrap180(bearing(q.b.x - q.a.x, q.b.y - q.a.y) - bearing(p.b.x - p.a.x, p.b.y - p.a.y))
    if (Math.abs(angle) >= POSE.turnMinDeg) turns.push({s: q.s0, angle, z: q.a.z, at: q.a})
  }
  const doors = segs.filter((g) => g.type === 'door').map((g) => ({s: g.a.z !== 0 ? g.s0 : g.s1, z: g.a.z !== 0 ? g.a.z : g.b.z, at: g.a.z !== 0 ? g.a : g.b}))
  const floorChanges = segs.filter((g) => g.vertical).map((g) => ({sBottom: g.s0, sTop: g.s1, fromZ: g.a.z, toZ: g.b.z, type: g.type, at: g.a}))
  return {segs, total, turns, doors, floorChanges}
}

/** Point, floor and edge direction at distance s along the route model. */
export function along(model, s) {
  const c = Math.max(0, Math.min(model.total, s))
  const g = model.segs.find((x) => c <= x.s1) ?? model.segs.at(-1)
  const t = g.len ? (c - g.s0) / g.len : 0
  const z = g.vertical ? (t < 0.5 ? g.a.z : g.b.z) : t < 1 ? (g.floors.length === 1 ? g.floors[0] : g.a.z) : g.b.z
  return {x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t, z, seg: g, dirDeg: bearing(g.b.x - g.a.x, g.b.y - g.a.y)}
}

/**
 * The pose engine. points: a network route's points ({x, y, z, edgeType} in campus metres).
 * crossesWall(z, a, b), insideBuilding(p): from the network (wallTesterFrom, buildingAt).
 * floorHeights: {z: metres}.
 */
export function createNetworkPose({points, crossesWall = () => false, insideBuilding = () => false, floorHeights = {}}) {
  const model = routeModel(points)
  const heightOf = (z) => (z === 0 ? 0 : (floorHeights[z] ?? null))
  let s = 0
  let z = points[0]?.z ?? 0
  let lateral = 0
  let rawOffM = 0
  let pos = {x: points[0]?.x ?? 0, y: points[0]?.y ?? 0}
  let started = false
  let yawFixDeg = 0 // added to tracking displacements: removes the compass's error once locked
  let headingLocked = false
  let headingDeg = null
  let tracking = 'NORMAL'
  let sinceAnchorM = 0
  let lastAnchor = null
  let straight = [] // recent corrected displacements, for the heading lock and turn detection
  let piece = {x: 0, y: 0}
  let climbM = 0 // tracking height change near the next floor change
  const passedDoors = new Set()
  let anchorsHit = 0
  let gpsUsed = 0
  let gpsRejected = 0

  const nextFloorChange = () => model.floorChanges.find((f) => f.sTop > s + 0.01)

  function anchor(kind, atS, extra = {}) {
    s = atS
    const p = along(model, s)
    pos = {x: p.x, y: p.y}
    z = extra.z ?? p.z
    lateral = 0
    sinceAnchorM = 0
    lastAnchor = {kind, s: atS, ...extra}
    anchorsHit += 1
  }

  /** Match a proposed position on to the route near s, on the current floor. */
  function match(q) {
    const lo = s - POSE.backWindowM
    const hi = s + POSE.aheadWindowM
    const fc = nextFloorChange()
    const limit = fc ? fc.sBottom : model.total // no passing a floor change before the height confirms it
    let best = null
    for (const g of model.segs) {
      if (g.s1 < lo || g.s0 > hi || !g.floors.includes(z)) continue
      const c = closestOnSegment(q, g.a, g.b)
      const cs = Math.min(g.s0 + c.t * g.len, limit)
      if (!best || c.d < best.d) best = {s: cs, d: c.d, g, c}
    }
    return best
  }

  function confidence() {
    const track = tracking === 'NORMAL' ? 1 : tracking === 'LIMITED' ? 0.4 : 0
    const anchorF = Math.max(POSE.minAnchorFactor, 1 - sinceAnchorM / POSE.anchorDecayM)
    const offF = Math.max(0, 1 - rawOffM / POSE.offRouteZeroM)
    const headF = headingLocked ? 1 : POSE.unlockedFactor
    return Math.max(0, Math.min(1, track * anchorF * offF * headF))
  }

  function tryHeadingLock() {
    let walked = 0
    let sx = 0
    let sy = 0
    for (const d of straight) {
      walked += Math.hypot(d.x, d.y)
      sx += d.x
      sy += d.y
    }
    if (walked < POSE.lockAfterM) return
    const dirWalked = bearing(sx, sy)
    if (straight.some((d) => Math.hypot(d.x, d.y) > 0.05 && Math.abs(wrap180(bearing(d.x, d.y) - dirWalked)) > POSE.straightToleranceDeg)) return
    // The route must be straight over the stretch walked too.
    const here = along(model, s)
    if (here.seg.vertical) return
    for (let back = 0.5; back <= walked; back += 0.5) {
      const p = along(model, Math.max(0, s - back))
      if (p.seg.vertical || (p.seg.len > 0.3 && Math.abs(wrap180(p.dirDeg - here.dirDeg)) > POSE.straightToleranceDeg)) return
    }
    const diff = wrap180(here.dirDeg - dirWalked)
    if (!headingLocked) {
      if (Math.abs(diff) > POSE.maxLockErrorDeg) return
      yawFixDeg += diff
      headingLocked = true
    } else {
      yawFixDeg += diff * POSE.refineGain
    }
    straight = []
  }

  /** A turn in the walk that matches a route turn near s: anchor there. */
  function tryTurnAnchor() {
    if (straight.length < 4) return
    const half = Math.floor(straight.length / 2)
    const sum = (list) => list.reduce((acc, d) => ({x: acc.x + d.x, y: acc.y + d.y}), {x: 0, y: 0})
    const before = sum(straight.slice(0, half))
    const after = sum(straight.slice(half))
    if (Math.hypot(before.x, before.y) < 1.5 || Math.hypot(after.x, after.y) < 1.5) return
    const walkedTurn = wrap180(bearing(after.x, after.y) - bearing(before.x, before.y))
    if (Math.abs(walkedTurn) < POSE.turnMinDeg) return
    const turn = model.turns.find((t) => t.z === z && Math.abs(t.s - s) <= POSE.turnMatchM && Math.abs(wrap180(t.angle - walkedTurn)) <= POSE.turnAngleToleranceDeg && t.s !== lastAnchor?.turnS)
    if (!turn) return
    const afterM = Math.hypot(after.x, after.y)
    anchor('turn', Math.min(model.total, turn.s + afterM), {angle: turn.angle, turnS: turn.s})
    straight = straight.slice(half)
  }

  return {
    model,
    /** Start at {x, y, z?}: from GPS outdoors (accuracy <= POSE.startGpsM), or a picked start. */
    start({x, y, z: startZ = null, accuracyM = 0, manual = false}) {
      if (!manual && (accuracyM > POSE.startGpsM || insideBuilding({x, y}))) return false
      z = Number.isFinite(startZ) ? startZ : 0
      s = 0
      const m = match({x, y})
      s = m ? m.s : 0
      const p = along(model, s)
      pos = {x: p.x, y: p.y}
      started = true
      sinceAnchorM = 0
      lastAnchor = {kind: manual ? 'picked-start' : 'gps-start', s}
      return true
    },
    /** First heading estimate from the compass (used only until the heading locks). */
    compass(deg) {
      if (!headingLocked && Number.isFinite(deg)) headingDeg = deg
    },
    setTracking(state) {
      tracking = state
    },
    /** Camera tracking moved by (dx, dy) metres east/north (the compass-set frame) and dh up. */
    move({dx = 0, dy = 0, dh = 0}) {
      if (!started) return this.current
      const d = rotate({x: dx, y: dy}, yawFixDeg)
      const stepM = Math.hypot(d.x, d.y)
      // Frames move a few centimetres: gather them into pieces for the heading lock and turns.
      piece = {x: piece.x + d.x, y: piece.y + d.y}
      if (Math.hypot(piece.x, piece.y) >= POSE.pieceM) {
        straight.push(piece)
        if (straight.length > POSE.straightSamples) straight.shift()
        headingDeg = bearing(piece.x, piece.y)
        piece = {x: 0, y: 0}
      }
      // Height, near the next floor change: confirms the floor when it matches the expected rise.
      const fc = nextFloorChange()
      if (fc && Math.abs(s - fc.sBottom) <= POSE.climbWindowM) {
        climbM += dh
        const expected = (heightOf(fc.toZ) ?? 0) - (heightOf(fc.fromZ) ?? 0)
        if (expected !== 0 && Math.sign(climbM) === Math.sign(expected) && Math.abs(climbM - expected) <= Math.abs(expected) * POSE.floorTolerance) {
          anchor(fc.type === 'lift' ? 'lift' : 'stairs', fc.sTop, {z: fc.toZ, fromZ: fc.fromZ})
          climbM = 0
          straight = []
          return this.current
        }
      } else climbM = 0
      const proposed = {x: pos.x + d.x, y: pos.y + d.y}
      const m = match(proposed)
      if (!m) return this.current
      rawOffM = m.d
      const onRoute = along(model, m.s)
      const maxSide = z === 0 ? POSE.maxLateralOutdoorM : POSE.maxLateralIndoorM
      // Signed offset to the right of the route's direction, clamped to the corridor.
      const dir = {x: Math.sin(toRad(onRoute.dirDeg)), y: Math.cos(toRad(onRoute.dirDeg))}
      const side = (proposed.x - onRoute.x) * dir.y - (proposed.y - onRoute.y) * dir.x
      lateral = Math.max(-maxSide, Math.min(maxSide, side))
      // Never behind a wall: the step sideways from the route (which crosses no wall) to the pose
      // may not cross one either. Halve it, then drop it, until it does not.
      const sideways = (l) => ({x: onRoute.x + dir.y * l, y: onRoute.y - dir.x * l})
      let next = sideways(lateral)
      if (crossesWall(z, onRoute, next)) {
        lateral /= 2
        next = sideways(lateral)
        if (crossesWall(z, onRoute, next)) {
          lateral = 0
          next = {x: onRoute.x, y: onRoute.y}
        }
      }
      sinceAnchorM += stepM
      s = m.s
      pos = next
      if (onRoute.seg.floors.length === 1) z = onRoute.seg.floors[0]
      // Doors: the gap is where you must be.
      for (const door of model.doors) {
        if (!passedDoors.has(door.s) && s >= door.s - 0.3 && s - door.s <= POSE.doorSnapM) {
          passedDoors.add(door.s)
          anchor('door', door.s, {z: door.z})
        }
      }
      tryHeadingLock()
      tryTurnAnchor()
      return this.current
    },
    /** A GPS fix {x, y, accuracyM}: outdoors only, never inside a building outline. */
    gps({x, y, accuracyM}) {
      if (!started || z !== 0 || insideBuilding({x, y}) || !(accuracyM <= POSE.gpsMaxAccuracyM)) {
        gpsRejected += 1
        return false
      }
      const m = match({x, y})
      if (!m || m.d > POSE.gpsMaxOffRouteM || Math.abs(m.s - s) > POSE.gpsMaxJumpM + accuracyM) {
        gpsRejected += 1
        return false
      }
      s += (m.s - s) * POSE.gpsGain
      const p = along(model, s)
      pos = {x: p.x, y: p.y}
      lateral = 0
      // A good fix bounds the drift: the walk since the last anchor counts at most twice its accuracy.
      sinceAnchorM = Math.min(sinceAnchorM, accuracyM * POSE.gpsAnchorFactor)
      gpsUsed += 1
      return true
    },
    get current() {
      return {
        x: pos.x,
        y: pos.y,
        z,
        s,
        lateralM: lateral,
        offRouteM: rawOffM,
        headingDeg,
        headingLocked,
        yawFixDeg,
        confidence: confidence(),
        sinceAnchorM,
        lastAnchor,
        anchors: anchorsHit,
        gpsUsed,
        gpsRejected,
        heightM: heightOf(z),
        started,
      }
    },
  }
}
