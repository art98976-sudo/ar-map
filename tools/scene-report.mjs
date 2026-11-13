// Step 1 check against live MazeMap data: for each room, plan MazeMap's route from a point on the
// campus walkway, build the scene from the floors it uses, and report what the scene holds and
// anything missing. Usage: node tools/scene-report.mjs [poiId ...]
import {loadScene} from '../src/scene/scene-load.js'
import {sceneSummary} from '../src/scene/scene-data.js'
import {checkFitted, fitRoute} from '../src/scene/fit-route.js'

const START = {lat: 56.14525, lng: -3.9201}
const CAMPUS = 2058

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function poi(id) {
  const p = await json(`https://api.mazemap.com/api/pois/${id}/?srid=4326`)
  const c = p.point?.coordinates ?? p.geometry?.coordinates
  return {id, name: p.title ?? p.identifier ?? String(id), building: p.buildingName ?? '', lng: c[0], lat: c[1], z: p.z}
}

async function route(to) {
  const q = new URLSearchParams({srid: '4326', hc: 'false', sourcelat: START.lat, sourcelon: START.lng, sourcez: '0', targetlat: to.lat, targetlon: to.lng, targetz: to.z, lang: 'en', distanceunitstype: 'metric', mode: 'PEDESTRIAN'})
  const j = await json(`https://routing.mazemap.com/routing/path/?${q}`)
  const pts = []
  for (const f of j.path.features) {
    for (const [lng, lat] of f.geometry.coordinates) {
      const last = pts.at(-1)
      if (!last || last.lat !== lat || last.lng !== lng || last.z !== f.properties.z) pts.push({lat, lng, z: f.properties.z})
    }
  }
  return pts
}

async function search(q, rows = 12) {
  const j = await json(`https://search.mazemap.com/search/equery/?${new URLSearchParams({q, rows, withpois: 'true', withbuilding: 'false', campusid: CAMPUS})}`)
  return (j.result ?? []).filter((r) => r.poiId && r.zValue != null).map((r) => r.poiId)
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set([...(await search('lecture theatre', 8)), ...(await search('seminar', 6)), ...(await search('lab', 6))])].slice(0, 20)
let missing = 0
for (const id of ids) {
  try {
    const dest = await poi(id)
    const pts = await route(dest)
    const scene = await loadScene(pts)
    console.log(`\n${dest.name} (${dest.building || 'building ?'}, level ${dest.z}) mm-${id}: ${pts.length} route points`)
    for (const row of sceneSummary(scene)) console.log('  ' + row)
    const raw = checkFitted(scene, {points: scene.route3d})
    const fitted = fitRoute(scene)
    const check = checkFitted(scene, fitted)
    console.log(`  MazeMap route: ${raw.crossings.length} wall crossings, doors up to ${raw.worstDoorOffsetM.toFixed(2)} m off centre, ${raw.minClearM.toFixed(2)} m from walls`)
    if (check.minClearM < 0.4) console.log(`    closest at (${check.worst.x.toFixed(1)}, ${check.worst.y.toFixed(1)}) level ${check.worst.z}`)
    console.log(`  Fitted route:  ${check.crossings.length} wall crossings, doors up to ${check.worstDoorOffsetM.toFixed(2)} m off centre, ${check.minClearM.toFixed(2)} m from walls, start kink ${fitted.startSavedM.toFixed(1)} m, ${fitted.repairs.length} repairs (${fitted.repairs.filter((r) => !r.fixed).length} not fixed)`)
    for (const c of check.crossings) console.log(`    STILL CROSSES a wall on level ${c.level} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`)
    for (const p of scene.problems) {
      missing += 1
      console.log('  MISSING: ' + p.text)
    }
  } catch (err) {
    console.log(`\nmm-${id}: could not check (${err.message})`)
  }
}
console.log(`\n${ids.length} rooms checked, ${missing} missing items`)
