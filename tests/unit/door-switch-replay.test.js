// Phase 5: outdoors to indoors. GPS starts on the paths outside Cottrell, walking in through 10
// different doors (2 walks each), replayed through the real trip logic: GPS 6 m off in the open,
// 13 m by the building and 30 m inside, SLAM drift, a compass 30° off. At the door the trip must
// re-anchor on the door's known position before the indoor walls act, and the arrows must then lie
// on the indoor corridor. The goal is every time; see the assertions for where it stands.
import {afterAll, describe, expect, it, vi} from 'vitest'
import {DOOR_CASES, cottrellRoute, runCase} from './helpers/cottrell-case.js'
import {doorSwitch} from '../../src/replay/metrics.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

describe('in through the building door', () => {
  it('re-anchors at the door, before the indoor walls, and the arrows switch to the indoor corridor', async () => {
    const rows = []
    for (const [a, b] of DOOR_CASES) {
      const c = cottrellRoute(a, b)
      for (const seed of [1, 2]) {
        const {result} = await runCase(c, seed, {gpsStart: true})
        const d = doorSwitch(result)
        // Arrows must be shown inside to count (null <= 1 is true in JavaScript: no arrows is a fail).
        const shown = d.inside.p95M != null && d.inside.shownShare >= 0.5
        const ok = d.anchored && d.anchorOffM <= 2 && !d.rulesBefore && d.floorOk && shown && d.inside.p95M <= 1 && d.inside.progressP95M <= 2
        rows.push({route: `${a}->${b}`, seed, ok, ...d})
      }
    }
    process.stdout.write(
      '\nPHASE 5: in through the door (Cottrell, GPS starts)\n' +
        rows
          .map((r) => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.route} seed ${r.seed}: anchored ${r.anchored} (${r.anchorOffM} m from the door), walls before ${r.rulesBefore}, floor ${r.floorOk}, inside p95 ${r.inside.p95M} m (shown ${Math.round((r.inside.shownShare ?? 0) * 100)}%), progress ${r.inside.progressP95M} m`)
          .join('\n') +
        `\n  switched to the indoor corridor at the door: ${rows.filter((r) => r.ok).length}/${rows.length}\n`,
    )
    expect(rows).toHaveLength(20)
    // Held every time: the anchor fires, within 2.1 m of the door, before any indoor wall acts,
    // and the trip is on the door's floor 2 m inside.
    for (const r of rows) {
      expect(r.anchored).toBe(true)
      expect(r.anchorOffM).toBeLessThanOrEqual(2.1)
      expect(r.rulesBefore).toBe(false)
      expect(r.floorOk).toBe(true)
    }
    // Item 4: the arrows do not fade at the first turns inside: shown at least 3/4 of the way in on
    // every entry (when uncertain how far along it is, the trip stops them at the turn instead).
    for (const r of rows) expect(r.inside.shownShare, r.route).toBeGreaterThanOrEqual(0.75)
    // NOT yet every time: the arrows within 1 m of the indoor corridor from 2 to 20 m in. 11/20
    // when Phase 5 went in, 14/20 after item 4 (3/20 before Phase 5, counted loosely). What is left
    // traces to when outdoor progress says "door": 0.8-2.1 m from the true crossing on the failing
    // entries, which only a sensed door or sign can do better than. This stops it getting worse.
    expect(rows.filter((r) => r.ok).length).toBeGreaterThanOrEqual(14)
  }, 900_000)
})
