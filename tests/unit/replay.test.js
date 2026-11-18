// Phase 1: the trip recorder, the replay through the real trip logic, and the metrics.
import {afterAll, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import fixture from '../fixtures/route-library-a3.json'
import {createArTrip} from '../../src/ar/trip.js'
import {createTripRecorder, isTripRecord} from '../../src/replay/trip-recorder.js'
import {cameraQuaternion, synthWalk} from '../../src/replay/synth-walk.js'
import {replayTrip} from '../../src/replay/replay.js'
import {formatMetrics, tripMetrics} from '../../src/replay/metrics.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))

const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

const walk = (opts = {}) => synthWalk({route: fixture.route, destination: fixture.destination, startPoint: fixture.startPoint, ...opts})
const replay = (record, opts = {}) => replayTrip(record, {THREE, createArTrip, ...opts})

describe('synthetic walk', () => {
  it('a camera quaternion faces the bearing it was given', () => {
    const cam = new THREE.PerspectiveCamera()
    for (const deg of [0, 45, 90, 200]) {
      const q = cameraQuaternion(deg, 0)
      cam.quaternion.set(q.x, q.y, q.z, q.w)
      const f = cam.getWorldDirection(new THREE.Vector3())
      const bearing = ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360
      expect(Math.abs(((bearing - deg + 540) % 360) - 180)).toBeLessThan(0.01)
    }
  })

  it('is a valid trip record: frames, compass, GPS, the start tap and truth, same for the same seed', () => {
    const a = walk({seed: 3})
    expect(isTripRecord(a)).toBe(true)
    const kinds = new Set(a.events.map((e) => e.k))
    for (const k of ['f', 'c', 'g', 'k', 'a', 't']) expect(kinds.has(k)).toBe(true)
    expect(a.events.filter((e) => e.k === 't').at(-1).s).toBeGreaterThan(130) // walked the whole route (137 m once simplified)
    expect(JSON.stringify(walk({seed: 3}).events.slice(0, 500))).toBe(JSON.stringify(a.events.slice(0, 500)))
  })
})

describe('recorder', () => {
  it('records frames, sensors, taps and outputs with the times they happened', () => {
    let now = 1000
    const rec = createTripRecorder({clock: () => now})
    rec.meta({origin: {lat: 1, lng: 2}})
    now = 1050
    rec.compass({heading: 12.345, accuracy: 10, source: 'x', beta: 80})
    rec.frame({dt: 0.033, time: 1.05, camera: {position: {x: 1, y: 1.5, z: -2}, quaternion: {x: 0, y: 0, z: 0, w: 1}}})
    rec.action('start', [])
    rec.output({phase: 'ready', arrowsShown: true, notKept: 5})
    const json = rec.toJSON()
    expect(isTripRecord(json)).toBe(true)
    expect(json.origin).toEqual({lat: 1, lng: 2})
    expect(json.events.map((e) => e.k)).toEqual(['c', 'f', 'a', 'o'])
    expect(json.events[0]).toMatchObject({t: 50, h: 12.35})
    expect(json.events[3]).toEqual({t: 50, k: 'o', phase: 'ready', arrowsShown: true})
  })
})

describe('replay through the real trip', () => {
  it('a trip recording made during a replay replays to the same trip, frame by frame', async () => {
    const record = walk({seed: 1})
    // Replay once with the trip recording itself, then replay that recording.
    let recorded = null
    const first = await replay(record, {
      overrides: {record: true},
      onFrame: (_x, trip) => (recorded = trip.recorder),
    })
    const copy = recorded.toJSON()
    expect(isTripRecord(copy)).toBe(true)
    expect(copy.events.filter((e) => e.k === 'f').length).toBe(first.samples.length)
    const again = await replay(copy)
    const pick = (r) => r.samples.filter((_, i) => i % 97 === 0).map((x) => [x.arrowsShown, Math.round((x.userS ?? 0) * 100), Math.round((x.guideDeg ?? 0) * 10)])
    expect(pick(again)).toEqual(pick(first))
  }, 60_000)

  it('baseline metrics (the current trip logic) on synthetic Library → A3 walks', async () => {
    const runs = []
    for (const [seed, facing, start] of [
      [1, 'path', 'manual'],
      [2, 'path', 'manual'],
      [3, 'away', 'manual'],
      [4, 'path', 'gps'],
      [5, 'away', 'gps'],
    ]) {
      const record = walk({seed, facing, startPoint: start === 'manual' ? fixture.startPoint : null})
      const m = tripMetrics(await replay(record))
      runs.push({seed, facing, start, ...m})
      expect(m.truth).toBe(true)
      expect(m.frames).toBeGreaterThan(1000)
    }
    // Printed so each phase can show before / after. Targets are asserted from Phase 3 on.
    process.stdout.write('\nBASELINE (current logic)\n' + runs.map((r) => `seed ${r.seed} ${r.start} facing ${r.facing}\n  ` + formatMetrics(r).join('\n  ')).join('\n') + '\n')
    // Item 23: seed 5 (GPS start, facing away) had the arrows under the user pointing round the
    // first corner for 2.7 s while the user still walked straight. No run may have one now.
    for (const r of runs) expect(r.wrongWayMoments, `seed ${r.seed} wrong-way moments`).toBe(0)
  }, 180_000)
})
