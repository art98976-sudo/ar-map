// The ?debug=1 trip log: one row a second of what the AR trip believed, kept in memory only, and
// downloaded as JSON from the debug panel. It exists to find out, after a field test, which route
// the trip followed and how far its pose was from it. Normal users never create one.
import {CAMPUS_ORIGIN} from '../map/campus-geo.js'
import {toLocal} from '../geo/geo.js'

export const TRIP_LOG_SCHEMA = 1

const round = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null)

/**
 * intervalMs: the gap between rows. maxRows: the oldest rows are dropped past this (an hour).
 * now: the clock, for tests.
 */
export function createTripLog({intervalMs = 1000, maxRows = 3600, now = () => Date.now()} = {}) {
  const rows = []
  const startedAt = now()
  let lastAt = -Infinity
  let meta = {}

  return {
    /** Facts about the whole trip (the route, the start): merged into the export. */
    setMeta(extra) {
      meta = {...meta, ...extra}
    },
    /** Called every frame; build() runs at most once per interval, so it may be costly. */
    sample(build) {
      const t = now()
      if (t - lastAt < intervalMs) return false
      lastAt = t
      const row = build()
      if (!row) return false
      // Local metres in the campus model's frame (GLB origin), the frame campus-network.json uses.
      const at = Number.isFinite(row.lat) && Number.isFinite(row.lng) ? toLocal(CAMPUS_ORIGIN, row) : null
      rows.push({
        t: t - startedAt,
        ...row,
        lat: round(row.lat, 7),
        lng: round(row.lng, 7),
        campusX: round(at?.x, 2),
        campusY: round(at?.y, 2),
      })
      if (rows.length > maxRows) rows.shift()
      return true
    },
    get length() {
      return rows.length
    },
    /** The whole log as one JSON-ready object. */
    toJSON() {
      return {
        schemaVersion: TRIP_LOG_SCHEMA,
        startedAt: new Date(startedAt).toISOString(),
        exportedAt: new Date(now()).toISOString(),
        campusOrigin: CAMPUS_ORIGIN,
        ...meta,
        rows: rows.slice(),
      }
    },
  }
}

/** Offer the log as a file download (browser only). */
export function downloadTripLog(log, {doc = globalThis.document, name = null} = {}) {
  if (!log || !doc) return false
  const data = log.toJSON()
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'})
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = name ?? `trip-log-${data.startedAt.replace(/[:.]/g, '-')}.json`
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
