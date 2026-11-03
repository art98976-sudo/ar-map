// Builds src/data/footpaths.json: the campus walking network from OpenStreetMap.
// Run again whenever paths change:  node tools/build-footpaths.mjs
// Data © OpenStreetMap contributors, ODbL (credited on the About screen).
import {writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Campus plus a margin: south of Logie to north of Pathfoot, Stirling Court to the castle.
const BBOX = [56.1385, -3.9345, 56.1535, -3.9085] // south, west, north, east
const WALKABLE =
  'footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|track|cycleway|bridleway'

const query = `[out:json][timeout:60];
way["highway"~"^(${WALKABLE})$"]["access"!~"^(private|no)$"]["foot"!="no"](${BBOX.join(',')});
(._;>;);
out body;`

// Public Overpass servers are often busy: try each one in turn.
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
let osm = null
for (const url of SERVERS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'StirlingWelcomeAR/0.1 (footpath build script)'},
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

const nodeById = new Map()
for (const el of osm.elements) if (el.type === 'node') nodeById.set(el.id, [el.lat, el.lon])

// Keep only nodes that ways use; index them compactly.
const index = new Map()
const nodes = []
const edges = []
const R = 6371000
const rad = (d) => (d * Math.PI) / 180
function metres(a, b) {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function idx(id) {
  if (!index.has(id)) {
    const p = nodeById.get(id)
    index.set(id, nodes.length)
    nodes.push([+p[0].toFixed(7), +p[1].toFixed(7)])
  }
  return index.get(id)
}
const TYPE = {steps: 'steps', footway: 'path', path: 'path', pedestrian: 'path', cycleway: 'path', bridleway: 'path', track: 'path'}

for (const el of osm.elements) {
  if (el.type !== 'way') continue
  const type = TYPE[el.tags.highway] || 'road'
  for (let i = 1; i < el.nodes.length; i++) {
    const a = el.nodes[i - 1]
    const b = el.nodes[i]
    if (!nodeById.has(a) || !nodeById.has(b)) continue
    const ia = idx(a)
    const ib = idx(b)
    edges.push([ia, ib, +metres(nodes[ia], nodes[ib]).toFixed(1), type])
  }
}

const out = {
  _source: 'OpenStreetMap contributors (ODbL). Built by tools/build-footpaths.mjs',
  _built: new Date().toISOString().slice(0, 10),
  bbox: BBOX,
  nodes,
  edges,
}
writeFileSync(join(root, 'src', 'data', 'footpaths.json'), JSON.stringify(out))
console.log(`footpaths.json: ${nodes.length} nodes, ${edges.length} edges`)
