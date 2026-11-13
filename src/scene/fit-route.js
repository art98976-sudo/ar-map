// Step 2: lay MazeMap's route on the 3D navigation scene so it is physically walkable. The fitted
// route is the only route: the 2D map line, the 3D map line, the card's distance and the AR arrows
// all come from it.
//
// On each floor, in order:
//   1. through every door the route uses: straight across the door's centre, square to it;
//   2. along corridors: on the centre line; elsewhere at least FIT.clearM from any wall;
//   3. corners at the real junction (where the two centred legs meet), rounded with FIT.cornerM;
//   4. never through a wall: a stretch that still crosses one is repaired through the nearest door
//      and listed (or listed as not repaired);
//   5. heights: on its floor's plane, and up or down the slope on a stair.
// Before all that, the start: the line begins at the nearest walkable point to the user, not at a
// network node behind them.
import {FIT} from '../config.js'
import {fromLocal} from '../geo/geo.js'
import {insideRing, segmentCross} from '../ar/building-shell.js'
import {OUTDOOR} from './scene-data.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y})
const add = (a, b) => ({x: a.x + b.x, y: a.y + b.y})
const mul = (a, k) => ({x: a.x * k, y: a.y * k})
const unit = (v) => {
  const n = Math.hypot(v.x, v.y) || 1
  return {x: v.x / n, y: v.y / n}
}
const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0)

/** Points every `step` metres along a same-floor stretch, ends included. */
export function resampleLeg(pts, step) {
  const out = [{...pts[0]}]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(1, Math.round(dist(a, b) / step))
    for (let k = 1; k <= n; k++) out.push({...b, x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n})
  }
  return out
}

