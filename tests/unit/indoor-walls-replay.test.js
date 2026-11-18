// Phase 3: a 100 m indoor walk in the Cottrell Building, on MazeMap's real level-2 walls and doors
// (campus-network.json), replayed through the real trip logic with a synthetic walk that knows the
// truth: SLAM heading drift and scale error, a compass 30° off indoors, a door start 5° off.
// Measured: where the ground arrows really lie against the corridor centre (metrics.js
// arrowCorridorError). Done = within 1 m.
import {afterAll, describe, expect, it, vi} from 'vitest'
import {polylineLength, toLocal} from '../../src/geo/geo.js'
import {CASES, cottrellCase, runCase} from './helpers/cottrell-case.js'
import {arrowCorridorError} from '../../src/replay/metrics.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

describe('a 100 m indoor walk on the real Cottrell walls', () => {
  it('builds the cases: about 100 m on level 2, with walls and doors', () => {
    for (const [a, b] of CASES) {
      const c = cottrellCase(a, b)
      expect(c.lengthM).toBeGreaterThan(90)
      expect(c.lengthM).toBeLessThan(125)
      expect(c.floor.walls.length).toBeGreaterThan(20)
      expect(c.floor.doors.length).toBeGreaterThan(10)
      expect(polylineLength(c.route.points.map((p) => toLocal(c.route.points[0], p)))).toBeGreaterThan(90)
    }
  })

  // The chevrons are solid to GROUND_ARROWS.solidM (3 m) and fade to nothing by aheadM (10 m): the
  // ones at least half visible reach about 6.5 m. Done is judged on those; all 10 m is printed too.
  it('the ground arrows stay within 1 m of the corridor centre', async () => {
    const rows = []
    for (const [a, b] of CASES) {
      const c = cottrellCase(a, b)
      for (let seed = 1; seed <= 6; seed++) {
        const {result, metrics} = await runCase(c, seed)
        const visible = arrowCorridorError(result, {aheadM: 6})
        const all = arrowCorridorError(result, {aheadM: 10})
        rows.push({route: `${a}->${b}`, seed, visible, all, wrongWay: metrics.wrongWayMoments})
      }
    }
    const pct = (v) => `${(v * 100).toFixed(0)}%`
    process.stdout.write(
      '\nPHASE 3: arrows against the corridor centre, 100 m indoor walks (Cottrell level 2)\n' +
        rows
          .map(
            (r) =>
              `  ${r.route} seed ${r.seed}: visible (0-6 m) p95 ${r.visible.p95M} m, >1 m ${pct(r.visible.over1mShare)} | all (0-10 m) p95 ${r.all.p95M} m | ` +
              `progress p95 ${r.visible.progressP95M} m | shown ${pct(r.visible.shownShare)}, faded ${pct(r.visible.fadedShare)} | wrong-way ${r.wrongWay}`,
          )
          .join('\n') +
        '\n',
    )
    // Measured when Phase 3 went in: all 12 walks within 1 m (p95 0.50-0.99 m), progress within
    // 1.3 m, no wrong-way arrows, the arrows shown 85-90% of the walk (faded 0-7%). Before Phase 3:
    // none within 1 m, and four with the progress stuck 20-25 m behind the user. Seeded: no flakes.
    for (const r of rows) {
      expect(r.visible.p95M).toBeLessThanOrEqual(1) // the arrows the user can see: within 1 m
      expect(r.visible.progressP95M).toBeLessThanOrEqual(2) // and they start where the user is
      expect(r.wrongWay).toBe(0)
      expect(r.visible.shownShare).toBeGreaterThan(0.75) // not passing by hiding them
    }
  }, 600_000)
})
