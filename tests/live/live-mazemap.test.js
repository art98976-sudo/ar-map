// Item 21: the route and the walls against LIVE MazeMap, run from a laptop (the cloud sandbox and
// CI cannot reach MazeMap). Every other test runs on recorded data; this one says whether that
// data still matches MazeMap, and whether the real trip logic holds up on today's routes and walls.
//
//   npm run test:live                  all checks (about 2-5 minutes, a few hundred requests)
//   LIVE_ROOMS=0 npm run test:live     skip the extra rooms found by search
//
// Checks (each PASS, WARN or FAIL; FAIL fails the run):
//   1. route    Library main entrance -> A3 Lecture Theatre: MazeMap plans it, the floors load,
//               and it still matches the recorded route the replays use (tests/fixtures).
//   2. walls    that route and a few more rooms: the scene has every floor, wall, stair and lift it
//               needs, and the fitted route crosses no wall.
//   3. replay   synthetic walks of today's Library -> A3 route through the real trip logic, the
//               trip loading MazeMap's tiles itself: the Phase 1-3 targets.
//   4. tile     the recorded Cottrell tile is still what MazeMap serves.
//   5. record   every Cottrell floor's tiles saved to tests/fixtures/mazemap-tiles/live/, so the
//               floor-change replays can use MazeMap's own stair and lift shapes on every floor.
// The report is printed and saved to tests/live/report.json. Send that file (and the live/ tiles).
import {setDefaultResultOrder} from 'node:dns'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import * as THREE from 'three'
import {afterAll, describe, expect, it, vi} from 'vitest'
import fixture from '../fixtures/route-library-a3.json'
import network from '../../src/data/campus-network.json'
import {createArTrip} from '../../src/ar/trip.js'
import {boxAround, decodeFloorTile, levelPath, tilesFor, tileUrl} from '../../src/ar/mazemap-floor.js'
import {planRoute} from '../../src/route/route.js'
import {loadScene} from '../../src/scene/scene-load.js'
import {checkFitted, fitRoute} from '../../src/scene/fit-route.js'
import {synthWalk} from '../../src/replay/synth-walk.js'
import {replayTrip} from '../../src/replay/replay.js'
import {arrowCorridorError, tripMetrics} from '../../src/replay/metrics.js'
import {CAMPUS_ORIGIN} from '../../src/map/campus-geo.js'
import {fromLocal, projectOntoPolyline, toLocal} from '../../src/geo/geo.js'

setDefaultResultOrder('ipv4first') // MazeMap over IPv6 stalls on some networks (as tools/build-network.mjs)

vi.mock('../../src/ar/pin.js', async (original) => ({
  ...(await original()),
  createDestinationPin: (T) => ({group: new T.Group(), update: () => {}, dispose: () => {}}),
}))
const quiet = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]

const CAMPUS = 2058
const ROOMS = Number(process.env.LIVE_ROOMS ?? 6)
const WALKWAY = {lat: 56.14525, lng: -3.9201} // a start on the campus walkway (tools/scene-report.mjs)
const RECORDED_TILE = {file: 'tests/fixtures/mazemap-tiles/2.0-18-128217-81440.mvt', level: 2, x: 128217, y: 81440, z: 18}
const COTTRELL = 1009833

const rows = []
const note = (check, status, detail) => {
  rows.push({check, status, detail})
  process.stdout.write(`  ${status.padEnd(4)} ${check}: ${detail}\n`)
}

// Gentle on MazeMap: one request at a time, 4 a second at most.
let lastAt = 0
async function get(url) {
  const wait = lastAt + 250 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
  const res = await fetch(url, {signal: AbortSignal.timeout(20_000)})
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  return res
}

/** Metres from each point of `a` to the polyline `b`, on the same floor (local frame). */
function maxGapM(a, b) {
  let worst = 0
  for (const p of a) {
    const same = b.filter((q) => (q.z ?? 0) === (p.z ?? 0))
    if (same.length < 2) continue
    const local = same.map((q) => toLocal(CAMPUS_ORIGIN, q))
    worst = Math.max(worst, projectOntoPolyline(local, toLocal(CAMPUS_ORIGIN, p)).offset)
  }
  return worst
}

const allPoints = (route) => [...(route.points ?? []), ...(route.indoorPoints ?? []).slice(1)]

let liveRoute = null

