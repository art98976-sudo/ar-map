// Alignment Phase 1, step 5: a trip that starts indoors, at a door, replayed through the real trip
// logic (replay.js) with a synthetic walk that knows the truth (synth-walk.js): SLAM drift, and an
// indoor compass 30° off. The door's heading comes from the real Cottrell wall (MazeMap geometry),
// not from the route, so the test is not circular: does the first step go down the right corridor?
import {afterAll, describe, expect, it, vi} from 'vitest'
import * as THREE from 'three'
import fixture from '../fixtures/route-library-a3.json'
import network from '../../src/data/campus-network.json'
import {createArTrip} from '../../src/ar/trip.js'
import {synthWalk} from '../../src/replay/synth-walk.js'
import {replayTrip} from '../../src/replay/replay.js'
import {tripMetrics} from '../../src/replay/metrics.js'
import {exteriorDoors, rankDoors} from '../../src/route/door-start.js'
import {fromLocal, toLocal} from '../../src/geo/geo.js'

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
afterAll(() => quiet.forEach((s) => s.mockRestore()))

// The indoor part of MazeMap's Library -> A3 route: from the A3 entrance door to the lecture theatre.
const indoor = fixture.route.indoorPoints
const route = {...fixture.route, points: indoor, indoorPoints: undefined, entrance: indoor.at(-1), lengthM: fixture.route.totalM}
const doorPoint = indoor[0]

// The door's heading from the real wall, as the app computes it (door-data.js does the same on tiles).
const buildings = network.areas.blocked
  .filter((a) => a.kind === 'building' && a.source === 'mazemap')
  .map((b) => ({id: 1009833, name: 'Cottrell Building', rings: b.polygon.map((ring) => ring.map(([x, y]) => ({x, y})))}))
const lines = network.doorLines.map((d, i) => ({id: i, level: d.z, a: {x: d.a[0], y: d.a[1]}, b: {x: d.b[0], y: d.b[1]}}))
const a3 = rankDoors(exteriorDoors(lines, buildings).filter((d) => d.level === 1), toLocal(network.origin, doorPoint), 1)[0]

const INDOOR_COMPASS = {compassBiasDeg: 30, buildingSwingDeg: 25} // 10-40° wrong indoors (the brief)
const run = async (seed, startPoint) => tripMetrics(await replayTrip(synthWalk({route, destination: fixture.destination, startPoint, seed, drift: INDOOR_COMPASS}), {THREE, createArTrip}))

describe('an indoor start at the Cottrell A3 door', () => {
  it('the door heading puts the first arrows down the corridor: 10 starts, at least 9 right', async () => {
    expect(a3.d).toBeLessThan(2)
    const doorStarts = []
    const compassStarts = []
    for (let seed = 1; seed <= 10; seed++) {
      // Standing in the doorway, give or take half a metre to the side.
      const at = fromLocal(doorPoint, {x: (seed % 3) * 0.25 - 0.25, y: 0})
      doorStarts.push(await run(seed, {type: 'door', name: 'Cottrell Building', entranceName: 'A3 entrance', lat: at.lat, lng: at.lng, floor: 1, headingDeg: a3.inwardDeg, doorFacing: 'inside'}))
      if (seed <= 5) compassStarts.push(await run(seed, {type: 'map', name: 'Pin on the map', lat: at.lat, lng: at.lng, headingDeg: null, facing: null}))
    }
    // "Right": the first arrows within 10° of the real direction, and no wrong-way moment after.
    const right = (m) => m.headingErrorAtFirstArrowsDeg != null && m.headingErrorAtFirstArrowsDeg < 10 && m.wrongWayMoments === 0
    const line = (m) => `first arrows ${m.headingErrorAtFirstArrowsDeg}° off, wrong-way ${m.wrongWayMoments}, arrow median ${m.arrowErrorMedianDeg}°, indoor offset ${m.offsetIndoorMedianM} m`
    process.stdout.write(
      `\nINDOOR START, Cottrell A3 door (wall heading ${a3.inwardDeg.toFixed(1)}°), compass ${INDOOR_COMPASS.compassBiasDeg}° off\n` +
        doorStarts.map((m, i) => `  door    seed ${i + 1}: ${line(m)}`).join('\n') +
        '\n' +
        compassStarts.map((m, i) => `  compass seed ${i + 1}: ${line(m)}`).join('\n') +
        `\n  right first step: door ${doorStarts.filter(right).length}/10, compass ${compassStarts.filter(right).length}/5\n`,
    )
    expect(doorStarts.filter(right).length).toBeGreaterThanOrEqual(9)
  }, 300_000)
})
