// The campus buildings in the AR world, from MazeMap's building outlines (premium/buildings.js):
//   - an invisible occluder (depth only) for each building, so the arrows, the beacon and the
//     labels hide behind real buildings (B1);
//   - where each building's name goes (B4).
// The outlines are pulled in by BUILDINGS.insetM, so a few metres of alignment error near a wall
// never hides the route in front of it. Heights are estimated from the floor count.
//
// Route frame: {x east, y north} metres. Geo-root: x = east, y = up, z = -north.
import {toLocal} from '../geo/geo.js'
import {BUILDINGS} from '../config.js'

/** Signed area of a ring (> 0 anticlockwise). */
function area(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Drop the closing point a GeoJSON ring repeats, and points closer than 0.1 m. */
function cleanRing(ring) {
  const out = []
  for (const p of ring) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.1) out.push(p)
  }
  if (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) <= 0.1) out.pop()
  return out
}

/**
 * The ring moved inwards by `insetM` (each edge parallel, corners mitred, the mitre capped at
 * 3 × insetM so a sharp corner cannot shoot across the building). Pure.
 */
export function insetRing(ring, insetM) {
  const pts = cleanRing(ring)
  if (pts.length < 3 || !(insetM > 0)) return pts
  const sign = area(pts) > 0 ? 1 : -1 // inwards is left of each edge for an anticlockwise ring
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n]
    const b = pts[(i + 1) % n]
    const e1 = {x: p.x - a.x, y: p.y - a.y}
    const e2 = {x: b.x - p.x, y: b.y - p.y}
    const l1 = Math.hypot(e1.x, e1.y) || 1
    const l2 = Math.hypot(e2.x, e2.y) || 1
    const n1 = {x: (-e1.y / l1) * sign, y: (e1.x / l1) * sign}
    const n2 = {x: (-e2.y / l2) * sign, y: (e2.x / l2) * sign}
    const m = {x: n1.x + n2.x, y: n1.y + n2.y}
    const ml = Math.hypot(m.x, m.y)
    if (ml < 1e-6) return {x: p.x + n1.x * insetM, y: p.y + n1.y * insetM}
    const cos = (m.x * n1.x + m.y * n1.y) / ml // cos of half the turn
    const k = Math.min(insetM / Math.max(cos, 1e-3), insetM * 3)
    return {x: p.x + (m.x / ml) * k, y: p.y + (m.y / ml) * k}
  })
}

/** Is point p inside the ring? Pure. */
export function insideRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * MazeMap buildings (a GeoJSON FeatureCollection from loadBuildings) -> the route frame:
 * [{id, name, heightM, ring (outer ring, as drawn), inner (inset ring), centre}]. Buildings
 * further than BUILDINGS.withinM from the origin are left out. Pure.
 */
export function buildingsToLocal(collection, origin, {insetM = BUILDINGS.insetM, withinM = BUILDINGS.withinM} = {}) {
  const out = []
  for (const f of collection?.features ?? []) {
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : []
    for (const poly of polys) {
      const ring = cleanRing((poly[0] ?? []).map(([lng, lat]) => toLocal(origin, {lat, lng})))
      if (ring.length < 3) continue
      const centre = {x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length}
      if (Math.hypot(centre.x, centre.y) > withinM) continue
      out.push({id: f.properties?.id, name: f.properties?.name ?? '', heightM: f.properties?.height ?? BUILDINGS.defaultHeightM, ring, inner: insetRing(ring, insetM), centre})
    }
  }
  return out
}

/**
 * One merged mesh of every building's inset outline, extruded from BUILDINGS.belowM under the
 * ground to its height: writes depth only, so the camera image shows through it and anything
 * behind it is hidden. Null if there is nothing to draw.
 */
export function buildOccluder(THREE, mergeGeometries, buildings) {
  const pieces = []
  for (const b of buildings) {
    if (b.inner.length < 3) continue
    const shape = new THREE.Shape(b.inner.map((p) => new THREE.Vector2(p.x, p.y)))
    const geo = new THREE.ExtrudeGeometry(shape, {depth: b.heightM + BUILDINGS.belowM, bevelEnabled: false})
    geo.rotateX(-Math.PI / 2) // shape (x east, y north), extruded along +z -> up; north -> -z
    geo.translate(0, -BUILDINGS.belowM, 0)
    pieces.push(geo.index ? geo.toNonIndexed() : geo)
  }
  if (!pieces.length) return null
  const merged = mergeGeometries(pieces)
  for (const g of pieces) g.dispose()
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: true}))
  mesh.name = 'campus-occluder'
  mesh.renderOrder = BUILDINGS.renderOrder // first, so its depth is there for everything after
  return mesh
}
