// The building's real walls and doors (from MazeMap, mazemap-floor.js) in the AR world:
//   - an invisible occluder (depth only) so the arrows hide behind walls and show through doors,
//   - a see-through wireframe for ?debug=1,
//   - faint wall base lines on the floor to help the line-up step,
//   - a soft green outline across each doorway the route goes through.
// Plus the pure geometry behind them and behind ?debug=walls. Route frame {x east, y north};
// geo-root: x, y up, z = -north. One lat/lng <-> metres conversion: geo.js toLocal.
import {projectOntoPolyline, toLocal} from '../geo/geo.js'
import {SHELL} from '../config.js'

const toXY = (origin, [lng, lat]) => toLocal(origin, {lat, lng})

/** Is point p inside a ring of {x, y} points? (Even-odd rule.) */
export function insideRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A floor from mazemap-floor.js, in route-frame metres. */
export function floorToLocal(floor, origin) {
  const poly = (polygon) => polygon.map((ring) => ring.map((p) => toXY(origin, p)))
  return {
    level: floor.level,
    walls: floor.walls.map((w) => ({id: w.id, polygon: poly(w.polygon)})),
    doors: floor.doors.map((d) => ({id: d.id, a: toXY(origin, d.line[0]), b: toXY(origin, d.line.at(-1))})),
    rooms: floor.rooms.map((r) => ({id: r.id, polygon: poly(r.polygon)})),
    outlines: floor.outlines.map((o) => ({id: o.id, polygon: poly(o.polygon)})),
    labels: floor.labels.map((l) => ({text: l.text, ...toLocal(origin, l)})),
  }
}

/** Where segment p1-p2 crosses q1-q2, as {x, y, t (along p), u (along q)}, or null. */
export function segmentCross(p1, p2, q1, q2) {
  const rx = p2.x - p1.x
  const ry = p2.y - p1.y
  const sx = q2.x - q1.x
  const sy = q2.y - q1.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / den
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return {x: p1.x + rx * t, y: p1.y + ry * t, t, u}
}

const distToSegment = (p, a, b) => projectOntoPolyline([a, b], p).offset

/**
 * The doors the route walks through: [{s, x, y, widthM, angleDeg, a, b}] in order along the route.
 * angleDeg: the door line's direction (degrees from north), for the outline across the doorway.
 */
export function doorCrossings(route, doors) {
  const out = []
  let s0 = 0
  for (let i = 1; i < route.length; i++) {
    const p1 = route[i - 1]
    const p2 = route[i]
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    for (const d of doors) {
      // A route through a doorway crosses its line, or passes within a few cm of its middle.
      const hit = segmentCross(p1, p2, d.a, d.b)
      if (!hit) continue
      out.push({
        s: s0 + hit.t * len,
        x: hit.x,
        y: hit.y,
        widthM: Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y),
        angleDeg: (Math.atan2(d.b.x - d.a.x, d.b.y - d.a.y) * 180) / Math.PI,
        a: d.a,
        b: d.b,
      })
    }
    s0 += len
  }
  return out.sort((a, b) => a.s - b.s)
}

/** The room (by its MazeMap label) a point is in, or null. */
export function roomAt(floor, p) {
  for (const room of floor.rooms) {
    const ring = room.polygon[0]
    if (!ring || !insideRing(p, ring)) continue
    const label = floor.labels.find((l) => insideRing(l, ring))
    if (label) return label.text
  }
  return null
}

/**
 * ?debug=walls: every place the route crosses a wall away from a door (more than doorClearM from
 * any door), with the rooms either side. [{s, x, y, rooms: [..]}]. Report only.
 */
export function wallCrossings(route, floor, {doorClearM = SHELL.doorClearM} = {}) {
  const found = []
  let s0 = 0
  for (let i = 1; i < route.length; i++) {
    const p1 = route[i - 1]
    const p2 = route[i]
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    for (const wall of floor.walls) {
      for (const ring of wall.polygon) {
        for (let k = 1; k < ring.length; k++) {
          const hit = segmentCross(p1, p2, ring[k - 1], ring[k])
          if (!hit) continue
          if (floor.doors.some((d) => distToSegment(hit, d.a, d.b) <= doorClearM)) continue
          const s = s0 + hit.t * len
          // A wall polygon has two faces: one crossing per wall is enough.
          if (found.some((f) => Math.abs(f.s - s) < SHELL.sameCrossingM)) continue
          const dx = (p2.x - p1.x) / (len || 1)
          const dy = (p2.y - p1.y) / (len || 1)
          const before = roomAt(floor, {x: hit.x - dx * 0.6, y: hit.y - dy * 0.6})
          const after = roomAt(floor, {x: hit.x + dx * 0.6, y: hit.y + dy * 0.6})
          found.push({s, x: hit.x, y: hit.y, rooms: [before, after].filter(Boolean)})
        }
      }
    }
    s0 += len
  }
  return found.sort((a, b) => a.s - b.s)
}

/** Walls with any corner within `metres` of point p (for the near-only modes). */
export function wallsNear(floor, p, metres) {
  return floor.walls.filter((w) => w.polygon.some((ring) => ring.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= metres)))
}

/**
 * The shell's meshes for one floor (route frame): occluder, wireframe and wall base lines, in
 * one group per kind so each can be switched on its own. mergeGeometries joins the walls into
 * one mesh per floor (few draw calls).
 */
export function buildShellMeshes(THREE, mergeGeometries, floor, {walls = floor.walls} = {}) {
  const shapes = []
  for (const wall of walls) {
    const [outer, ...holes] = wall.polygon
    if (!outer || outer.length < 3) continue
    const shape = new THREE.Shape(outer.map((q) => new THREE.Vector2(q.x, q.y)))
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map((q) => new THREE.Vector2(q.x, q.y))))
    shapes.push(shape)
  }
  const pieces = shapes.map((shape) => {
    const g = new THREE.ExtrudeGeometry(shape, {depth: SHELL.wallHeightM, bevelEnabled: false})
    g.rotateX(-Math.PI / 2) // the plan's y (north) becomes -z, the extrusion goes up
    return g
  })
  const geometry = pieces.length ? mergeGeometries(pieces, false) : new THREE.BufferGeometry()
  for (const g of pieces) g.dispose()

  // Depth only: the camera picture shows through, but arrows behind it are hidden.
  const occluder = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: true}))
  occluder.name = 'shell-occluder'
  occluder.renderOrder = SHELL.renderOrder

  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), new THREE.LineBasicMaterial({color: 0x38bdf8, transparent: true, opacity: 0.8, depthTest: false}))
  wire.name = 'shell-wireframe'

  // Base lines: each wall's outline, flat on the floor.
  const base = []
  for (const wall of walls) {
    for (const ring of wall.polygon) {
      for (let k = 1; k < ring.length; k++) base.push(ring[k - 1].x, 0.01, -ring[k - 1].y, ring[k].x, 0.01, -ring[k].y)
    }
  }
  const baseGeo = new THREE.BufferGeometry()
  baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(base, 3))
  const baseLines = new THREE.LineSegments(baseGeo, new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: SHELL.baseLineOpacity, depthTest: false}))
  baseLines.name = 'shell-base-lines'
  baseLines.renderOrder = SHELL.renderOrder + 1

  return {
    occluder,
    wire,
    baseLines,
    dispose() {
      geometry.dispose()
      occluder.material.dispose()
      wire.geometry.dispose()
      wire.material.dispose()
      baseGeo.dispose()
      baseLines.material.dispose()
    },
  }
}
