import {loadScene} from '../src/scene/scene-load.js'
import {fitRoute} from '../src/scene/fit-route.js'
const START = {lat: 56.14525, lng: -3.9201}
const id = process.argv[2]
const j = async (u) => (await fetch(u)).json()
const p = await j(`https://api.mazemap.com/api/pois/${id}/?srid=4326`)
const c = p.point.coordinates
const q = new URLSearchParams({srid: '4326', hc: 'false', sourcelat: START.lat, sourcelon: START.lng, sourcez: '0', targetlat: c[1], targetlon: c[0], targetz: p.z, lang: 'en', distanceunitstype: 'metric', mode: 'PEDESTRIAN'})
const r = await j(`https://routing.mazemap.com/routing/path/?${q}`)
const pts = []
for (const f of r.path.features) for (const [lng, lat] of f.geometry.coordinates) pts.push({lat, lng, z: f.properties.z})
const scene = await loadScene(pts)
const fit = fitRoute(scene)
const passed = fit.points.filter((d) => d.keep && d.door != null)
for (const [idx, pt] of fit.points.entries()) {
  if (pt.z === 0 || pt.stair || pt.keep) continue
  if (passed.some((d) => d.z === pt.z && Math.hypot(d.x - pt.x, d.y - pt.y) <= 1)) continue
  const w = scene.nearestWall(pt.z, pt, 3)
  if (w && w.d < 0.4) {
    const door = scene.doorsNear(pt.z, pt, 1.5)[0]
    console.log(`#${idx}/${fit.points.length - 1} L${pt.z} (${pt.x.toFixed(1)},${pt.y.toFixed(1)}) wall ${w.d.toFixed(2)} keep=${!!pt.keep} corner=${!!pt.corner} doorNear=${door ? door.d.toFixed(2) + ' w' + door.width.toFixed(2) : '-'}`)
  }
}
for (const rp of fit.repairs) {
  console.log('repair', JSON.stringify(rp))
  const walls = scene.wallsNear(rp.level, rp, 1.5).slice(0, 4).map((w) => `(${w.a.x.toFixed(1)},${w.a.y.toFixed(1)})-(${w.b.x.toFixed(1)},${w.b.y.toFixed(1)}) d${w.d.toFixed(2)}`)
  console.log('  walls', walls.join(' '), ' doors within 15:', scene.doorsNear(rp.level, rp, 15).length)
}
const near = scene.route3d.filter((q) => q.z === 2 && q.y > 55 && q.y < 70).map((q) => `(${q.x.toFixed(1)},${q.y.toFixed(1)})`)
console.log('raw L2 near y64:', near.join(' '))
const bad = fit.points[Number(process.argv[3] ?? -1)]
if (bad) {
  for (const w of scene.wallsNear(bad.z, bad, 1.2)) console.log(`wall (${w.a.x.toFixed(2)},${w.a.y.toFixed(2)})-(${w.b.x.toFixed(2)},${w.b.y.toFixed(2)}) d${w.d.toFixed(2)}`)
  const i = fit.points.indexOf(bad)
  console.log('neighbours', fit.points.slice(i - 2, i + 3).map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})${p.keep ? 'k' : ''}`).join(' '))
}

const at = process.argv[4] ? {x: Number(process.argv[4]), y: Number(process.argv[5]), z: Number(process.argv[6])} : null
if (at) {
  for (const w of scene.wallsNear(at.z, at, 1.5)) console.log(`W (${w.a.x.toFixed(2)},${w.a.y.toFixed(2)})-(${w.b.x.toFixed(2)},${w.b.y.toFixed(2)}) d${w.d.toFixed(2)}`)
  for (const d of scene.doorsNear(at.z, at, 3)) console.log(`D centre (${d.centre.x.toFixed(2)},${d.centre.y.toFixed(2)}) w${d.width.toFixed(2)} d${d.d.toFixed(2)}`)
  const near = fit.points.filter((p) => p.z === at.z && Math.hypot(p.x - at.x, p.y - at.y) < 3)
  console.log('route', near.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})${p.keep ? 'k' : ''}`).join(' '))
}
if (process.argv.includes('--start')) {
  console.log('first raw (local):', scene.route3d.slice(0, 8).map((q) => `(${q.x.toFixed(1)},${q.y.toFixed(1)},z${q.z})`).join(' '))
  console.log('first fitted:', fit.points.slice(0, 6).map((q) => `(${q.x.toFixed(1)},${q.y.toFixed(1)})`).join(' '), 'saved', fit.startSavedM.toFixed(1))
}
