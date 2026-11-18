// ?fieldlog=1: the campus walking log. Every 0.5 s, and at every door crossing and trip event, one
// row of what the phone sensed and what the trip made of it, so a walk answers afterwards: how far
// SLAM really drifts, and why an entrance or a floor change went wrong. Exported as one JSON file.
// No DOM and no engine here: the AR screen feeds it the trip's stats and events (ar.js).
export const FIELD_LOG_SCHEMA = 'welcome-ar-field-log/1'

const r = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)

/** One row from the trip's stats (trip.js onStats). `why`: 'tick' or the event that caused it. */
export function fieldRow(s, {t, why = 'tick'} = {}) {
  const x = s ?? {}
  return {
    t, // ms since the log started
    why,
    gps: x.gpsLat != null ? {lat: r(x.gpsLat, 7), lng: r(x.gpsLng, 7), accuracyM: r(x.gpsAccuracy, 1)} : null,
    compass: {headingDeg: r(x.heading, 1), source: x.compassSource ?? null},
    mapHeadingDeg: r(x.mapHeadingDeg, 1), // the trip's heading for the user, from the map / alignment
    slam: x.slamPose ? {x: r(x.slamPose.x, 3), y: r(x.slamPose.y, 3), z: r(x.slamPose.z, 3), yawDeg: r(x.slamPose.yawDeg, 1)} : null,
    tracking: x.tracking ?? null,
    aligned: x.trackedLat != null ? {lat: r(x.trackedLat, 7), lng: r(x.trackedLng, 7), headingDeg: r(x.trackedHeadingDeg, 1)} : null,
    confidence: r(x.alignConfidence, 2),
    confidenceWhy: x.alignWhy ?? null,
    floor: x.floorLevel ?? null,
    floorRiseM: r(x.floorRiseM, 2),
    route: {s: r(x.userS, 2), segment: x.routeSegment ?? null, remainingM: r(x.remainingM, 1)},
    // The tracked position's distance from the route's centre line: the arrows are drawn along that
    // line from where the trip thinks the user is, so this is how far they sit from the user's path.
    arrowOffsetM: r(x.corridorOffsetM, 2),
    arrows: {shown: Boolean(x.arrowsShown), opacity: r(x.arrowOpacity, 2), keepWalking: Boolean(x.keepWalking)},
    positionSource: x.positionSource ?? null,
    headingSource: x.headingSource ?? null,
  }
}

/**
 * The log. sample(stats) as often as stats come (it keeps one every intervalMs); event(name,
 * data, stats) at once, with a row. toJSON(meta) for the file.
 */
export function createFieldLogger({intervalMs = 500, now = () => Date.now(), maxRows = 20000} = {}) {
  const startedAt = now()
  const rows = []
  const events = []
  let lastAt = -Infinity
  let last = null
  const push = (row) => {
    rows.push(row)
    if (rows.length > maxRows) rows.shift()
  }
  return {
    sample(stats) {
      last = stats
      const t = now() - startedAt
      if (t - lastAt < intervalMs) return false
      lastAt = t
      push(fieldRow(stats, {t}))
      return true
    },
    event(name, data = {}, stats = last) {
      const t = now() - startedAt
      events.push({t, name, ...data})
      push(fieldRow(stats, {t, why: name}))
    },
    get rows() {
      return rows
    },
    get events() {
      return events
    },
    toJSON(meta = {}) {
      return {schema: FIELD_LOG_SCHEMA, startedAt: new Date(startedAt).toISOString(), exportedAt: new Date(now()).toISOString(), intervalMs, ...meta, events, rows}
    },
  }
}

/** Save the log as a JSON file (on a phone: the share sheet or Downloads). */
export function downloadFieldLog(json, {doc = globalThis.document} = {}) {
  const blob = new Blob([JSON.stringify(json)], {type: 'application/json'})
  const url = URL.createObjectURL(blob)
  const a = Object.assign(doc.createElement('a'), {href: url, download: `field-log-${json.startedAt?.replace(/[:.]/g, '-') ?? Date.now()}.json`})
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
