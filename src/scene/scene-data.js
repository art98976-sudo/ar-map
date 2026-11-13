// The 3D navigation scene (Step 1): one model of the building, built from MazeMap's own measured
// floors, that the route, the AR arrows, the pose and the maps all read. Route-local metres:
// {x east, y north}; heights in metres above the floor the route starts on.
//
// From MazeMap's floor tiles (mazemap-floor.js), per level the route uses:
//   - walls: polygons, already open at every door (checked on real tiles);
//   - doors: line segments across the gap: their length is the width, their middle the centre;
//   - stairs and lifts: polygons only. Which floors they join, and which way a stair climbs, is
//     not in the data: it comes from the MazeMap route itself, which changes level at them;
//   - floor outlines.
// Not in MazeMap's data at all: floor heights (its "moh" field is empty for this campus) and wall
// heights. Both come from config (INDOOR.floorHeightM, SHELL.wallHeightM).
import {INDOOR, SCENE, SHELL} from '../config.js'
import {toLocal} from '../geo/geo.js'
import {floorToLocal, insideRing, segmentCross} from '../ar/building-shell.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** MazeMap's level for points outdoors. */
export const OUTDOOR = 0

/** A floor's place in the building's order: MazeMap has no level 0 indoors, so -1 sits right under 1. */
export const floorIndex = (z) => (z > 0 ? z - 1 : z)

/** All edges of a polygon's rings as segments {a, b}. */
export function ringSegments(polygon) {
  const out = []
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      if (dist(ring[i - 1], ring[i]) > 1e-3) out.push({a: ring[i - 1], b: ring[i]})
    }
  }
  return out
}

function closestOn(seg, p) {
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy) / len2))
  return {x: seg.a.x + t * dx, y: seg.a.y + t * dy}
}

/**
 * A uniform grid over segments, for fast "what is near here" queries (Step 1: kept as 2D segments
 * with a spatial index). Each segment is listed in every cell its bounding box touches.
 */
export function createSegmentIndex(segments, cellM = SCENE.indexCellM) {
  const cells = new Map()
  const key = (i, j) => `${i},${j}`
  segments.forEach((seg, n) => {
    const i0 = Math.floor(Math.min(seg.a.x, seg.b.x) / cellM)
    const i1 = Math.floor(Math.max(seg.a.x, seg.b.x) / cellM)
    const j0 = Math.floor(Math.min(seg.a.y, seg.b.y) / cellM)
    const j1 = Math.floor(Math.max(seg.a.y, seg.b.y) / cellM)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j)
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(n)
      }
    }
  })
  return {
    size: segments.length,
    /** Segments with any part within r of p, nearest first: {...segment, d, at}. */
    near(p, r) {
      const seen = new Set()
      const out = []
      for (let i = Math.floor((p.x - r) / cellM); i <= Math.floor((p.x + r) / cellM); i++) {
        for (let j = Math.floor((p.y - r) / cellM); j <= Math.floor((p.y + r) / cellM); j++) {
          for (const n of cells.get(key(i, j)) ?? []) {
            if (seen.has(n)) continue
            seen.add(n)
            const seg = segments[n]
            const at = closestOn(seg, p)
            const d = dist(at, p)
            if (d <= r) out.push({...seg, d, at})
          }
        }
      }
      return out.sort((x, y) => x.d - y.d)
    },
    /** Segments that the segment a-b crosses, with where: [{seg, hit}]. */
    crossing(a, b) {
      const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}
      return this.near(mid, dist(a, b) / 2 + 0.01)
        .map((seg) => ({seg, hit: segmentCross(a, b, seg.a, seg.b)}))
        .filter((c) => c.hit)
    },
  }
}

/** A door from its line: centre, width (the gap) and the line's direction (degrees from north). */
export function doorFrom({id, a, b}) {
  const width = dist(a, b)
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI
  return {id, a, b, centre: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, width, lineDeg: ((deg % 360) + 360) % 360}
}

const centroid = (ring) => {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring
  return {x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length}
}

/** The stair or lift shape at p on a floor: one it is inside, else the nearest within maxM. */
function shaftAt(floor, p, maxM) {
  for (const kind of ['stairs', 'lifts']) {
    const hit = (floor?.[kind] ?? []).find((s) => insideRing(p, s.polygon[0]))
    if (hit) return {kind, shape: hit}
  }
  let best = null
  for (const kind of ['stairs', 'lifts']) {
    for (const s of floor?.[kind] ?? []) {
      const d = dist(centroid(s.polygon[0]), p)
      if (d <= maxM && (!best || d < best.d)) best = {kind, shape: s, d}
    }
  }
  return best
}

/**
 * Build the scene. route: MazeMap points [{lat, lng, z}] (z = floor level); origin: the route
 * frame's origin; floors: {level: floor from mazemap-floor.js fetchFloor}.
 */