function segDist(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1e-12
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** Douglas-Peucker that never drops a point marked `keep` (the door passes). */
export function simplifyKeep(pts, tol) {
  if (pts.length < 3) return pts.slice()
  const keep = pts.map((p) => Boolean(p.keep))
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()
    let maxD = 0
    let idx = -1
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(pts[i], pts[i0], pts[i1])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true
      stack.push([i0, idx], [idx, i1])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Distance from p along unit direction d to the nearest wall within maxM, or Infinity. */
function rayToWall(scene, level, p, d, maxM) {
  const end = add(p, mul(d, maxM))
  let best = Infinity
  for (const seg of scene.wallsNear(level, p, maxM)) {
    const hit = segmentCross(p, end, seg.a, seg.b)
    if (hit) best = Math.min(best, hit.t * maxM)
  }
  return best
}

const crosses = (scene, level, a, b) => scene.crossesWall(level, a, b)

/**
 * Start: the line begins at the nearest walkable point to the user, not at a network node behind
 * them. The user is points[0]; MazeMap's first leg runs from them to a node of its network, which
 * may be behind them. The nearest point on the rest of the route (in its first FIT.startLookM,
 * within FIT.startSnapM, reachable in a straight line without going through a wall indoors or a
 * building outdoors) becomes the start, if that saves walking.
 */
export function trimStartKink(points, scene, {lookM = FIT.startLookM, snapM = FIT.startSnapM, minSaveM = FIT.startMinSaveM} = {}) {
  if (points.length < 3) return {points, savedM: 0}
  const user = points[0]
  let s = dist(user, points[1])
  let best = null
  for (let i = 1; i < points.length - 1 && s <= lookM; i++) {
    const a = points[i]
    const b = points[i + 1]
    const len = dist(a, b)
    if (a.z !== user.z || b.z !== user.z) break
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = len > 0 ? Math.max(0, Math.min(1, ((user.x - a.x) * dx + (user.y - a.y) * dy) / (len * len))) : 0
    const q = {x: a.x + dx * t, y: a.y + dy * t, z: a.z}
    const d = dist(user, q)
    const along = s + t * len
    const blocked = user.z === OUTDOOR ? scene.crossesBuilding?.(user, q) : crosses(scene, user.z, user, q)
    if (!blocked && d <= snapM && along - d >= minSaveM && (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && along - d > best.save))) {
      best = {i, q, d, save: along - d}
    }
    s += len
  }
  if (!best) return {points, savedM: 0}
  return {points: [user, best.q, ...points.slice(best.i + 1)], savedM: best.save}
}

/** The way across a door, in the walking direction: in front, centre, behind (all kept). */
function throughDoor(door, travel, reachM) {
  const along = unit(sub(door.b, door.a))
  let n = {x: -along.y, y: along.x}
  if (n.x * travel.x + n.y * travel.y < 0) n = mul(n, -1)
  return [add(door.centre, mul(n, -reachM)), door.centre, add(door.centre, mul(n, reachM))].map((p) => ({...p, keep: true, door: door.id}))
}

/** Where line p1-p2 meets line q1-q2 (both taken as infinite), or null if parallel. */
function lineMeet(p1, p2, q1, q2) {
  const d1 = sub(p2, p1)
  const d2 = sub(q2, q1)
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((q1.x - p1.x) * d2.y - (q1.y - p1.y) * d2.x) / den
  return add(p1, mul(d1, t))
}

/**
 * Put each corner at the real junction: where the incoming and outgoing legs' lines meet. A leg
 * that is a door pass uses the door's axis, so a corridor turning into a door turns where the
 * corridor's centre line meets the line straight through the door.
 */
export function cornersAtJunctions(pts, maxMoveM = FIT.junctionMoveM) {
  const out = pts.map((p) => ({...p}))
  for (let i = 1; i < out.length - 1; i++) {
    const b = out[i]
    if (b.keep) continue
    const inLine = out[i - 1].keep && out[i - 2]?.keep ? [out[i - 2], out[i - 1]] : [out[i - 1], b]
    const outLine = out[i + 1].keep && out[i + 2]?.keep ? [out[i + 1], out[i + 2]] : [b, out[i + 1]]
    if (inLine[1] === b && outLine[0] === b) {
      // An ordinary bend: the legs a-b and b-c; extend the one before and the one after.
      const before = out[i - 2] && !out[i - 1].keep ? [out[i - 2], out[i - 1]] : null
      const after = out[i + 2] && !out[i + 1].keep ? [out[i + 1], out[i + 2]] : null
      if (!before || !after) continue
      const meet = lineMeet(before[0], before[1], after[0], after[1])
      if (meet && dist(meet, b) <= maxMoveM) Object.assign(b, meet)
      continue
    }
    const meet = lineMeet(inLine[0], inLine[1], outLine[0], outLine[1])
    if (meet && dist(meet, b) <= maxMoveM) Object.assign(b, meet)
  }
  return out
}

/** Round each corner with an arc of radius r (smaller where the legs are short). */
export function roundCorners(pts, r, {minTurnDeg = FIT.minTurnDeg, arcStepDeg = FIT.arcStepDeg} = {}) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const u = unit(sub(a, b))
    const v = unit(sub(c, b))
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) // between the legs
    const turn = Math.PI - theta
    if (b.keep || turn < (minTurnDeg * Math.PI) / 180) {
      out.push(b)
      continue
    }
    const tanFull = r / Math.tan(theta / 2) // from b to where the arc meets each leg
    const tan = Math.min(tanFull, dist(a, b) / 2, dist(b, c) / 2)
    const rr = tan * Math.tan(theta / 2)
    const p1 = add(b, mul(u, tan))
    const p2 = add(b, mul(v, tan))
    const centre = add(b, mul(unit(add(u, v)), Math.hypot(tan, rr)))
    const a1 = Math.atan2(p1.y - centre.y, p1.x - centre.x)
    let span = Math.atan2(p2.y - centre.y, p2.x - centre.x) - a1
    if (span > Math.PI) span -= 2 * Math.PI
    if (span < -Math.PI) span += 2 * Math.PI
    const n = Math.max(2, Math.ceil(Math.abs(span) / ((arcStepDeg * Math.PI) / 180)))
    for (let k = 0; k <= n; k++) {
      const ang = a1 + (span * k) / n
      out.push({...b, x: centre.x + rr * Math.cos(ang), y: centre.y + rr * Math.sin(ang), corner: true})
    }
  }
  out.push(pts.at(-1))
  return out
}

