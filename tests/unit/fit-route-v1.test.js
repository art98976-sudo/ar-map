// The fit may never make a leg worse than MazeMap's own line. Found by the live check (npm run
// test:live): on the way into V1 Lecture Theatre the fitted line went through a wall twice by the
// room's door, where MazeMap's line was clear. Recorded route and tiles: no network.
import {readFileSync, existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import fixture from '../fixtures/route-walkway-v1.json'
import {loadScene} from '../../src/scene/scene-load.js'
import {checkFitted, fitRoute} from '../../src/scene/fit-route.js'

const DIR = resolve(process.cwd(), 'tests/fixtures/mazemap-tiles/live')
/** MazeMap's tile server, from the recorded tiles (404 where none was recorded). */
async function recordedTiles(url) {
  const m = /latest\/(-?[\d.]+)\/(\d+)\/(\d+)\/(\d+)\.mvt/.exec(url)
  const file = m && resolve(DIR, `${m[1]}-${m[2]}-${m[3]}-${m[4]}.mvt`)
  if (!file || !existsSync(file)) return {ok: false, status: 404}
  const buf = readFileSync(file)
  return {ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)}
}

describe('fitting MazeMap routes to the walls', () => {
  it('keeps MazeMap\'s line where the fit would cross a wall it does not', async () => {
    const scene = await loadScene(fixture.points, fixture.points[0], {fetchImpl: recordedTiles})
    expect(scene.problems).toEqual([])
    const raw = checkFitted(scene, {points: scene.route3d})
    const fitted = fitRoute(scene)
    const check = checkFitted(scene, fitted)
    expect(raw.crossings).toHaveLength(0)
    expect(check.crossings).toHaveLength(0)
    expect(fitted.repairs.some((r) => r.keptMazeMap)).toBe(true) // the guard is what made it so
  })
})
