// Where the real ground is, so the arrows lie on it instead of floating on a flat-floor guess.
//
// The engine's hit tests give points on real surfaces around the user. Along the route those are
// fitted to a height at the user plus a slope. Pure maths: the hit tests themselves are in trip.js.

export const GROUND = {
  sampleEveryS: 0.15,
  belowPhoneM: 0.3, // a hit must be at least this far below the phone
  maxDistanceM: 14,
  maxOffRouteM: 4,
  maxHits: 160,
  maxAgeS: 30,
  recencyS: 10, // newer hits count for more: e^(-age / this)
  minHits: 4,
  outlierM: 0.35,
  maxSlope: 0.18,
  minSpanM: 3, // along the route, before believing any slope
  nearUserM: 4, // hits this close teach the height of the phone above the ground
  defaultEyeM: 1.45,
  minEyeM: 0.8,
  maxEyeM: 2.1,
  easeS: 0.4,
}

export const HIT_TYPES = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT']

/** Spots in the lower half of the screen (0..1), where the ground usually is. */
export const SCREEN_POINTS = [
  [0.5, 0.6],
  [0.3, 0.68],
  [0.7, 0.68],
  [0.5, 0.75],
  [0.2, 0.82],
  [0.8, 0.82],
  [0.5, 0.88],
  [0.35, 0.95],
  [0.65, 0.95],
]

/**
 * Keep a hit only if it could be the path: below the phone, not far off, near the route.
 * hit, camera: {x, y, z} in the world. offRouteM: the hit's distance from the route.
 */
export function acceptHit(hit, camera, offRouteM) {
  if (!hit || !Number.isFinite(hit.y)) return false
  if (hit.y > camera.y - GROUND.belowPhoneM) return false
  if (Math.hypot(hit.x - camera.x, hit.z - camera.z) > GROUND.maxDistanceM) return false
  return offRouteM <= GROUND.maxOffRouteM
}

function solve(points) {
  let w = 0
  let ws = 0
  let wy = 0
  let wss = 0
  let wsy = 0
  for (const p of points) {
    w += p.weight
    ws += p.weight * p.ds
    wy += p.weight * p.y
    wss += p.weight * p.ds * p.ds
    wsy += p.weight * p.ds * p.y
  }
  const det = w * wss - ws * ws
  const slope = det > 1e-9 ? (w * wsy - ws * wy) / det : 0
  return {height: (wy - slope * ws) / w, slope}
}

function spanOf(points) {
  const ds = points.map((p) => p.ds)
  return Math.max(...ds) - Math.min(...ds)
}

function flatHeight(points, slope) {
  let w = 0
  let sum = 0
  for (const p of points) {
    w += p.weight
    sum += p.weight * (p.y - slope * p.ds)
  }
  return sum / w
}

/**
 * Weighted least squares fit of y = height + slope * (s - userS), dropping the worst outlier
 * until everything is within 0.35 m. hits: [{s, y, time}]. Returns null with too little to go on.
 */
export function fitGround(hits, userS, now) {
  let points = hits
    .filter((h) => now - h.time <= GROUND.maxAgeS)
    .map((h) => ({...h, ds: h.s - userS, weight: Math.exp(-(now - h.time) / GROUND.recencyS)}))
  if (points.length < GROUND.minHits) return null

  // Too short a stretch to see a slope in: fit a flat height.
  const fitNow = (list) => (spanOf(list) < GROUND.minSpanM ? {height: flatHeight(list, 0), slope: 0} : solve(list))
  let fit = fitNow(points)
  while (points.length > GROUND.minHits) {
    let worst = -1
    let worstError = GROUND.outlierM
    points.forEach((p, i) => {
      const error = Math.abs(p.y - (fit.height + fit.slope * p.ds))
      if (error > worstError) {
        worst = i
        worstError = error
      }
    })
    if (worst < 0) break
    points = points.filter((_, i) => i !== worst)
    fit = fitNow(points)
  }

  const slope = Math.max(-GROUND.maxSlope, Math.min(GROUND.maxSlope, fit.slope))
  const height = slope === fit.slope ? fit.height : flatHeight(points, slope)
  return {height, slope, inliers: points, span: spanOf(points)}
}

/** Collects hits and gives a smooth ground height and slope. */
export function createGroundTracker() {
  let hits = []
  let eye = GROUND.defaultEyeM
  let shown = null
  let source = 'eye'

  return {
    /** s: distance along the route. y: world height of the hit. camY: the phone's height then. */
    addHit(s, y, camY, time) {
      hits.push({s, y, camY, time})
      if (hits.length > GROUND.maxHits) hits = hits.slice(-GROUND.maxHits)
    },
    /** With no hits at all: the phone's height minus a typical eye height. */
    fallback: (camY) => camY - eye,
    update(dt, userS, camY, time) {
      hits = hits.filter((h) => time - h.time <= GROUND.maxAgeS)
      const fit = fitGround(hits, userS, time)
      if (fit) {
        const near = fit.inliers.filter((p) => Math.abs(p.ds) <= GROUND.nearUserM)
        if (near.length) {
          const w = near.reduce((sum, p) => sum + p.weight, 0)
          const seen = near.reduce((sum, p) => sum + p.weight * (p.camY - (p.y - fit.slope * p.ds)), 0) / w
          eye = Math.max(GROUND.minEyeM, Math.min(GROUND.maxEyeM, seen))
        }
      }
      source = fit ? 'hits' : 'eye'
      const target = fit ? {height: fit.height, slope: fit.slope} : {height: camY - eye, slope: 0}
      if (!shown) shown = {...target}
      // About 95% of the way in 0.4 s.
      const k = 1 - Math.exp((-3 * dt) / GROUND.easeS)
      shown = {height: shown.height + (target.height - shown.height) * k, slope: shown.slope + (target.slope - shown.slope) * k}
      return {...shown, source}
    },
    get eyeM() {
      return eye
    },
    get hitCount() {
      return hits.length
    },
  }
}
