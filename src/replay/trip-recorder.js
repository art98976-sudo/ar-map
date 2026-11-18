// Phase 1: the trip recorder. With ?debug=1 or ?fieldtest=1 it keeps, in memory, every input the AR
// trip used (each camera frame's SLAM pose and tracking state, each compass reading, each GPS fix,
// each tap) and what the trip made of them (its stats, four times a second). The file it
// downloads replays through the real trip logic on a laptop (replay.js), so a field walk can be
// measured, and every later fix measured against it. Normal users never create one.

export const RECORD_SCHEMA = 'welcome-ar-trip-record/1'

const r = (v, digits = 4) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null)

/** The stats fields kept per output row: what the replay metrics read. */
export const OUTPUT_FIELDS = [
  'phase', 'arrowsShown', 'userS', 'lateralOffsetM', 'distanceFromRouteM', 'floorLevel', 'positionSource', 'headingSource',
  'gpsAccuracyM', 'gpsIgnored', 'backOutside', 'entranceAnchored', 'trackedLat', 'trackedLng', 'trackedHeadingDeg', 'heading',
  'headingAccuracy', 'compassSource', 'headingSwingDeg', 'arrowBearingDeg', 'guideDeg', 'positionUncertain', 'positionReason',
  'tracking', 'yawDeg', 'remainingM', 'rerouting', 'routeVersion', 'directionKnown', 'pf',
]

/**
 * clock: milliseconds (Date.now). maxEvents: the oldest events are dropped past this, so a long
 * walk cannot use up the phone's memory (about 25 minutes at 30 fps).
 */
export function createTripRecorder({clock = () => Date.now(), maxEvents = 60000} = {}) {
  const events = []
  const startedAt = clock()
  let meta = {}
  let frames = 0
  let dropped = 0
  const push = (e) => {
    events.push({t: clock() - startedAt, ...e})
    if (events.length > maxEvents) {
      events.shift()
      dropped += 1
    }
  }

  return {
    /** Facts about the whole trip: the route, origin, start point, destination, flags. */
    meta(extra) {
      meta = {...meta, ...extra}
    },
    compass({heading, accuracy, source, beta}) {
      push({k: 'c', h: r(heading, 2), a: r(accuracy, 1), s: source ?? null, b: r(beta, 1)})
    },
    gps(coords, timestamp = null) {
      push({k: 'g', lat: r(coords.latitude, 7), lng: r(coords.longitude, 7), acc: r(coords.accuracy, 1), alt: r(coords.altitude, 1), ts: timestamp ?? null})
    },
    tracking(status, reason = null) {
      push({k: 'k', status, reason: reason ?? null})
    },
    /** One engine frame: the time it ran with, and the camera's SLAM pose. */
    frame({dt, time, camera}) {
      frames += 1
      const p = camera?.position
      const q = camera?.quaternion
      push({k: 'f', dt: r(dt, 4), time: r(time, 4), p: p ? [r(p.x), r(p.y), r(p.z)] : null, q: q ? [r(q.x, 5), r(q.y, 5), r(q.z, 5), r(q.w, 5)] : null})
    },
    /** A tap or call on the trip (start, rotateRoute, reanchorAt...): replayed as the same call. */
    action(name, args = []) {
      push({k: 'a', name, args})
    },
    /** Something the trip did by itself: a reroute, a re-anchor. Not replayed; for reading. */
    event(name, detail = {}) {
      push({k: 'e', name, ...detail})
    },
    /** What the trip believed (a stats object): only OUTPUT_FIELDS are kept. */
    output(stats) {
      const row = {k: 'o'}
      for (const f of OUTPUT_FIELDS) if (stats[f] !== undefined) row[f] = typeof stats[f] === 'number' ? r(stats[f], 3) : stats[f]
      push(row)
    },
    /** Ground truth for a synthetic walk (synth-walk.js): never written on a phone. */
    truth(t) {
      push({k: 't', ...t})
    },
    get length() {
      return events.length
    },
    get frames() {
      return frames
    },
    toJSON() {
      return {schema: RECORD_SCHEMA, startedAt: new Date(startedAt).toISOString(), dropped, ...meta, events: events.slice()}
    },
  }
}

/** Is this a file the replay can read? */
export function isTripRecord(json) {
  return json?.schema === RECORD_SCHEMA && Array.isArray(json.events)
}

/** Offer the record as a JSON download (browser only). */
export function downloadRecord(record, {doc = globalThis.document, name = null} = {}) {
  if (!record || !doc) return false
  const data = typeof record.toJSON === 'function' ? record.toJSON() : record
  const blob = new Blob([JSON.stringify(data)], {type: 'application/json'})
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = name ?? `trip-record-${String(data.startedAt).replace(/[:.]/g, '-')}.json`
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