/** Fit one same-floor stretch inside a building. Returns {points, doors, repairs}. */
function fitLeg(scene, level, leg) {
  const z = level
  let pts = resampleLeg(leg, FIT.stepM).map((p) => ({x: p.x, y: p.y, z}))
  const used = []

  // 1. Doors: replace the points around each door crossing with a straight pass through its centre.
  const reachN = Math.round(FIT.doorReachM / FIT.stepM) + 1
  for (let j = 1; j < pts.length; j++) {
    if (pts[j].keep || pts[j - 1].keep) continue
    const hit = scene.floors[level].doorIndex.crossing(pts[j - 1], pts[j])[0]
    if (!hit) continue
    const door = hit.seg.door
    const travel = unit(sub(pts[j], pts[j - 1]))
    const s0 = Math.max(0, j - reachN)
    const s1 = Math.min(pts.length, j + reachN)
    const via = throughDoor(door, travel, FIT.doorReachM).map((p) => ({...p, z}))
    pts = [...pts.slice(0, s0), ...via, ...pts.slice(s1)]
    j = s0 + via.length
    used.push(door)
  }

  // 2. Corridors: onto the centre line; elsewhere clear of the walls. Sideways moves are smoothed,
  //    capped, and never move a point through a wall.
  const shifts = pts.map((p, i) => {
    if (p.keep || i === 0 || i === pts.length - 1) return null
    const t = unit(sub(pts[i + 1], pts[i - 1]))
    const n = {x: -t.y, y: t.x}
    const left = rayToWall(scene, level, p, n, FIT.lookM)
    const right = rayToWall(scene, level, p, mul(n, -1), FIT.lookM)
    let k = 0
    if (Number.isFinite(left) && Number.isFinite(right) && left + right <= FIT.corridorMaxM) k = (left - right) / 2
    else {
      if (left < FIT.clearM) k -= FIT.clearM - left
      if (right < FIT.clearM) k += FIT.clearM - right
    }
    return {n, k}
  })
  pts = pts.map((p, i) => {
    const sh = shifts[i]
    if (!sh) return p
    let sum = 0
    let count = 0
    for (let j = i - FIT.smoothN; j <= i + FIT.smoothN; j++) {
      if (shifts[j]) {
        sum += shifts[j].k
        count += 1
      }
    }
    const k = Math.max(-FIT.maxShiftM, Math.min(FIT.maxShiftM, sum / count))
    if (!k) return p
    const moved = {...p, ...add(p, mul(sh.n, k))}
    return crosses(scene, level, p, moved) ? p : moved
  })

  // 3. Corners: simplify, put each corner where the two legs' lines meet, round it.
  pts = roundCorners(cornersAtJunctions(simplifyKeep(pts, FIT.simplifyM)), FIT.cornerM)

  // 4. Never through a wall: repair a stretch that still crosses one through the nearest door.
  const repairs = []
  for (let i = 1; i < pts.length; i++) {
    if (!crosses(scene, level, pts[i - 1], pts[i])) continue
    const at = {x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2}
    const doors = scene.doorsNear(level, at, FIT.repairSearchM)
    const repair = {level, x: at.x, y: at.y, door: null, fixed: false}
    for (const door of doors) {
      const via = throughDoor(door, unit(sub(pts[i], pts[i - 1])), FIT.doorReachM).map((p) => ({...p, z}))
      if (crosses(scene, level, pts[i - 1], via[0]) || crosses(scene, level, via[2], pts[i])) continue
      pts.splice(i, 0, ...via)
      i += via.length
      repair.door = {x: door.centre.x, y: door.centre.y, width: door.width}
      repair.fixed = true
      used.push(door)
      break
    }
    if (!repair.fixed) {
      // No door to go through: MazeMap's line runs along or into a wall. Move this stretch
      // sideways, either way, by the smallest step that clears it.
      const n = (() => {
        const t = unit(sub(pts[i], pts[i - 1]))
        return {x: -t.y, y: t.x}
      })()
      for (const k of FIT.repairSideM.flatMap((m) => [m, -m])) {
        const a = {...pts[i - 1], ...add(pts[i - 1], mul(n, k))}
        const b = {...pts[i], ...add(pts[i], mul(n, k))}
        const prev = pts[i - 2] ?? pts[i - 1]
        const next = pts[i + 1] ?? pts[i]
        if (crosses(scene, level, a, b) || crosses(scene, level, prev, a) || crosses(scene, level, b, next)) continue
        if (pts[i - 1].keep || pts[i].keep) continue
        pts[i - 1] = a
        pts[i] = b
        repair.fixed = true
        repair.side = k
        break
      }
    }
    repairs.push(repair)
  }

  // 5. Clearance, last, along the whole line (a leg can run close to a wall between its ends): every
  //    half metre, a point still closer than FIT.clearM to a wall is pushed straight away from it,
  //    if nothing is in the way. Door passes stay as they are.
  pts = densify(pts, FIT.stepM)
  for (let pass = 0; pass < FIT.clearPasses; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      if (p.keep) continue
      // The target leaves room for the last simplification, which may pull a chord that much closer.
      const want = FIT.clearM + FIT.finalSimplifyM + 0.02
      const w = scene.nearestWall(level, p, want)
      if (!w || w.d >= want) continue
      const away = w.d > 1e-3 ? unit(sub(p, w.at)) : (() => {
        const t = unit(sub(pts[i + 1], pts[i - 1]))
        return {x: -t.y, y: t.x}
      })()
      // The full push first; if that is blocked (the next leg would clip something), a smaller one.
      for (const part of [1, 0.75, 0.5]) {
        const moved = {...p, ...add(p, mul(away, (want - w.d) * part))}
        if (crosses(scene, level, pts[i - 1], moved) || crosses(scene, level, moved, pts[i + 1])) continue
        if ((scene.nearestWall(level, moved, want)?.d ?? Infinity) < w.d) continue
        pts[i] = moved
        break
      }
    }
  }
  pts = simplifyKeep(pts, FIT.finalSimplifyM)

  // 6. Between the points too: a straight piece can still cut close to a wall's end (two points
  //    each clear of a corner, the line between them not). Add a pushed point where it does.
  for (let pass = 0; pass < FIT.clearPasses; pass++) {
    let added = false
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.keep && b.keep) continue
      const n = Math.ceil(dist(a, b) / 0.2)
      let worst = null
      for (let k = 1; k < n; k++) {
        const p = {x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n}
        const w = scene.nearestWall(level, p, FIT.clearM)
        if (w && (!worst || w.d < worst.w.d)) worst = {p, w}
      }
      if (!worst) continue
      const away = worst.w.d > 1e-3 ? unit(sub(worst.p, worst.w.at)) : null
      if (!away) continue
      const moved = {...b, keep: false, corner: false, door: undefined, ...add(worst.p, mul(away, FIT.clearM + 0.05 - worst.w.d))}
      if (crosses(scene, level, a, moved) || crosses(scene, level, moved, b)) continue
      pts.splice(i, 0, moved)
      i += 1
      added = true
    }
    if (!added) break
  }
  return {points: pts, doors: used, repairs}
}

