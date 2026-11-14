// Item 1 (round 3): what a walker can see, for describing steps: named paths and roads, named
// buildings and named water, from OpenStreetMap. Run again when campus names change:
//   node tools/build-landmarks.mjs          -> src/data/landmarks-osm.json
// Build time only: the phone loads the file with the trip and asks no one else.
// Data © OpenStreetMap contributors, ODbL (credited on the About screen).
import {writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BBOX = [56.1385, -3.9345, 56.1535, -3.9085] // as the campus footpaths (south, west, north, east)
const query = `[out:json][timeout:60];
(
  way["highway"]["name"](${BBOX.join(',')});
  way["building"]["name"](${BBOX.join(',')});
  way["natural"="water"]["name"](${BBOX.join(',')});
  relation["natural"="water"]["name"](${BBOX.join(',')});
  way["leisure"~"^(pitch|sports_centre|park|garden)$"]["name"](${BBOX.join(',')});
);
(._;>;);
out body;`

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
let osm = null
for (const url of SERVERS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'StirlingWelcomeAR/0.1 (landmark build script)'},
      body: `data=${encodeURIComponent(query)}`,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    osm = await res.json()
    console.log('Overpass:', url)
    break
  } catch (err) {
    console.warn(`${url} failed (${err.message}), trying the next server`)
  }
}
if (!osm) throw new Error('All Overpass servers failed. Try again in a few minutes.')

const nodes = new Map()
for (const el of osm.elements) if (el.type === 'node') nodes.set(el.id, [Number(el.lat.toFixed(6)), Number(el.lon.toFixed(6))])
const ways = new Map()
for (const el of osm.elements) if (el.type === 'way') ways.set(el.id, el)

const pointsOf = (way) => way.nodes.map((id) => nodes.get(id)).filter(Boolean)
const kindOf = (tags) =>
  tags.natural === 'water' ? 'water' : tags.building ? 'building' : tags.leisure ? 'leisure' : ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'track'].includes(tags.highway) ? 'path' : 'road'

const paths = [] // {name, kind: 'path'|'road', pts}
const areas = [] // {name, kind: 'building'|'water'|'leisure', pts (outline)}
for (const way of ways.values()) {
  const tags = way.tags ?? {}
  if (!tags.name) continue
  const kind = kindOf(tags)
  const pts = pointsOf(way)
  if (pts.length < 2) continue
  if (kind === 'path' || kind === 'road') paths.push({name: tags.name, kind, pts})
  else areas.push({name: tags.name, kind, pts})
}
// A water relation (Airthrey Loch may be one): its outer ways joined as one outline.
for (const el of osm.elements) {
  if (el.type !== 'relation' || !el.tags?.name) continue
  const pts = el.members.filter((m) => m.type === 'way' && m.role !== 'inner').flatMap((m) => (ways.get(m.ref) ? pointsOf(ways.get(m.ref)) : []))
  if (pts.length >= 3) areas.push({name: el.tags.name, kind: 'water', pts})
}

// Keep it small for a phone: only what touches the campus walks, outlines simplified to 2 m.
const CORE = [56.1405, -3.932, 56.1525, -3.911] // south, west, north, east
const touchesCore = (pts) => pts.some(([lat, lng]) => lat >= CORE[0] && lat <= CORE[2] && lng >= CORE[1] && lng <= CORE[3])
function simplify(pts, tolM = 2) {
  if (pts.length <= 2) return pts
  const kx = 111320 * Math.cos((pts[0][0] * Math.PI) / 180)
  const xy = pts.map(([lat, lng]) => [lng * kx, lat * 110540])
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let best = -1
    let far = 0
    for (let i = a + 1; i < b; i++) {
      const [x, y] = xy[i]
      const [x1, y1] = xy[a]
      const [x2, y2] = xy[b]
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len
      if (d > far) [far, best] = [d, i]
    }
    if (far > tolM) {
      keep[best] = true
      stack.push([a, best], [best, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}
for (const list of [paths, areas]) {
  const kept = list.filter((x) => touchesCore(x.pts)).map((x) => ({...x, pts: simplify(x.pts)}))
  list.length = 0
  list.push(...kept)
}

paths.sort((a, b) => a.name.localeCompare(b.name))
areas.sort((a, b) => a.name.localeCompare(b.name))
const out = {_source: 'OpenStreetMap contributors (ODbL). Built by tools/build-landmarks.mjs', bbox: BBOX, paths, areas}
writeFileSync(join(root, 'src', 'data', 'landmarks-osm.json'), JSON.stringify(out) + '\n')
console.log(`paths ${paths.length} (${[...new Set(paths.map((p) => p.name))].length} names), areas ${areas.length}`)
console.log('names:', [...new Set([...paths, ...areas].map((x) => `${x.name} [${x.kind}]`))].join('; '))
