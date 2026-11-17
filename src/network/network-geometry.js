// Small 2D helpers for the campus walking network (src/data/campus-network.json). Points are
// {x, y} metres east/north of the campus model's origin; polygons are arrays of rings.
import {insideRing, segmentCross} from '../ar/building-shell.js'

export {insideRing, segmentCross}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** [x, y] -> {x, y}. */
export const pt = (p) => ({x: p[0], y: p[1]})

/** Distance from p to segment a-b, and the closest point with its fraction t along a-b. */
export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return {x, y, t, d: Math.hypot(p.x - x, p.y - y)}
}

/** Shortest distance from p to a ring's edges. */
export function ringDistance(p, ring) {
  let best = Infinity
  for (let i = 1; i < ring.length; i++) best = Math.min(best, closestOnSegment(p, ring[i - 1], ring[i]).d)
  return best
}

/** Inside a polygon: inside its outer ring and not inside any hole. */
export function insidePolygon(p, polygon) {
  if (!polygon.length || !insideRing(p, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) if (insideRing(p, polygon[i])) return false
  return true
}

/** Distance from p to a polygon's boundary (any ring). */
export function polygonBoundaryDistance(p, polygon) {
  return Math.min(...polygon.map((ring) => ringDistance(p, ring)))
}

export function ringCentroid(ring) {
  const pts = ring.length > 1 && dist(ring[0], ring.at(-1)) < 1e-9 ? ring.slice(0, -1) : ring
  return {x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length}
}

export function polygonBox(polygon) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const ring of polygon) {
    for (const p of ring) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  }
  return {x0, y0, x1, y1}
}

/** A thin rectangle around a line segment: barriers (walls, fences, hedges) as blocked polygons. */
export function segmentQuad(a, b, halfWidthM) {
  const len = dist(a, b) || 1
  const nx = (-(b.y - a.y) / len) * halfWidthM
  const ny = ((b.x - a.x) / len) * halfWidthM
  const ring = [
    {x: a.x + nx, y: a.y + ny},
    {x: b.x + nx, y: b.y + ny},
    {x: b.x - nx, y: b.y - ny},
    {x: a.x - nx, y: a.y - ny},
  ]
  ring.push(ring[0])
  return [ring]
}

/**
 * A uniform grid of items by bounding box, for "what is near this segment" queries.
 * items: [{box: {x0, y0, x1, y1}, ...}].
 */
export function createBoxIndex(items, cellM = 10) {
  const cells = new Map()
  items.forEach((item, n) => {
    const {x0, y0, x1, y1} = item.box
    for (let i = Math.floor(x0 / cellM); i <= Math.floor(x1 / cellM); i++) {
      for (let j = Math.floor(y0 / cellM); j <= Math.floor(y1 / cellM); j++) {
        const k = `${i},${j}`
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(n)
      }
    }
  })
  return {
    /** Items whose box meets the box of a-b grown by pad. */
    near(a, b, pad = 0) {
      const x0 = Math.min(a.x, b.x) - pad
      const x1 = Math.max(a.x, b.x) + pad
      const y0 = Math.min(a.y, b.y) - pad
      const y1 = Math.max(a.y, b.y) + pad
      const seen = new Set()
      const out = []
      for (let i = Math.floor(x0 / cellM); i <= Math.floor(x1 / cellM); i++) {
        for (let j = Math.floor(y0 / cellM); j <= Math.floor(y1 / cellM); j++) {
          for (const n of cells.get(`${i},${j}`) ?? []) {
            if (seen.has(n)) continue
            seen.add(n)
            const bx = items[n].box
            if (bx.x1 < x0 || bx.x0 > x1 || bx.y1 < y0 || bx.y0 > y1) continue
            out.push(items[n])
          }
        }
      }
      return out
    },
  }
}

/** Where segment a-b crosses any ring of a polygon: [{x, y}]. */
export function polygonCrossings(a, b, polygon) {
  const out = []
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const hit = segmentCross(a, b, ring[i - 1], ring[i])
      if (hit) out.push({x: hit.x, y: hit.y})
    }
  }
  return out
}
