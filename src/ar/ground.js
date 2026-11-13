// Where the real ground is, so the arrows lie on it instead of floating on a flat-floor guess.
//
// The engine's hit tests give points on real surfaces around the user. Along the route those are
// fitted to a height at the user plus a slope. Pure maths: the hit tests themselves are in trip.js.
import {GROUND} from '../config.js'

export const HIT_TYPES = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT']


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

// ---------- The floor under the user: fast, robust height for the arrows ----------

const SURFACE = new Set(['DETECTED_SURFACE', 'ESTIMATED_SURFACE'])

/** A grid over the lower half of the screen (0..1 from the top left), searched in turn. */
export const FLOOR_GRID = (() => {
  const xs = [0.15, 0.32, 0.5, 0.68, 0.85]
  const ys = [0.55, 0.67, 0.79, 0.91]
  const out = []
  // Interleaved, so a few tests in a row already spread over the whole area.
  for (let i = 0; i < ys.length; i++) for (let j = 0; j < xs.length; j++) out.push([xs[(j + i * 2) % xs.length], ys[i]])
  return out
})()

/** Could this hit be the floor? 0.5-2.2 m below the phone, and near it. */
export function acceptFloorHit(hit, camera) {
  if (!hit || !Number.isFinite(hit.y)) return false
  const drop = camera.y - hit.y
  if (drop < GROUND.floorMinDropM || drop > GROUND.floorMaxDropM) return false
  return Math.hypot(hit.x - camera.x, hit.z - camera.z) <= GROUND.floorNearM
}

export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The floor height from hits [{x, y, z, surface}]: the median, so furniture cannot pull it up,
 * of surface hits if there are any (feature points only when nothing else exists). `found` once
 * enough of them agree within GROUND.floorBandM and spread over the floor, i.e. a flat cluster.
 */
export function floorFromHits(hits) {
  const surfaces = hits.filter((h) => h.surface)
  const use = surfaces.length >= GROUND.floorMinHits ? surfaces : hits
  if (!use.length) return {height: null, found: false, count: 0}
  const m = median(use.map((h) => h.y))
  const band = use.filter((h) => Math.abs(h.y - m) <= GROUND.floorBandM)
  const xs = band.map((h) => h.x)
  const zs = band.map((h) => h.z)
  const spread = band.length ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 0
  return {
    height: median(band.map((h) => h.y)) ?? m,
    found: band.length >= GROUND.floorFoundHits && spread >= GROUND.floorSpreadM,
    count: band.length,
  }
}

/**
 * The floor the arrows lie on. Hits come in from hit tests; a tap on the floor overrides them
 * until tracking resets (clear()). update() gives the height to draw at, eased (about 0.3 s)
 * and never moving more than GROUND.floorMaxStepM in one frame.
 *   source: 'tap' | 'hits' | 'fallback' (phone height minus the eye height, before any floor)
 */
export function createFloorFinder() {
  let hits = []
  let tapY = null
  let found = false
  let shown = null
  let last = {height: null, source: 'fallback', found: false, belowPhoneM: GROUND.defaultEyeM, hits: 0}

  return {
    /** A hit test result {x, y, z} of `type`, with the camera where it was. Returns true if kept. */
    addHit(position, type, camera, time) {
      if (!acceptFloorHit(position, camera)) return false
      hits.push({x: position.x, y: position.y, z: position.z, surface: SURFACE.has(type), time})
      if (hits.length > GROUND.floorMaxHits) hits = hits.slice(-GROUND.floorMaxHits)
      return true
    },
    /** The user tapped the floor at this world height: used straight away, no easing. */
    setTap(y) {
      tapY = y
      shown = y
    },
    /** Tracking was reset: the world may have moved, so start the search again. */
    clear() {
      hits = []
      tapY = null
      found = false
    },
    update(dt, camera, time) {
      // Only recent hits near where the user is now: the floor of this room, this stretch of path.
      hits = hits.filter((h) => time - h.time <= GROUND.floorMaxAgeS && Math.hypot(h.x - camera.x, h.z - camera.z) <= GROUND.floorNearM)
      const fit = floorFromHits(hits)
      found ||= fit.found
      let target
      let source
      if (tapY != null) {
        target = tapY
        source = 'tap'
      } else if (found && fit.height != null) {
        target = fit.height
        source = 'hits'
      } else {
        target = camera.y - GROUND.defaultEyeM
        source = 'fallback'
      }
      if (shown == null) shown = target
      const eased = shown + (target - shown) * (1 - Math.exp((-3 * dt) / GROUND.floorEaseS))
      shown += Math.max(-GROUND.floorMaxStepM, Math.min(GROUND.floorMaxStepM, eased - shown))
      last = {height: shown, target, source, found: source !== 'fallback', belowPhoneM: camera.y - shown, hits: hits.length}
      return last
    },
    get found() {
      return last.found
    },
    get current() {
      return last
    },
  }
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
    /** Set how far the floor is below the phone (debug). Ground hits near the user still correct it. */
    setEyeM(m) {
      eye = Math.max(GROUND.minEyeM, Math.min(GROUND.maxEyeM, m))
    },
    get hitCount() {
      return hits.length
    },
  }
}
