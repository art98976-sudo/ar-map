// A readable summary of src/data/campus-network.json: counts, the generator's errors and warnings,
// and every automatic check with node ids and coordinates.
//   npm run network:report            print
//   npm run network:report -- --strict  also exit 1 when any check fails
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runChecks} from '../src/network/network-checks.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const net = JSON.parse(readFileSync(join(root, 'src', 'data', 'campus-network.json'), 'utf8'))
const MAX = Number(/--max=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 25)

const count = (list, key) => {
  const m = {}
  for (const x of list) m[key(x)] = (m[key(x)] ?? 0) + 1
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
}
const where = (f) => (Number.isFinite(f.x) ? ` at (${f.x}, ${f.y})${f.z != null ? ` level ${f.z}` : ''}` : '')
const ids = (f) => {
  const list = [...(f.nodeIds ?? []), ...(f.edgeIds ?? []).slice(0, 4)]
  return list.length ? ` [${list.join(', ')}${(f.edgeIds?.length ?? 0) > 4 ? ', …' : ''}]` : ''
}
const out = (s = '') => console.log(s)

out(`Campus network v${net.schemaVersion}, generated ${net.generatedAt}`)
out(`Pilot: ${net.pilot.name}`)
out(`Frame: ${net.frame}`)
out()
out(`Nodes ${net.nodes.length}: ${count(net.nodes, (n) => n.type)}`)
out(`  by level: ${count(net.nodes, (n) => (n.z === 0 ? 'outdoors' : `L${n.z}`))}`)
out(`Edges ${net.edges.length}: ${count(net.edges, (e) => e.type)}`)
out(`  by source: ${count(net.edges, (e) => e.source)}; verified ${net.edges.filter((e) => e.verified).length}; step-free unknown ${net.edges.filter((e) => e.stepFree == null).length}`)
const stairs = net.edges.filter((e) => e.type === 'stairs' || e.type === 'lift')
if (stairs.length) out(`  level changes from: ${count(stairs, (e) => e.levelChangeFrom ?? '?')}`)
out(`Areas: walkable ${net.areas.walkable.length} (${count(net.areas.walkable, (a) => a.kind)}), blocked ${net.areas.blocked.length} (${count(net.areas.blocked, (a) => a.kind)})`)
for (const [id, f] of Object.entries(net.floors)) {
  out(`Floors ${f.name} (${id}): ${Object.entries(f.levels).map(([z, h]) => `L${z} ${h} m`).join(', ')}${f.measured ? '' : '  <- PLACEHOLDERS, not measured'}`)
}
out(`Build: anchors ${JSON.stringify(net.build.anchors)}, ${net.build.routesRequested} MazeMap routes (${net.build.routesFailed} failed), ${net.build.httpRequests} requests, ${net.build.cacheHits} cached; MazeMap flags seen: ${net.build.mazemapFlagsSeen.join(', ') || 'none'}`)

out()
out(`Generator errors: ${net.errors.length}`)
for (const e of net.errors.slice(0, MAX)) out(`  ✗ ${e.kind}: ${e.message}${where(e)}${e.nodeId ? ` [${e.nodeId}]` : ''}`)
if (net.errors.length > MAX) out(`  … ${net.errors.length - MAX} more`)
out(`Generator warnings: ${net.warnings.length} (${count(net.warnings, (w) => w.kind)})`)
for (const w of net.warnings.filter((x) => x.kind !== 'route-failed').slice(0, MAX)) out(`  ! ${w.kind}: ${w.message}${where(w)}`)

out()
const results = runChecks(net)
let failed = 0
for (const r of results) {
  const ok = r.failures.length === 0
  if (!ok) failed += 1
  out(`${ok ? 'PASS' : 'FAIL'}  ${r.title}${ok ? '' : `: ${r.failures.length} failure(s)`}`)
  for (const f of r.failures.slice(0, MAX)) out(`        ${f.message}${where(f)}${ids(f)}`)
  if (r.failures.length > MAX) out(`        … ${r.failures.length - MAX} more (--max=N to show more)`)
  if (r.id === 'pilot-route' && r.route) {
    const nodes = new Map(net.nodes.map((n) => [n.id, n]))
    const entrance = nodes.get(r.route.entranceNodeId)
    out(`        network: ${r.route.lengthM.toFixed(1)} m (start ${r.route.snapM.toFixed(1)} m from the path), enters by ${r.route.entranceNodeId ?? 'none'}${entrance ? ` (${entrance.x}, ${entrance.y}) L${entrance.z}` : ''}`)
    out(`        MazeMap: ${net.pilot.mazemap.lengthM} m, enters by ${net.pilot.mazemap.entranceNodeIds.join(', ') || 'no door node'} ${net.pilot.mazemap.entries.map((p) => `(${p.x}, ${p.y}) L${p.z}`).join(' ')}`)
  }
}
out()
out(`${results.length - failed}/${results.length} checks pass`)
if (failed && process.argv.includes('--strict')) process.exit(1)
