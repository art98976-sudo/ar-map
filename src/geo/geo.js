// Geometry helpers: GPS <-> local metres, distances, and walking along a polyline.
//
// Local frame ("ENU"): metres from an origin point, x = east, y = north.
// For a walk of a few hundred metres an equirectangular projection is accurate to
// millimetres, which is far below GPS error, so we keep the maths simple.

const R = 6371008.8 // mean Earth radius, metres
export const toRad = (degrees) => (degrees * Math.PI) / 180
export const toDeg = (radians) => (radians * 180) / Math.PI
/** Any angle in degrees -> 0..360. */
export const wrap360 = (degrees) => ((degrees % 360) + 360) % 360
/** Smallest signed difference b - a in degrees (-180..180). */
export const angleDiff = (a, b) => wrap360(b - a + 180) - 180
/** Smallest signed turn (radians, -PI..PI) from `from` to `to`. */
export const shortestTurn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
/** Compass bearing from local point a to b, degrees clockwise from north (0..360). */
export const localBearing = (a, b) => wrap360(toDeg(Math.atan2(b.x - a.x, b.y - a.y)))

/** Great-circle distance in metres between {lat, lng} points. */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  return wrap360(toDeg(Math.atan2(y, x)))
}

const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** "north-east" for a bearing in degrees. */
export function compassPoint(degrees) {
  return COMPASS_POINTS[Math.round(wrap360(degrees) / 45) % 8]
}

/** GPS point -> metres east/north of `origin`. */
export function toLocal(origin, p) {
  return {
    x: toRad(p.lng - origin.lng) * R * Math.cos(toRad(origin.lat)),
    y: toRad(p.lat - origin.lat) * R,
  }
}

/** Metres east/north of `origin` -> GPS point. */
export function fromLocal(origin, {x, y}) {
  return {
    lat: origin.lat + toDeg(y / R),
    lng: origin.lng + toDeg(x / (R * Math.cos(toRad(origin.lat)))),
  }
}

/** Is {lat, lng} inside a closed ring of [lng, lat] points (GeoJSON order)? */
export function pointInRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Total length of a local polyline [{x, y}]. */
export function polylineLength(pts) {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return total
}

/** The point at distance s along a polyline, clamped to its ends. */
export function pointAt(route, s) {
  let walked = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + len >= s) {
      const t = len ? Math.max(0, (s - walked) / len) : 0
      return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}
    }
    walked += len
  }
  return route.at(-1)
}

/** The stretch of a polyline between distances from and to, as its own polyline. */
export function polylineSlice(route, from, to) {
  const out = [pointAt(route, from)]
  let walked = 0
  for (let i = 1; i < route.length; i++) {
    walked += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y)
    if (walked > from && walked < to) out.push(route[i])
  }
  out.push(pointAt(route, to))
  return out
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
    const heading = localBearing(a, b)
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
    const d = angleDiff(0, toDeg(h2 - h1))
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
