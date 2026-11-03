// Suggests a main entrance for each destination, using MazeMap's own routing:
// we ask for a walking route from the main campus walkway to the building, and take
// the point where the route first goes indoors (that is the door people use).
// Results are suggestions: confirm each one on campus (see ENTRANCES.md).
//   node tools/find-entrances.mjs            print suggestions
//   node tools/find-entrances.mjs --write    also write them into destinations.json
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'src', 'data', 'destinations.json')
const data = JSON.parse(readFileSync(file, 'utf8'))

// Start point: the main walkway between the Cottrell Building and the Atrium.
const ORIGIN = {lat: 56.14525, lng: -3.9201}
// Outdoor places have no door; their "entrance" is the place itself.
const OUTDOOR = new Set(['airthrey-loch'])

async function route(from, to) {
  const q = new URLSearchParams({
    srid: '4326',
    hc: 'false',
    sourcelat: String(from.lat),
    sourcelon: String(from.lng),
    sourcez: '0',
    lang: 'en',
    distanceunitstype: 'metric',
    mode: 'PEDESTRIAN',
  })
  if (to.mazemapPoi) q.set('targetpoi', String(to.mazemapPoi))
  else {
    q.set('targetlat', String(to.lat))
    q.set('targetlon', String(to.lng))
    q.set('targetz', '1')
  }
  const res = await fetch(`https://routing.mazemap.com/routing/path/?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()).path?.features || []
}

for (const d of data.destinations) {
  if (OUTDOOR.has(d.id)) {
    d.entrance = {lat: d.lat, lng: d.lng, via: 'outdoor place', confirmed: false}
    console.log(`${d.name.padEnd(26)} outdoor place`)
    continue
  }
  try {
    let feats
    try {
      feats = await route(ORIGIN, d)
    } catch {
      feats = await route(ORIGIN, {lat: d.lat, lng: d.lng}) // the POI id can be stale: retry by position
    }
    const building = (f) => f?.properties?.buildingId ?? null
    const target = building(feats.at(-1))
    let door = null
    if (target == null) {
      // Route ends outdoors: the place has no indoor map, so the route end is the arrival point.
      const end = feats.at(-1)?.geometry.coordinates.at(-1)
      if (!end) throw new Error('empty route')
      door = {coordinates: end, note: 'route end (no indoor map)'}
    } else {
      // Outdoor directions end at the door where the route LAST goes from outside to
      // inside. A shortcut through another building earlier on does not count, and a
      // building you reach through another one (Library via the Atrium) gets the outer door.
      for (let i = feats.length - 1; i > 0; i--) {
        if (building(feats[i]) != null && building(feats[i - 1]) == null) {
          door = {coordinates: feats[i].geometry.coordinates[0], note: `door into building ${building(feats[i])}`}
          break
        }
      }
      if (!door) throw new Error('route starts inside the building')
    }
    const [lng, lat] = door.coordinates
    d.entrance = {lat: +lat.toFixed(6), lng: +lng.toFixed(6), via: `mazemap route, ${door.note}`, confirmed: false}
    console.log(`${d.name.padEnd(26)} ${lat.toFixed(6)}, ${lng.toFixed(6)}  (${door.note})`)
  } catch (err) {
    d.entrance = d.entrance || {lat: d.lat, lng: d.lng, via: 'building centre (no route found)', confirmed: false}
    console.log(`${d.name.padEnd(26)} FAILED: ${err.message} -> using building centre`)
  }
}

if (process.argv.includes('--write')) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  console.log('\nWrote entrances into src/data/destinations.json')
}
