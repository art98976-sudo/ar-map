// Item 20: a room start takes its heading from the room's door in MazeMap's floor data, not the
// compass. The A3 Lecture Theatre (Cottrell level 2): its heading comes from the real door lines,
// then a walk out is replayed with the compass 30° and then 60° off. The first arrows must follow
// the map, and a compass more than 45° off must only raise the hint.
import {afterAll, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import {cottrellRoute} from './helpers/cottrell-case.js'
import {createArTrip} from '../../src/ar/trip.js'
import {synthWalk} from '../../src/replay/synth-walk.js'
import {replayTrip} from '../../src/replay/replay.js'
import {tripMetrics} from '../../src/replay/metrics.js'
import {mapHeadingStart} from '../../src/route/door-start.js'
import {floorToLocal} from '../../src/ar/building-shell.js'
import {fromLocal, toLocal} from '../../src/geo/geo.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

describe('a room start, heading from the room door', () => {
  const c = cottrellRoute('n294', 'n150') // out of the A3 Lecture Theatre, along level 2
  const o = c.route.points[0]
  const local = c.route.points.map((p) => toLocal(o, p))
  const h = mapHeadingStart(local, floorToLocal(c.floors[2], o).doors)

  it("finds the theatre's door on the route and its wall direction", () => {
    expect(h.source).toBe('wall')
    expect(h.s).toBeLessThan(20)
  })

  it.each([30, 60])('with the compass %i° off, the first arrows follow the map; past 45° only a hint', async (bias) => {
    const at = fromLocal(o, h.at)
    // The route from the doorway on (the user stands in it, facing out).
    const i = local.findIndex((p, k) => k > 0 && Math.hypot(p.x - local[0].x, p.y - local[0].y) >= h.s - 1e-6)
    const route = {...c.route, points: [{...at, z: 2, h: 3.5}, ...c.route.points.slice(Math.max(1, i))]}
    const start = {type: 'place', name: 'A3 Lecture Theatre', entranceName: null, lat: at.lat, lng: at.lng, floor: 2, headingDeg: h.headingDeg, doorFacing: 'out of the room'}
    const record = synthWalk({route, destination: {id: 'x', name: 'x', category: 'room', floor: 2, ...route.points.at(-1)}, startPoint: start, seed: 3, drift: {compassBiasDeg: bias, compassNoiseDeg: 0, buildingSwingDeg: 0}})
    // synthWalk draws the bias's size at random up to the given value: fix it at exactly `bias`.
    for (const e of record.events) if (e.k === 'c') e.h = (((e.h - record.synthetic.compassBias + bias) % 360) + 360) % 360
    const result = await replayTrip(record, {THREE, createArTrip})
    const m = tripMetrics(result)
    expect(m.headingErrorAtFirstArrowsDeg).toBeLessThan(10)
    const hint = result.stats.find((s) => s.compassHint != null)?.compassHint ?? null
    if (bias > 45) expect(hint).toBeGreaterThan(45)
    else expect(hint).toBeNull()
  }, 120_000)
})