/** Extra points every `step` metres on legs that are not door passes. */
function densify(pts, step) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = a.keep && b.keep ? 1 : Math.max(1, Math.round(dist(a, b) / step))
    for (let k = 1; k < n; k++) out.push({...b, keep: false, corner: false, door: undefined, x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n})
    out.push(b)
  }
  return out
}

/** Where segment p-q enters or leaves a polygon (its first boundary crossing), or null. */
function boundaryCross(p, q, polygon) {
  let best = null
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const hit = segmentCross(p, q, ring[i - 1], ring[i])
      if (hit && (!best || hit.t < best.t)) best = hit
    }
  }
  return best
}

/**
 * Heights: each point on its floor's plane; on a stair, up or down its slope. The slope runs from
 * where the line enters the stair's shape on the lower floor to where it leaves it on the upper
 * one; those two points are added so the climb starts and ends where the stair does.
 */
function addHeights(scene, pts) {
  const heightOf = new Map()
  for (const p of scene.route3d) if (!heightOf.has(p.z)) heightOf.set(p.z, p.h)
  let out = pts.map((p) => ({...p, h: p.z === OUTDOOR ? 0 : (heightOf.get(p.z) ?? 0)}))
  for (const link of scene.links.filter((l) => l.kind === 'stairs')) {
    const iChange = out.findIndex((p, i) => i > 0 && out[i - 1].z === link.fromLevel && p.z === link.toLevel && !p.stair)
    if (iChange < 0) continue
    const before = link.up ? link.shapeBelow : link.shapeAbove
    const after = link.up ? link.shapeAbove : link.shapeBelow
    const inside = (p, shape) => Boolean(shape) && insideRing(p, shape.polygon[0])
    // Back from the change, along the floor it leaves, to where the line went into the stair.
    let i0 = iChange - 1
    while (i0 > 0 && out[i0 - 1].z === link.fromLevel && inside(out[i0 - 1], before)) i0 -= 1
    if (i0 > 0 && before && out[i0 - 1].z === link.fromLevel) {
      const hit = boundaryCross(out[i0 - 1], out[i0], before.polygon)
      if (hit) {
        out.splice(i0, 0, {...out[i0], x: hit.x, y: hit.y, keep: false, corner: false})
      }
    }
    // On, along the floor it reaches, to where the line comes out of the stair.
    let i1 = out.findIndex((p, i) => i > i0 && p.z === link.toLevel && !p.stair)
    while (i1 < out.length - 1 && out[i1 + 1].z === link.toLevel && inside(out[i1 + 1], after)) i1 += 1
    if (i1 < out.length - 1 && after && out[i1 + 1].z === link.toLevel) {
      const hit = boundaryCross(out[i1], out[i1 + 1], after.polygon)
      if (hit) {
        out.splice(i1 + 1, 0, {...out[i1 + 1], x: hit.x, y: hit.y, keep: false, corner: false})
        i1 += 1
      }
    }
    const total = pathLength(out.slice(i0, i1 + 1))
    const h0 = heightOf.get(link.fromLevel) ?? out[i0].h
    const h1 = heightOf.get(link.toLevel) ?? out[i1].h
    let sAlong = 0
    for (let i = i0; i <= i1; i++) {
      if (i > i0) sAlong += dist(out[i - 1], out[i])
      out[i].h = total > 0 ? h0 + ((h1 - h0) * sAlong) / total : i === i0 ? h0 : h1
      out[i].stair = i > i0 && i < i1
    }
  }
  out = out.map((p) => ({...p, stair: Boolean(p.stair)}))
  return out
}