describe('LIVE MazeMap', () => {
  afterAll(() => {
    quiet.forEach((s) => s.mockRestore())
    const counts = Object.fromEntries(['PASS', 'WARN', 'FAIL'].map((k) => [k, rows.filter((r) => r.status === k).length]))
    const report = {ranAt: new Date().toISOString(), counts, rows}
    writeFileSync(resolve(process.cwd(), 'tests/live/report.json'), JSON.stringify(report, null, 1))
    process.stdout.write(`\nLIVE MazeMap: ${counts.PASS} pass, ${counts.WARN} warn, ${counts.FAIL} fail. Saved tests/live/report.json\n`)
  })

  it('1. route: Library -> A3 is planned and still matches the recorded route', async () => {
    try {
      liveRoute = await planRoute(fixture.startPoint, fixture.destination, {network: false, stepFree: false})
    } catch (e) {
      note('route', 'FAIL', `MazeMap did not answer: ${e.message}`)
      throw e
    }
    if (liveRoute.status !== 'ok') return note('route', 'FAIL', `no route: ${liveRoute.status}`)
    // planRoute falls back to the campus footpaths when MazeMap does not answer: that is not a pass.
    if (liveRoute.source !== 'mazemap') {
      note('route', 'FAIL', `MazeMap did not answer: the app fell back to its own ${liveRoute.source} route. Is MazeMap reachable from this network?`)
      liveRoute = null
      throw new Error('MazeMap not reachable')
    }
    note('route', liveRoute.fitted?.sceneLoaded ? 'PASS' : 'FAIL', liveRoute.fitted?.sceneLoaded ? `planned and fitted, ${Math.round(liveRoute.totalM ?? liveRoute.lengthM)} m` : 'planned, but the floors did not load (not fitted)')
    const live = allPoints(liveRoute)
    const rec = allPoints(fixture.route)
    const endLevel = live.at(-1)?.z
    note('route end floor', endLevel === fixture.destination.floor ? 'PASS' : 'FAIL', `ends on level ${endLevel}, A3 is on ${fixture.destination.floor}`)
    const dLen = Math.abs((liveRoute.totalM ?? liveRoute.lengthM) - (fixture.route.totalM ?? fixture.route.lengthM))
    const gap = Math.max(maxGapM(live, rec), maxGapM(rec, live))
    // The replays use the recorded route; if MazeMap's has moved, re-record it (tools/make-replay-route.mjs).
    note('route vs recorded', gap <= 3 && dLen <= 5 ? 'PASS' : 'WARN', `${gap.toFixed(1)} m apart at most, length differs by ${dLen.toFixed(1)} m (recorded ${fixture.generatedAt?.slice(0, 10)})`)
    expect(liveRoute.status).toBe('ok')
  })

  it('2. walls: every floor, wall and shaft is there and the fitted route crosses no wall', async () => {
    const routes = []
    if (liveRoute?.status === 'ok') routes.push({name: 'Library -> A3', pts: allPoints(liveRoute)})
    if (ROOMS > 0) {
      for (const q of ['lecture theatre', 'seminar', 'lab']) {
        const j = await (await get(`https://search.mazemap.com/search/equery/?${new URLSearchParams({q, rows: 8, withpois: 'true', withbuilding: 'false', campusid: CAMPUS})}`)).json()
        for (const r of j.result ?? []) {
          if (routes.length > ROOMS || !r.poiId || r.zValue == null) continue
          const p = await (await get(`https://api.mazemap.com/api/pois/${r.poiId}/?srid=4326`)).json()
          const c = p.point?.coordinates ?? p.geometry?.coordinates
          if (!c) continue
          const room = {lat: c[1], lng: c[0], floor: p.z ?? r.zValue, category: 'room', name: p.title ?? p.identifier ?? String(r.poiId)}
          const planned = await planRoute(WALKWAY, room, {network: false, stepFree: false}).catch(() => null)
          if (planned?.status === 'ok') routes.push({name: `walkway -> ${room.name} (level ${room.floor})`, pts: allPoints(planned)})
          else note(`walls ${room.name}`, 'WARN', 'MazeMap gave no route')
        }
      }
    }
    expect(routes.length).toBeGreaterThan(0)
    for (const {name, pts} of routes) {
      const scene = await loadScene(pts)
      const fitted = fitRoute(scene)
      const check = checkFitted(scene, fitted)
      const raw = checkFitted(scene, {points: scene.route3d})
      const problems = scene.problems.map((p) => p.kind)
      const bad = check.crossings.length > 0 || problems.length > 0
      note(`walls ${name}`, bad ? 'FAIL' : 'PASS', `fitted: ${check.crossings.length} wall crossings, ${check.minClearM.toFixed(2)} m from walls; MazeMap's own: ${raw.crossings.length} crossings${problems.length ? `; MISSING ${problems.join(', ')}` : ''}`)
    }
    expect(rows.filter((r) => r.check.startsWith('walls') && r.status === 'FAIL')).toEqual([])
  })

  it("3. replay: today's Library -> A3 through the real trip, on MazeMap's live tiles", async () => {
    expect(liveRoute?.status, 'needs check 1').toBe('ok')
    const route = {...liveRoute, fitted: undefined} // as the recorded fixture: no fitting details
    for (const [seed, facing, manual] of [[1, 'path', true], [2, 'path', true], [3, 'away', true], [4, 'path', false], [5, 'away', false]]) {
      const record = synthWalk({route, destination: fixture.destination, startPoint: manual ? fixture.startPoint : null, seed, facing})
      const result = await replayTrip(record, {THREE, createArTrip}) // the trip fetches the tiles itself
      const m = tripMetrics(result)
      const corridor = arrowCorridorError(result)
      const failed = Object.entries(m.pass ?? {}).filter(([, ok]) => !ok).map(([k]) => k)
      note(
        `replay seed ${seed} (${manual ? 'chosen start' : 'GPS start'}, facing ${facing})`,
        failed.length ? 'FAIL' : 'PASS',
        `first arrows ${m.headingErrorAtFirstArrowsDeg}° off, wrong-way ${m.wrongWayMoments}, door ${m.doorErrorM} m, wrong floor ${m.wrongFloorS} s, indoor arrows p95 ${corridor.p95M ?? '?'} m from the corridor${failed.length ? `; missed: ${failed.join(', ')}` : ''}`,
      )
    }
    expect(rows.filter((r) => r.check.startsWith('replay') && r.status === 'FAIL')).toEqual([])
  })

  it('4. tile: the recorded Cottrell tile is what MazeMap serves now', async () => {
    const decode = (buf) => decodeFloorTile(buf, RECORDED_TILE)
    const recorded = decode(readFileSync(resolve(process.cwd(), RECORDED_TILE.file)))
    const live = decode(await (await get(tileUrl(RECORDED_TILE.level, RECORDED_TILE))).arrayBuffer())
    const keys = ['walls', 'doors', 'stairs', 'lifts', 'outlines']
    const diff = keys.filter((k) => recorded[k].length !== live[k].length)
    note('tile vs recorded', diff.length ? 'WARN' : 'PASS', keys.map((k) => `${k} ${live[k].length}${recorded[k].length !== live[k].length ? ` (recorded ${recorded[k].length})` : ''}`).join(', '))
  })

  it("5. record: every Cottrell floor's tiles, for the floor-change replays", async () => {
    const nodes = network.nodes.filter((n) => n.building === COTTRELL)
    const xs = nodes.map((n) => n.x)
    const ys = nodes.map((n) => n.y)
    const centre = fromLocal(CAMPUS_ORIGIN, {x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2})
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 10
    const levels = Object.keys(network.floors[COTTRELL].levels).map(Number)
    const dir = resolve(process.cwd(), 'tests/fixtures/mazemap-tiles/live')
    mkdirSync(dir, {recursive: true})
    const found = []
    for (const level of levels) {
      let stairs = 0
      let lifts = 0
      let saved = 0
      for (const t of tilesFor(boxAround(centre, half))) {
        const res = await fetch(tileUrl(level, t), {signal: AbortSignal.timeout(20_000)})
        if (!res.ok) continue // no tile there on this floor
        const buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(resolve(dir, `${levelPath(level)}-${t.z ?? 18}-${t.x}-${t.y}.mvt`), buf)
        const f = decodeFloorTile(buf, {z: 18, ...t})
        stairs += f.stairs.length
        lifts += f.lifts.length
        saved += 1
      }
      found.push(`level ${level}: ${saved} tiles, ${stairs} stair and ${lifts} lift shapes`)
    }
    note('record Cottrell tiles', found.length ? 'PASS' : 'FAIL', `${found.join('; ')} -> tests/fixtures/mazemap-tiles/live/`)
  })
})
