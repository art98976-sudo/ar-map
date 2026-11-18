// ?fieldlog=1 (field-logger.js): a row every 0.5 s and at every event, all the fields a campus walk
// needs, and one JSON file. The replay test walks in through a Cottrell door and up a stair.
import {afterAll, describe, expect, it, vi} from 'vitest'
import {createFieldLogger, fieldRow, FIELD_LOG_SCHEMA} from '../../src/ar/field-logger.js'
import {cottrellRoute, runCase} from './helpers/cottrell-case.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

describe('the field log', () => {
  it('keeps one row every 0.5 s however often stats come, and a row at every event', () => {
    let t = 0
    const log = createFieldLogger({now: () => t})
    for (; t <= 2000; t += 33) log.sample({gpsLat: 56.1, gpsLng: -3.9, gpsAccuracy: 8})
    // With frames 33 ms apart a row comes at the first frame 0.5 s on: 0, 0.53, 1.06, 1.58 s.
    const gaps = log.rows.slice(1).map((r, i) => r.t - log.rows[i].t)
    expect(gaps.every((g) => g >= 500 && g < 533)).toBe(true)
    const before = log.rows.length
    log.event('entrance-anchor', {s: 40, late: false})
    expect(log.rows.at(-1).why).toBe('entrance-anchor')
    expect(log.events).toEqual([{t, name: 'entrance-anchor', s: 40, late: false}])
    const json = log.toJSON({destination: {id: 'a3'}})
    expect(json).toMatchObject({schema: FIELD_LOG_SCHEMA, intervalMs: 500, destination: {id: 'a3'}})
    expect(json.rows).toHaveLength(before + 1)
  })

  it('maps every field the walk needs', () => {
    const row = fieldRow(
      {gpsLat: 56.1, gpsLng: -3.9, gpsAccuracy: 7.4, heading: 91, compassSource: 'webkitCompassHeading', mapHeadingDeg: 88, slamPose: {x: 1, y: 1.5, z: -2, yawDeg: 12}, tracking: 'NORMAL', trackedLat: 56.1001, trackedLng: -3.9001, trackedHeadingDeg: 89, alignConfidence: 0.8, alignWhy: {decay: 0.8}, floorLevel: 2, userS: 12.3, routeSegment: 4, corridorOffsetM: 0.4, arrowsShown: true, arrowOpacity: 1, keepWalking: false},
      {t: 500},
    )
    expect(row).toMatchObject({
      t: 500,
      gps: {lat: 56.1, lng: -3.9, accuracyM: 7.4},
      compass: {headingDeg: 91, source: 'webkitCompassHeading'},
      mapHeadingDeg: 88,
      slam: {x: 1, y: 1.5, z: -2, yawDeg: 12},
      aligned: {lat: 56.1001, lng: -3.9001, headingDeg: 89},
      confidence: 0.8,
      floor: 2,
      route: {s: 12.3, segment: 4},
      arrowOffsetM: 0.4,
      arrows: {shown: true, opacity: 1, keepWalking: false},
    })
  })

  it('on a replayed walk in through a door and up a stair: rows every 0.5 s, door, anchor and floor events', async () => {
    const events = []
    // n1825 -> n428: outdoors into Cottrell on level 1, then a stair down to -1 (Phase 5 cases).
    const {result} = await runCase(cottrellRoute('n1825', 'n428'), 1, {gpsStart: true, overrides: {onEvent: (name, data) => events.push({name, ...data})}})
    let t = 0
    const log = createFieldLogger({now: () => t})
    for (const s of result.stats) {
      t = s.t
      log.sample(s)
    }
    for (const e of events) log.event(e.name, e)
    const names = new Set(events.map((e) => e.name))
    for (const n of ['entrance-anchor', 'door-crossing', 'floor-change', 'landing-anchor']) expect(names.has(n), n).toBe(true)
    const ticks = log.rows.filter((r) => r.why === 'tick')
    const gaps = ticks.slice(1).map((r, i) => r.t - ticks[i].t)
    expect(Math.max(...gaps)).toBeLessThan(600)
    const ready = ticks.filter((r) => r.aligned)
    expect(ready.length).toBeGreaterThan(50)
    for (const key of ['slam', 'aligned', 'confidence', 'floor', 'route', 'arrowOffsetM', 'mapHeadingDeg']) {
      expect(ready.filter((r) => r[key] != null).length, key).toBeGreaterThan(ready.length * 0.9)
    }
  }, 120_000)
})
