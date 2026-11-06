// GPS location for outdoor directions.
// The decision logic (is this fix good enough? are we probably indoors?) is pure,
// so it can be unit-tested; the browser API wrapper is a thin layer on top.
import {GPS} from '../config.js'

/** 'good' (≤ 10 m), 'ok' (≤ 20 m) or 'weak' (worse). */
export function accuracyLevel(accuracyM, goodAccuracyM = GPS.goodAccuracyM) {
  if (!Number.isFinite(accuracyM)) return 'weak'
  if (accuracyM <= goodAccuracyM / 2) return 'good'
  if (accuracyM <= goodAccuracyM) return 'ok'
  return 'weak'
}

/** Turn a GeolocationPositionError (or missing API) into one of our error codes. */
export function locationErrorCode(err) {
  if (!err) return 'unavailable'
  if (err.code === 1) return 'denied' // PERMISSION_DENIED (site blocked, or Location Services off for Safari)
  if (err.code === 2) return 'unavailable' // POSITION_UNAVAILABLE (location turned off, no signal)
  if (err.code === 3) return 'timeout' // TIMEOUT
  return 'unavailable'
}

/**
 * Tracks incoming fixes and decides what the location screen should show.
 * update() returns {status, accuracy, level, indoors, fix}
 *   status: 'searching' (no fix yet) | 'weak' (fix, not accurate enough) | 'ready'
 *   indoors: true once we've waited `indoorAfterMs` without ever getting a good fix
 */
export function createFixGate({goodAccuracyM = GPS.goodAccuracyM, indoorAfterMs = GPS.indoorAfterMs, startedAt = Date.now()} = {}) {
  let latest = null
  let everGood = false

  function state(now) {
    const ready = !!latest && latest.accuracy <= goodAccuracyM
    return {
      status: !latest ? 'searching' : ready ? 'ready' : 'weak',
      accuracy: latest?.accuracy ?? null,
      level: latest ? accuracyLevel(latest.accuracy, goodAccuracyM) : null,
      indoors: !ready && !everGood && now - startedAt >= indoorAfterMs,
      fix: latest,
    }
  }

  return {
    /** Feed a GeolocationPosition (or {coords, timestamp}). */
    update(position, now = Date.now()) {
      const c = position?.coords
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return state(now)
      // Keep the newest fix, not the best one: the user moves, and accuracy can also get worse.
      latest = {
        lat: c.latitude,
        lng: c.longitude,
        accuracy: Number.isFinite(c.accuracy) ? c.accuracy : Infinity,
        heading: Number.isFinite(c.heading) ? c.heading : null,
        speed: Number.isFinite(c.speed) ? c.speed : null,
        time: position.timestamp || now,
      }
      if (latest.accuracy <= goodAccuracyM) everGood = true
      return state(now)
    },
    /** Re-check without a new fix (a timer uses this for the "indoors" hint). */
    check(now = Date.now()) {
      return state(now)
    },
  }
}

/**
 * Start watching the position. Returns stop().
 * onFix(GeolocationPosition) and onError(code) are called as things happen.
 */
export function watchLocation({onFix, onError}, geo = globalThis.navigator?.geolocation) {
  if (!geo?.watchPosition) {
    onError('unsupported')
    return () => {}
  }
  const id = geo.watchPosition(
    (pos) => onFix(pos),
    (err) => onError(locationErrorCode(err)),
    {enableHighAccuracy: true, maximumAge: 0, timeout: GPS.timeoutMs},
  )
  return () => geo.clearWatch(id)
}

/** Has the user already allowed or blocked location? 'granted' | 'denied' | 'prompt' | 'unknown' */
export async function locationPermissionState(nav = globalThis.navigator) {
  try {
    const status = await nav.permissions.query({name: 'geolocation'})
    return status.state
  } catch {
    return 'unknown' // older Safari has no Permissions API for geolocation
  }
}

// ---------- the fix for this trip (later steps read it) ----------
const FIX_KEY = 'welcomeAR.fix.v1'

export function saveTripFix(fix, storage = globalThis.sessionStorage) {
  try {
    storage.setItem(FIX_KEY, JSON.stringify(fix))
  } catch {
    // storage blocked: the AR screen will simply ask GPS again
  }
}

export function readTripFix(storage = globalThis.sessionStorage) {
  try {
    const fix = JSON.parse(storage.getItem(FIX_KEY) || 'null')
    return fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) ? fix : null
  } catch {
    return null
  }
}
