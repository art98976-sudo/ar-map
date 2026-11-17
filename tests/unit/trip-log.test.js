import {describe, expect, it} from 'vitest'
import {createTripLog, TRIP_LOG_SCHEMA} from '../../src/ar/trip-log.js'

describe('trip log (?debug=1)', () => {
  it('records at most one row a second, in the campus frame too', () => {
    let t = 1000
    const log = createTripLog({now: () => t})
    log.setMeta({routeSource: 'mazemap', startFloor: 0})
    let builds = 0
    const row = () => {
      builds += 1
      return {routeSource: 'mazemap', lat: 56.1455, lng: -3.92, headingDeg: 90, tracking: 'NORMAL', snapDistanceM: 0.4, confident: true}
    }
    expect(log.sample(row)).toBe(true)
    t += 400
    expect(log.sample(row)).toBe(false)
    t += 600
    expect(log.sample(row)).toBe(true)
    expect(builds).toBe(2)
    const out = log.toJSON()
    expect(out.schemaVersion).toBe(TRIP_LOG_SCHEMA)
    expect(out.routeSource).toBe('mazemap')
    expect(out.rows).toHaveLength(2)
    expect(out.rows[1].t).toBe(1000)
    // The GLB origin itself is (0, 0) in the campus frame.
    expect(out.rows[0].campusX).toBe(0)
    expect(out.rows[0].campusY).toBe(0)
  })

  it('keeps only the newest rows past the limit', () => {
    let t = 0
    const log = createTripLog({now: () => t, maxRows: 3})
    for (let i = 0; i < 5; i++) {
      log.sample(() => ({i, lat: null, lng: null}))
      t += 1000
    }
    expect(log.toJSON().rows.map((r) => r.i)).toEqual([2, 3, 4])
    expect(log.toJSON().rows[0].campusX).toBeNull()
  })
})