/**
 * Fit the scene's route. Returns {points (route frame, with z and h), latlng (for the maps),
 * lengthM, doors, repairs, startSavedM}.
 */
export function fitRoute(scene) {
  const start = trimStartKink(scene.route3d, scene)
  const legs = []
  for (const p of start.points) {
    const last = legs.at(-1)
    if (last && last.z === p.z) last.pts.push(p)
    else legs.push({z: p.z, pts: [p]})
  }
  const points = []
  const doors = []
  const repairs = []
  for (const leg of legs) {
    const indoors = leg.z !== OUTDOOR && scene.floors[leg.z] && leg.pts.length >= 2
    const fitted = indoors ? fitLeg(scene, leg.z, leg.pts) : {points: leg.pts.map((p) => ({x: p.x, y: p.y, z: p.z})), doors: [], repairs: []}
    points.push(...fitted.points)
    doors.push(...fitted.doors.map((d) => ({level: leg.z, ...d})))
    repairs.push(...fitted.repairs)
  }
  const withH = addHeights(scene, points)
  return {
    points: withH,
    latlng: withH.map((p) => ({...fromLocal(scene.origin, p), z: p.z, h: Number(p.h.toFixed(3))})),
    lengthM: pathLength(withH),
    doors,
    repairs,
    startSavedM: start.savedM,
  }
}

/**
 * The checks of Step 8, on any fitted route: wall crossings left, how far each door pass is from
 * the door's centre, and the closest the line comes to a wall away from doors.
 */
export function checkFitted(scene, fitted) {
  const pts = fitted.points
  const crossings = []
  const doorOffsets = []
  let minClear = Infinity
  let worst = null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (a.z !== b.z || a.z === OUTDOOR || !scene.floors[a.z]) continue
    if (scene.crossesWall(a.z, a, b)) crossings.push({level: a.z, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2})
    for (const hit of scene.floors[a.z].doorIndex.crossing(a, b)) doorOffsets.push(dist(hit.hit, hit.seg.door.centre))
  }
  const passed = fitted.points.filter((p) => p.keep && p.door != null)
  // Every 0.25 m along the line, not only at its corners.
  const samples = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (a.z !== b.z) continue
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.25))
    for (let k = 0; k < n; k++) samples.push({...a, keep: a.keep && b.keep, stair: a.stair || b.stair, end: i === 1 && k === 0, x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n})
  }
  const last = pts.at(-1)
  for (const p of samples) {
    // The two ends are where the user stands and the room itself, not part of the walk between.
    if (dist(p, pts[0]) < FIT.endExemptM || dist(p, last) < FIT.endExemptM) continue
    if (p.z === OUTDOOR || p.keep || p.stair || !scene.floors[p.z]) continue
    // At a door the frame is closer than 0.4 m by design: straight through its centre instead.
    if (passed.some((d) => d.z === p.z && dist(d, p) <= FIT.doorClearExemptM)) continue
    const w = scene.nearestWall(p.z, p, 3)
    if (w && w.d < minClear) {
      minClear = w.d
      worst = {x: p.x, y: p.y, z: p.z}
    }
  }
  return {crossings, doorOffsets, worstDoorOffsetM: doorOffsets.length ? Math.max(...doorOffsets) : 0, minClearM: minClear, worst}
}
