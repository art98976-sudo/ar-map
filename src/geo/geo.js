// Geometry helpers: GPS <-> local metres, distances, and walking along a polyline.
//
// Local frame ("ENU"): metres from an origin point, x = east, y = north.
// For a walk of a few hundred metres an equirectangular projection is accurate to
// millimetres, which is far below GPS error, so we keep the maths simple.

const R = 6371008.8 // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

/** Great-circle distance in metres between {lat, lng} points. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** GPS point -> metres east/north of `origin`. */
export function toLocal(origin, p) {
  return {
    x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * R,
  }
}

/** Metres east/north of `origin` -> GPS point. */
export function fromLocal(origin, {x, y}) {
  return {
    lat: origin.lat + deg(y / R),
    lng: origin.lng + deg(x / (R * Math.cos(rad(origin.lat)))),
  }
}

/** Total length of a local polyline [{x, y}]. */
export function polylineLength(pts) {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return total
}

/** Drop points closer than `minGap` metres to the previous one (duplicate vertices). */
export function dedupe(pts, minGap = 0.3) {
  const out = []
  for (const p of pts) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minGap) out.push(p)
  }
  return out
}

/**
 * Points every `step` metres along a polyline, each with its distance along the route
 * (s) and the compass heading of travel (degrees clockwise from north).
 */
export function resample(pts, step = 1) {
  const out = []
  if (pts.length < 2) return out
  let s = 0
  let next = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    const heading = (deg(Math.atan2(b.x - a.x, b.y - a.y)) + 360) % 360
    while (next <= s + len) {
      const t = (next - s) / len
      out.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: next, heading})
      next += step
    }
    s += len
  }
  return out
}

/**
 * Nearest point on the polyline to p.
 * Returns {s (metres along the route), offset (metres sideways), x, y, segment}.
 */
export function projectOntoPolyline(pts, p) {
  let best = {s: 0, offset: Infinity, x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, segment: 0}
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const len = Math.sqrt(len2)
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const x = a.x + dx * t
    const y = a.y + dy * t
    const d = Math.hypot(p.x - x, p.y - y)
    if (d < best.offset) best = {s: s + len * t, offset: d, x, y, segment: i - 1}
    s += len
  }
  return best
}

/**
 * Corners where the route turns by more than `minAngle` degrees.
 * Returns [{index, s, x, y, angle}]: angle > 0 for right turns, < 0 for left.
 */
export function findTurns(pts, minAngle = 35) {
  const turns = []
  let s = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    s += Math.hypot(b.x - a.x, b.y - a.y)
    const h1 = Math.atan2(b.x - a.x, b.y - a.y)
    const h2 = Math.atan2(c.x - b.x, c.y - b.y)
    let d = deg(h2 - h1)
    d = ((d + 540) % 360) - 180
    if (Math.abs(d) >= minAngle) turns.push({index: i, s, x: b.x, y: b.y, angle: d})
  }
  return turns
}

/** Remove tiny zig-zags (Douglas–Peucker), keeping real corners. `tolerance` in metres. */
export function simplify(pts, tolerance = 0.6) {
  if (pts.length < 3) return pts.slice()
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()
    let maxD = 0
    let idx = -1
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointSegmentDistance(pts[i], pts[i0], pts[i1])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = true
      stack.push([i0, idx], [idx, i1])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
