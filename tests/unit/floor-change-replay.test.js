// Phase 4: floor changes in the Cottrell Building, replayed through the real trip logic. Each route
// takes stairs or lifts (FLOOR_CASES: 21 floor changes); the synthetic walk climbs a switchback
// stair or rides a lift in place, with SLAM's height (and its scale and drift) as a phone sees it.
// Done = the right floor in 20/20 changes (here 21/21), switched when the climb is done.
import {afterAll, describe, expect, it, vi} from 'vitest'
import {FLOOR_CASES, cottrellRoute, recordedShaftFor, runCase} from './helpers/cottrell-case.js'
import {floorChanges} from '../../src/replay/metrics.js'
import {CAMPUS_ORIGIN} from '../../src/map/campus-geo.js'
import {toLocal} from '../../src/geo/geo.js'

/** Each level change on the route: did both ends get MazeMap's recorded shape (item 9)? */
function shapeSources(route) {
  const out = []
  const pts = route.points
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].z === pts[i - 1].z) continue
    const type = pts[i].edgeType === 'lift' ? 'lift' : 'stairs'
    const ends = [pts[i - 1], pts[i]].map((p) => recordedShaftFor({type, z: p.z, ...toLocal(CAMPUS_ORIGIN, p)}))
    out.push(!ends.every(Boolean) ? 'square' : ends.every((e) => e.sameFloor) ? 'recorded' : 'recorded, stacked')
  }
  return out
}

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

describe('floor changes on stairs and lifts', () => {
  it('the trip is on the right floor after every change', async () => {
    const rows = []
    let seed = 0
    for (const [a, b, stepFree] of FLOOR_CASES) {
      const c = cottrellRoute(a, b, {stepFree})
      const {result} = await runCase(c, ++seed)
      const shapes = shapeSources(c.route)
      floorChanges(result).forEach((f, i) => rows.push({route: `${a}->${b}`, seed, shape: shapes[i] ?? '?', ...f}))
      // Start and destination in the same building: the trip never thinks the user went outdoors.
      const outdoors = result.samples.filter((x) => x.phase === 'ready' && x.floorLevel === 0)
      expect(outdoors, `${a}->${b} left the building`).toHaveLength(0)
    }
    const flags = (r) => ['early', 'strange', 'late', 'unstable'].filter((k) => r[k]).join(' ')
    process.stdout.write(
      '\nPHASE 4: floor changes (Cottrell)\n' +
        rows.map((r) => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.route} ${r.kind} ${r.from}->${r.to} (${r.shape} shape): landing ${r.landingM} m ${flags(r)}`).join('\n') +
        `\n  right floor: ${rows.filter((r) => r.ok).length}/${rows.length}` +
        `; on MazeMap's recorded shapes: ${rows.filter((r) => r.ok && r.shape.startsWith('recorded')).length}/${rows.filter((r) => r.shape.startsWith('recorded')).length}` +
        ` (${rows.filter((r) => r.shape === 'recorded').length} on both floors' own shapes)\n`,
    )
    // The recorded tile holds two stair cores; every change through them uses the real shape.
    expect(rows.filter((r) => r.shape.startsWith('recorded')).length).toBeGreaterThanOrEqual(8)
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(rows.filter((r) => r.ok).length).toBe(rows.length)
  }, 900_000)
})