export function buildScene({route, origin, floors, floorHeightM = INDOOR.floorHeightM, wallHeightM = SHELL.wallHeightM}) {
  const problems = []
  // MazeMap marks outdoor points as level 0: outdoors is not a floor. Heights count from the floor
  // the walk is on when it is first indoors (the entrance floor, ground level), or from its start.
  const indoorZ = (p) => Number.isFinite(p?.z) && p.z !== OUTDOOR
  const startLevel = indoorZ(route[0]) ? route[0].z : (route.find(indoorZ)?.z ?? null)
  const levels = [...new Set(route.filter(indoorZ).map((p) => p.z))].sort((a, b) => a - b)
  const local = route.map((p) => ({...toLocal(origin, p), z: p.z}))
  // Heights: floors are counted in order (MazeMap skips 0: -1 is directly below 1), from the floor
  // each building is entered on (ground level outdoors, height 0). A route that starts indoors
  // counts from its first floor.
  let ground = indoorZ(local[0]) ? local[0].z : null
  const heights = local.map((p) => {
    if (!indoorZ(p)) {
      ground = null
      return 0
    }
    if (ground == null) ground = p.z // just came in from outdoors: this is ground level here
    return (floorIndex(p.z) - floorIndex(ground)) * floorHeightM
  })
  const levelY = new Map()
  local.forEach((p, i) => indoorZ(p) && !levelY.has(p.z) && levelY.set(p.z, heights[i]))
  const floorY = (level) => levelY.get(level) ?? 0
  const out = {}
  for (const level of levels) {
    const raw = floors[level]
    if (!raw) {
      problems.push({kind: 'no-floor', level, text: `Level ${level}: MazeMap returned no floor tiles`})
      continue
    }
    const f = floorToLocal(raw, origin)
    const wallSegs = f.walls.flatMap((w) => ringSegments(w.polygon))
    const doors = f.doors.map(doorFrom)
    out[level] = {
      level,
      y: floorY(level),
      walls: f.walls,
      wallSegs,
      wallIndex: createSegmentIndex(wallSegs),
      doors,
      doorIndex: createSegmentIndex(doors.map((d) => ({a: d.a, b: d.b, door: d}))),
      outlines: f.outlines,
      stairs: f.stairs,
      lifts: f.lifts,
      rooms: f.rooms,
      labels: f.labels,
    }
    const indoors = local.some((p) => p.z === level && f.outlines.some((o) => insideRing(p, o.polygon[0])))
    if (indoors && !wallSegs.length) problems.push({kind: 'no-walls', level, text: `Level ${level}: the route is inside a building but MazeMap has no walls there`})
    if (indoors && !doors.length) problems.push({kind: 'no-doors', level, text: `Level ${level}: the route is inside a building but MazeMap has no doors there`})
  }

  // Stairs and lifts: where the route changes level. The data does not link floors, so the route
  // is the source: the shape it uses on the lower floor, and where it comes out above.
  const links = []
  let s = 0
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1]
    const b = local[i]
    s += dist(a, b)
    // Through a door between outdoors and a floor is not a level change.
    if (!indoorZ(a) || !indoorZ(b) || a.z === b.z) continue
    const up = floorIndex(b.z) > floorIndex(a.z)
    const low = up ? a : b
    const high = up ? b : a
    const lowH = heights[up ? i - 1 : i]
    const highH = heights[up ? i : i - 1]
    const below = shaftAt(out[low.z], low, SCENE.shaftSearchM)
    const above = shaftAt(out[high.z], high, SCENE.shaftSearchM)
    const kind = below?.kind ?? above?.kind ?? null
    if (!kind) problems.push({kind: 'no-shaft', level: low.z, s, text: `Level ${a.z} to ${b.z} at ${Math.round(s)} m: no stair or lift in MazeMap's floor data there`})
    links.push({
      kind: kind ?? 'unknown',
      s,
      fromLevel: a.z,
      toLevel: b.z,
      up,
      bottom: {x: low.x, y: low.y, level: low.z, h: lowH},
      top: {x: high.x, y: high.y, level: high.z, h: highH},
      shapeBelow: below?.shape ?? null,
      shapeAbove: above?.shape ?? null,
      // A stair is a slope from its bottom point to its top point; a lift is a vertical link.
      slope: kind === 'stairs' ? {run: dist(low, high), rise: highH - lowH} : null,
    })
  }

  return {
    origin,
    levels,
    startLevel,
    floorHeightM,
    wallHeightM,
    floorY,
    floors: out,
    links,
    route3d: local.map((p, i) => ({x: p.x, y: p.y, z: p.z, h: heights[i]})),
    problems,
    /** Walls within r of p on a level, nearest first. */
    wallsNear(level, p, r) {
      return out[level]?.wallIndex.near(p, r) ?? []
    },
    /** The nearest wall to p on a level within maxM, or null. */
    nearestWall(level, p, maxM = SCENE.nearWallM) {
      return this.wallsNear(level, p, maxM)[0] ?? null
    },
    /** Does walking from a to b on a level go through a wall? (The walls are open at doors.) */
    crossesWall(level, a, b) {
      return (out[level]?.wallIndex.crossing(a, b) ?? []).length > 0
    },
    /** Doors whose line passes within r of p, nearest first. */
    doorsNear(level, p, r) {
      return (out[level]?.doorIndex.near(p, r) ?? []).map((hit) => ({...hit.door, d: hit.d}))
    },
  }
}

/** One line per level and per link, for ?debug=scene: what the scene holds. */
export function sceneSummary(scene) {
  const rows = scene.levels.map((level) => {
    const f = scene.floors[level]
    if (!f) return `Level ${level}: no floor data`
    return `Level ${level} at ${f.y.toFixed(1)} m: ${f.wallSegs.length} wall edges, ${f.doors.length} doors, ${f.stairs.length} stairs, ${f.lifts.length} lifts`
  })
  for (const l of scene.links) rows.push(`${l.kind === 'lifts' ? 'Lift' : l.kind === 'stairs' ? 'Stairs' : 'Level change'} ${l.fromLevel} → ${l.toLevel} at ${Math.round(l.s)} m`)
  return rows
}
