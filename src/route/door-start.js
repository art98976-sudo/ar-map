// Alignment Phase 1, steps 2-3: starting AR at a building door, with the heading from the map.
// A MazeMap door is a short line drawn across the gap in a wall, so the line runs along the wall and
// its perpendicular is the wall's normal. Which way is "inside" comes from the building outline.
// Standing in the doorway, facing in (or out), the user's heading is that normal: no compass needed.
// Pure geometry in route-frame metres {x east, y north}; no DOM, no network (door-data.js loads).
import {compassPoint, localBearing, pointAt, polylineLength, projectOntoPolyline, toRad, wrap360} from '../geo/geo.js'
import {AR_START} from '../config.js'

const dot = (a, b) => a.x * b.x + a.y * b.y
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y})
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1
  return {x: v.x / l, y: v.y / l}
}
const fromBearing = (deg) => ({x: Math.sin(toRad(deg)), y: Math.cos(toRad(deg))})
/** The acute angle between two lines (not directions), 0..90°. */
const lineAngle = (u, v) => (Math.acos(Math.min(1, Math.abs(dot(unit(u), unit(v))))) * 180) / Math.PI

/** Even-odd: inside the building's outer ring and not in one of its courtyards. rings: [[{x, y}]]. */
export function insideRings(p, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

/** The outline edge nearest to p: {d, at (nearest point), a, b (the edge)}. */
export function nearestEdge(p, rings) {
  let best = {d: Infinity, at: null, a: null, b: null}
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const hit = projectOntoPolyline([ring[i - 1], ring[i]], p)
      if (hit.offset < best.d) best = {d: hit.offset, at: {x: hit.x, y: hit.y}, a: ring[i - 1], b: ring[i]}
    }
  }
  return best
}

/**
 * One door line against the buildings: is it an exterior door, and which way is in?
 * door: {id, level, a, b}. buildings: [{id, name, rings}]. Returns null for an interior door, else
 * {id, level, x, y, widthM, inwardDeg, buildingId, buildingName, recessM}.
 * inwardDeg: the bearing (degrees from north) of someone in the doorway facing into the building.
 */
export function classifyDoor(door, buildings, cfg = AR_START, {allowRecessed = false} = {}) {
  const along = sub(door.b, door.a)
  const widthM = Math.hypot(along.x, along.y)
  if (widthM < 0.3 || widthM > 8) return null // a stray point or a whole facade, not a doorway
  const c = {x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2}
  const n = unit({x: along.y, y: -along.x}) // the wall's normal, one of its two senses
  let best = null
  for (const b of buildings) {
    const edge = nearestEdge(c, b.rings)
    if (!best || edge.d < best.edge.d) best = {building: b, edge}
  }
  if (!best || best.edge.d > (allowRecessed ? cfg.recessedDoorM : cfg.exteriorDoorM)) return null
  const {building, edge} = best
  const edgeDir = sub(edge.b, edge.a)
  const parallel = lineAngle(along, edgeDir) <= cfg.recessedAgreeDeg
  // Away from the outline line (allowed only at a known entrance: tested on Cottrell, anywhere else
  // the rule finds office doors along the facade), only a door parallel to the facade is the
  // entrance, set back under a canopy; one at right angles to it is a corridor door.
  if (edge.d > cfg.exteriorDoorM && !parallel) return null
  const probe = 0.6
  const inA = insideRings({x: c.x + n.x * probe, y: c.y + n.y * probe}, building.rings)
  const inB = insideRings({x: c.x - n.x * probe, y: c.y - n.y * probe}, building.rings)
  let inward
  if (inA !== inB) inward = inA ? n : {x: -n.x, y: -n.y}
  else {
    // Both probes on one side (a recessed door, or the outline drawn a little off the wall):
    // the outline is the outside, so inward points away from it if we are in, towards it if not.
    if (!parallel || edge.d < 0.05) return null
    const toEdge = unit(sub(edge.at, c))
    const s = dot(n, toEdge)
    if (Math.abs(s) < 0.3) return null
    const towardsOutline = s > 0 ? n : {x: -n.x, y: -n.y}
    inward = insideRings(c, building.rings) ? {x: -towardsOutline.x, y: -towardsOutline.y} : towardsOutline
  }
  // The outline edge, when it runs with the door, is a longer and so truer line for the wall.
  if (lineAngle(along, edgeDir) <= cfg.outlineSnapDeg) {
    const en = unit({x: edgeDir.y, y: -edgeDir.x})
    inward = dot(en, inward) >= 0 ? en : {x: -en.x, y: -en.y}
  }
  return {
    id: door.id ?? null,
    level: door.level ?? null,
    x: c.x,
    y: c.y,
    widthM,
    inwardDeg: localBearing({x: 0, y: 0}, inward),
    buildingId: building.id ?? null,
    buildingName: building.name ?? null,
    recessM: insideRings(c, building.rings) ? edge.d : 0,
  }
}

/**
 * The exterior doorways among MazeMap's door lines, one per doorway: double doors and a lobby's
 * inner and outer doors are merged (the outermost one stands for the doorway).
 * MazeMap's door lines on the building outline are exterior doors (the network generator's rule:
 * 44 of its 45 on Cottrell, none extra). `entrances` ({x, y}): known entrances; door lines near one
 * may sit back from the outline, under a canopy, and still count.
 */
