// Item 5: the entrance anchor's safety net. Tracking drops out from 3 m before the door until 3 m
// past it (a sharp turn in the doorway, a hand over the camera), so the anchor's window is missed
// by 3 m. When tracking comes back the trip must still re-anchor ("late"), on the indoor route, on
// the door's floor, with the indoor walls switched on after it, and the arrows back on the corridor.
import {afterAll, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {cottrellRoute} from './helpers/cottrell-case.js'
import {createArTrip} from '../../src/ar/trip.js'
import {synthWalk} from '../../src/replay/synth-walk.js'
import {replayTrip} from '../../src/replay/replay.js'
import {arrowCorridorError, doorSwitch} from '../../src/replay/metrics.js'
import {buildScene} from '../../src/scene/scene-data.js'
import {ENTRANCE} from '../../src/config.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

/** The walk with tracking LIMITED while the true position is between fromS and toS. */
function withDropout(record, fromS, toS) {
  const truths = record.events.filter((e) => e.k === 't')
  const t0 = truths.find((e) => e.s >= fromS).t
  const t1 = truths.find((e) => e.s >= toS).t
  const events = record.events.filter((e) => !(e.k === 'k' && e.t >= t0 && e.t <= t1))
  events.push({t: t0, k: 'k', status: 'LIMITED', reason: 'EXCESSIVE_MOTION'}, {t: t1, k: 'k', status: 'NORMAL', reason: null})
  events.sort((a, b) => a.t - b.t || (a.k === 'k' ? -1 : 1))
  return {...record, events}
}

describe('the late entrance anchor', () => {
  it.each([
    ['n1924', 'n644', 2], // the recessed car-park entrance
    ['n1284', 'n1114', 1], // a level-1 door
  ])('%s -> %s: the door missed by 3 m, then recovered', async (a, b, seed) => {
    const c = cottrellRoute(a, b)
    const record = synthWalk({route: c.route, destination: {id: 'x', name: 'x', category: 'room', floor: c.endLevel, ...c.route.points.at(-1)}, startPoint: null, seed, drift: {compassBiasDeg: 30}})
    // Where the door is along the walk: the first frame the truth is on a floor.
    const doorS = record.events.find((e) => e.k === 't' && e.level !== 0).s
    // From 3 m before the door (progress can run a little ahead of the user) to 3 m past it.
    const missed = withDropout(record, doorS - 3, doorS + 3)
    const loadScene = (points, origin) => Promise.resolve(buildScene({route: points, origin, floors: c.floors}))
    const result = await replayTrip(missed, {THREE, createArTrip, loadScene})

    const anchor = result.events.find((e) => e.name === 'entrance-anchor')
    expect(anchor, 'anchored').toBeTruthy()
    expect(anchor.late).toBe(true) // the safety net, not the usual window
    expect(anchor.s).toBeGreaterThan(doorS + ENTRANCE.nearM)
    const d = doorSwitch(result)
    void d.floorOk // measured 2 m in, inside the dropout: see the check below
    expect(d.rulesBefore).toBe(false) // no indoor wall acted before it
    // On the door's floor from the anchor on (during the dropout the trip cannot know it is in).
    const doorFloor = c.route.points.find((p) => p.z !== 0).z
    // From 0.3 s on: the stats of the anchor's own frame (and the next) are made before it runs.
    const afterAnchor = result.samples.filter((x) => x.t > anchor.t + 300 && x.truth && !x.truth.vertical && x.truth.s <= doorS + 20)
    expect(afterAnchor.length).toBeGreaterThan(0)
    expect(afterAnchor.filter((x) => x.floorLevel !== doorFloor)).toHaveLength(0)
    // Back on the indoor corridor: from 2 m after tracking returned to 20 m in.
    const after = arrowCorridorError(result, {aheadM: 6, fromS: doorS + 5, toS: doorS + 20})
    process.stdout.write(`\n  late anchor ${a}->${b}: at s ${anchor.s.toFixed(1)} (door ${doorS.toFixed(1)}), then p95 ${after.p95M} m, shown ${Math.round(after.shownShare * 100)}%, progress p95 ${after.progressP95M} m\n`)
    expect(after.shownShare).toBeGreaterThan(0.5)
    // Measured: 1.05 m and 0.99 m (the usual door entry's goal is 1 m; this is the fallback path).
    expect(after.p95M).toBeLessThanOrEqual(1.1)
    expect(after.progressP95M).toBeLessThanOrEqual(2)
  }, 120_000)
})
