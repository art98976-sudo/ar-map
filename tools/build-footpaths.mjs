// Builds the walking networks from OpenStreetMap. Run again whenever paths change:
//   node tools/build-footpaths.mjs          src/data/footpaths.json       campus
//   node tools/build-footpaths.mjs --town   src/data/town-footpaths.json  all of Stirling
// Data © OpenStreetMap contributors, ODbL (credited on the About screen).
import {writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Campus plus a margin: south of Logie to north of Pathfoot, Stirling Court to the castle.
const CAMPUS_BBOX = [56.1385, -3.9345, 56.1535, -3.9085] // south, west, north, east
// Bridge of Allan to the south of the city, the castle to the east of the university.
const TOWN_BBOX = [56.105, -3.975, 56.165, -3.89]
const town = process.argv.includes('--town')
const BBOX = town ? TOWN_BBOX : CAMPUS_BBOX
const WALKABLE =
  'footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|track|cycleway|bridleway' +
  (town ? '|secondary|primary|tertiary_link|secondary_link|primary_link' : '') // town roads have pavements

const query = `[out:json][timeout:${town ? 170 : 60}];
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
const MAIN_ROAD = /^(primary|secondary)(_link)?$/

for (const el of osm.elements) {
  if (el.type !== 'way') continue
  const type = TYPE[el.tags.highway] || (MAIN_ROAD.test(el.tags.highway) ? 'main' : 'road')
  for (let i = 1; i < el.nodes.length; i++) {
    const a = el.nodes[i - 1]
    const b = el.nodes[i]
    if (!nodeById.has(a) || !nodeById.has(b)) continue
    const ia = idx(a)
    const ib = idx(b)
    edges.push([ia, ib, +metres(nodes[ia], nodes[ib]).toFixed(1), type])
  }
}

/** The town file is big: keep only the largest connected network, with no isolated scraps of path. */
function largestNetwork() {
  const adj = nodes.map(() => [])
  for (const [a, b] of edges) {
    adj[a].push(b)
    adj[b].push(a)
  }
  const seen = new Array(nodes.length).fill(false)
  let best = []
  for (let i = 0; i < nodes.length; i++) {
    if (seen[i]) continue
    const group = []
    const stack = [i]
    seen[i] = true
    while (stack.length) {
      const n = stack.pop()
      group.push(n)
      for (const m of adj[n]) {
        if (!seen[m]) {
          seen[m] = true
          stack.push(m)
        }
      }
    }
    if (group.length > best.length) best = group
  }
  const renumber = new Map(best.map((n, i) => [n, i]))
  return {
    nodes: best.map((n) => [+nodes[n][0].toFixed(6), +nodes[n][1].toFixed(6)]),
    edges: edges.filter(([a]) => renumber.has(a)).map(([a, b, m, type]) => [renumber.get(a), renumber.get(b), m, type]),
  }
}

const network = town ? largestNetwork() : {nodes, edges}
const out = {
  _source: 'OpenStreetMap contributors (ODbL). Built by tools/build-footpaths.mjs',
  _built: new Date().toISOString().slice(0, 10),
  bbox: BBOX,
  ...network,
}
const file = town ? 'town-footpaths.json' : 'footpaths.json'
writeFileSync(join(root, 'src', 'data', file), JSON.stringify(out))
console.log(`${file}: ${network.nodes.length} nodes, ${network.edges.length} edges`)