export function exteriorDoors(doorLines, buildings, cfg = AR_START, {entrances = []} = {}) {
  const nearEntrance = (d) => {
    const c = {x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2}
    return entrances.some((e) => Math.hypot(e.x - c.x, e.y - c.y) <= cfg.namedDoorM)
  }
  const doors = doorLines
    .map((d) => classifyDoor(d, buildings, cfg, {allowRecessed: nearEntrance(d)}))
    .filter(Boolean)
    .sort((a, b) => a.recessM - b.recessM)
  const kept = []
  for (const d of doors) {
    const same = kept.find(
      (k) => k.level === d.level && k.buildingId === d.buildingId && Math.hypot(k.x - d.x, k.y - d.y) < cfg.doorMergeM && Math.abs(((k.inwardDeg - d.inwardDeg + 540) % 360) - 180) < 30,
    )
    if (same) same.widthM = Math.max(same.widthM, d.widthM)
    else kept.push({...d})
  }
  return kept
}

/** The `count` doors nearest to `here` ({x, y}), nearest first, each with its distance `d`. */
export function rankDoors(doors, here, count = AR_START.doorCount) {
  if (!here) return []
  return doors
    .map((door) => ({...door, d: Math.hypot(door.x - here.x, door.y - here.y)}))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
}

/**
 * Does the walk from this door go into the building or out of it? route: route-frame points from
 * the doorway. Returns {facing: 'inside' | 'outside', headingDeg}: where to face, standing in the
 * doorway, so the first step is the route's. A route along the wall counts by its slight lean.
 */
export function facingForRoute(inwardDeg, route, lookM = AR_START.facingLookM) {
  const length = route?.length >= 2 ? polylineLength(route) : 0
  if (!length) return {facing: 'inside', headingDeg: wrap360(inwardDeg)}
  const ahead = pointAt(route, Math.min(lookM, length))
  const goesIn = dot(sub(ahead, route[0]), fromBearing(inwardDeg)) >= 0
  return goesIn ? {facing: 'inside', headingDeg: wrap360(inwardDeg)} : {facing: 'outside', headingDeg: wrap360(inwardDeg + 180)}
}

/** The route's own direction over its first `lookM` metres (null for a route too short to say). */
export function routeLeadDeg(route, lookM = AR_START.facingLookM) {
  const length = route?.length >= 2 ? polylineLength(route) : 0
  if (length < 0.5) return null
  return localBearing(route[0], pointAt(route, Math.min(lookM, length)))
}

/**
 * The heading to start with, standing in this doorway, for this route: {facing, headingDeg, source}.
 * source 'wall': the wall's normal (the door line, on the building outline).
 * source 'route': the route's own first metres through the doorway, for a known entrance whose door
 * MazeMap's lines cannot pin down (a vestibule set back from the outline: Cottrell's car park side),
 * or a recessed door whose wall disagrees with the route by more than 60° (the wrong door line).
 * Never the compass. goesIn: does the route enter a floor (null: tell from the wall).
 */
export function resolveDoorHeading(door, route, {goesIn = null} = {}) {
  const lead = routeLeadDeg(route)
  if (Number.isFinite(door.inwardDeg)) {
    const wall = facingForRoute(door.inwardDeg, route)
    const off = lead == null ? 0 : Math.abs(((wall.headingDeg - lead + 540) % 360) - 180)
    if (!(door.recessM > AR_START.exteriorDoorM && off > 60)) return {...wall, source: 'wall'}
  }
  if (lead == null) return null
  return {facing: goesIn === false ? 'outside' : 'inside', headingDeg: wrap360(lead), source: 'route'}
}

/** Two points to plan from: just inside the doorway (on its floor) and just outside it. */
export function doorwaySides(door, stepM = AR_START.stepOffM) {
  const v = fromBearing(door.inwardDeg)
  return {
    inside: {x: door.x + v.x * stepM, y: door.y + v.y * stepM},
    outside: {x: door.x - v.x * stepM, y: door.y - v.y * stepM},
  }
}

/** "Cottrell", "Andrew Miller": the building, short. */
const shortBuilding = (name) => (name || 'Building').replace(/ Building$/, '')

/** The row in "Where are you?": {title, detail}. A side only when the wall says which it is. */
export function doorLabel(door, {approximate = true} = {}) {
  const wall = Number.isFinite(door.inwardDeg)
  const side = wall ? compassPoint(door.inwardDeg + 180) : null
  // A named entrance is named for the place it serves ("Scran main entrance"): two named doors on
  // one building must not read the same.
  const owner = shortBuilding(door.places?.[0] ?? door.buildingName)
  const title = door.name ? `${owner} ${door.name}` : side ? `${owner}, ${side} door` : `${owner} door`
  const parts = []
  if (door.name && side) parts.push(`${side[0].toUpperCase()}${side.slice(1)} side`)
  if (Number.isFinite(door.d)) parts.push(`${approximate ? 'about ' : ''}${Math.max(5, Math.round(door.d / 5) * 5)} m`)
  if (Number.isFinite(door.level)) parts.push(`Level ${door.level}`)
  return {title, detail: parts.join(' · ')}
}

/**
 * The start for a trip from a door. door: {lat, lng, level, inwardDeg, ...}; at: where the route was
 * planned from ({lat, lng}, inside or just outside the doorway); facing from facingForRoute.
 */
export function doorStartPoint(door, at, {facing, headingDeg}, {indoor = facing === 'inside'} = {}) {
  return {
    type: 'door',
    doorId: door.id ?? null,
    name: door.buildingName ?? 'Building',
    entranceName: door.name ?? (Number.isFinite(door.inwardDeg) ? `${compassPoint(door.inwardDeg + 180)} door` : 'door'),
    lat: at.lat,
    lng: at.lng,
    floor: indoor && Number.isFinite(door.level) ? door.level : null,
    headingDeg: Math.round(headingDeg * 10) / 10,
    facing: null,
    doorFacing: facing,
    inwardDeg: door.inwardDeg,
  }
}
