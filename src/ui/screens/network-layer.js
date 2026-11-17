// The "Network" layer of /#/geometry (?debug only): the generated campus walking network
// (src/data/campus-network.json) drawn over the MazeMap map, coloured by type, one floor at a
// time, with every failed automatic check (network-checks.js) and generator error in red.
import {fromLocal} from '../../geo/geo.js'
import {failedIds, runChecks} from '../../network/network-checks.js'

export const EDGE_COLOURS = {outdoor: '#16834b', corridor: '#2563eb', door: '#ea580c', stairs: '#b7791f', lift: '#7c3aed'}
export const NODE_COLOURS = {path: '#64748b', door: '#ea580c', entrance: '#9a3412', stairs: '#b7791f', lift: '#7c3aed', room: '#0d9488'}
export const ERROR_COLOUR = '#dc2626'

const lngLat = (origin, p) => {
  const g = fromLocal(origin, p)
  return [g.lng, g.lat]
}

/** Does something on level a show on floor view z? Outdoors (0) shows on every floor. */
const onView = (a, z) => a === z || a === 0

/**
 * The network for one floor view as GeoJSON: {edges, nodes, errors, mazemap}.
 * failed: {nodes: Set, edges: Set} from failedIds(); messages: from checkMessages().
 */
export function networkGeoJSON(net, z, {failed = {nodes: new Set(), edges: new Set()}, messages = new Map()} = {}) {
  const origin = net.origin
  const byId = new Map(net.nodes.map((n) => [n.id, n]))
  const edges = []
  for (const e of net.edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    const vertical = a.z !== b.z && e.type !== 'door'
    // A level change shows on both its floors; a door join on the door's floor.
    const show = vertical ? a.z === z || b.z === z : e.type === 'door' ? (a.z || b.z) === z : onView(a.z, z)
    if (!show) continue
    edges.push({
      type: 'Feature',
      geometry: {type: 'LineString', coordinates: [lngLat(origin, a), lngLat(origin, b)]},
      properties: {id: e.id, kind: e.type, source: e.source, vertical, error: failed.edges.has(e.id), info: [`${e.id} ${e.type} (${e.source}) ${e.lengthM} m`, ...(messages.get(e.id) ?? [])].join('\n')},
    })
  }
  const nodes = []
  for (const n of net.nodes) {
    if (!onView(n.z, z)) continue
    if (n.z === 0 && n.type === 'path' && !failed.nodes.has(n.id)) continue // keep outdoors readable
    nodes.push({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: lngLat(origin, n)},
      properties: {id: n.id, kind: n.type, error: failed.nodes.has(n.id), info: [`${n.id} ${n.type}${n.room ? ` ${n.room.name}` : ''} level ${n.z} (${n.x}, ${n.y})`, ...(messages.get(n.id) ?? [])].join('\n')},
    })
  }
  const errors = []
  for (const e of net.errors ?? []) {
    if (!Number.isFinite(e.x) || !onView(e.z ?? 0, z)) continue
    errors.push({type: 'Feature', geometry: {type: 'Point', coordinates: lngLat(origin, e)}, properties: {info: `${e.kind}: ${e.message}`}})
  }
  for (const [text, f] of messages.points ?? []) {
    if (Number.isFinite(f.x) && onView(f.z ?? 0, z)) errors.push({type: 'Feature', geometry: {type: 'Point', coordinates: lngLat(origin, f)}, properties: {info: text}})
  }
  const pilotPts = (net.pilot?.mazemap?.points ?? []).filter(([, , pz]) => onView(pz, z))
  const fc = (features) => ({type: 'FeatureCollection', features})
  const mazemap = {type: 'Feature', geometry: {type: 'LineString', coordinates: pilotPts.map(([x, y]) => lngLat(origin, {x, y}))}, properties: {}}
  return {edges: fc(edges), nodes: fc(nodes), errors: fc(errors), mazemap: fc(pilotPts.length > 1 ? [mazemap] : [])}
}

/** Messages per node / edge id from check results, plus every located failure as a point. */
export function checkMessages(results) {
  const messages = new Map()
  messages.points = []
  for (const r of results) {
    for (const f of r.failures) {
      for (const id of [...(f.nodeIds ?? []), ...(f.edgeIds ?? [])]) {
        if (!messages.has(id)) messages.set(id, [])
        messages.get(id).push(f.message)
      }
      if (Number.isFinite(f.x)) messages.points.push([`${r.title}: ${f.message}`, f])
    }
  }
  return messages
}

const match = (prop, colours, fallback) => ['match', ['get', prop], ...Object.entries(colours).flat(), fallback]

/**
 * Draw the network into `host`: a MazeMap map, a floor switcher, a legend and the check summary.
 * loadMap / createMap: src/map/mazemap.js (passed in, so this module stays light). Returns cleanup.
 */
export function mountNetworkLayer(host, {loadMap, createMap, loadNetwork = () => import('../../data/campus-network.json').then((m) => m.default)}) {
  let instance = null
  let stopped = false
  host.innerHTML = '<p class="geometry-editor__status">Loading the network and the campus map…</p>'

  Promise.all([loadNetwork(), loadMap()]).then(([net, Mazemap]) => {
    if (stopped) return
    const results = runChecks(net)
    const failed = failedIds(results)
    const messages = checkMessages(results)
    const levels = [...new Set(Object.values(net.floors).flatMap((f) => Object.keys(f.levels).map(Number)))].sort((a, b) => a - b)
    let z = levels.includes(1) ? 1 : levels[0]

    host.innerHTML = ''
    const bar = document.createElement('div')
    bar.className = 'geometry-editor__toolbar'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', 'Floor')
    const summary = document.createElement('ul')
    summary.className = 'geometry-editor__checks'
    for (const r of results) {
      const li = document.createElement('li')
      li.textContent = `${r.failures.length ? '✗' : '✓'} ${r.title}${r.failures.length ? ` (${r.failures.length})` : ''}`
      li.dataset.ok = String(!r.failures.length)
      summary.append(li)
    }
    const info = document.createElement('p')
    info.className = 'geometry-editor__status'
    info.setAttribute('role', 'status')
    info.textContent = `${net.nodes.length} nodes, ${net.edges.length} edges, ${net.errors.length} generator errors. Generated ${net.generatedAt}. Click a node, an edge or a red ring for details.`
    const mapBox = document.createElement('div')
    mapBox.className = 'geometry-editor__network-map'
    const legend = document.createElement('p')
    legend.className = 'geometry-editor__legend'
    legend.innerHTML = [
      ...Object.entries(EDGE_COLOURS).map(([k, c]) => `<span style="color:${c}">━</span> ${k}`),
      ...Object.entries(NODE_COLOURS).map(([k, c]) => `<span style="color:${c}">●</span> ${k}`),
      `<span style="color:${ERROR_COLOUR}">◯</span> failed check or generator error`,
      '<span>┅</span> MazeMap pilot route',
    ].join(' · ')
    host.append(bar, summary, info, mapBox, legend)

    instance = createMap(Mazemap, mapBox, {
      controls: false,
      options: {zLevel: z, zoom: 17.2, center: {lng: -3.9205, lat: 56.1448}},
      onReady: (map) => {
        if (stopped) return
        const data = () => networkGeoJSON(net, z, {failed, messages})
        for (const [name, fc] of Object.entries(data())) map.addSource(`net-${name}`, {type: 'geojson', data: fc})
        map.addLayer({id: 'net-mazemap', type: 'line', source: 'net-mazemap', paint: {'line-color': '#111', 'line-width': 2, 'line-dasharray': [1, 2], 'line-opacity': 0.6}})
        map.addLayer({id: 'net-edges', type: 'line', source: 'net-edges', paint: {'line-color': ['case', ['get', 'error'], ERROR_COLOUR, match('kind', EDGE_COLOURS, '#000')], 'line-width': ['case', ['get', 'error'], 4, ['get', 'vertical'], 5, 2.5]}})
        map.addLayer({id: 'net-nodes', type: 'circle', source: 'net-nodes', paint: {'circle-color': ['case', ['get', 'error'], ERROR_COLOUR, match('kind', NODE_COLOURS, '#000')], 'circle-radius': ['match', ['get', 'kind'], 'path', 2, 5], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1}})
        map.addLayer({id: 'net-errors', type: 'circle', source: 'net-errors', paint: {'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 9, 'circle-stroke-color': ERROR_COLOUR, 'circle-stroke-width': 2.5}})
        const setFloor = (next) => {
          z = next
          try {
            map.zLevel = z
          } catch {
            // the floor tiles stay; the network still switches
          }
          for (const [name, fc] of Object.entries(data())) map.getSource(`net-${name}`)?.setData(fc)
          for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.level) === z))
        }
        for (const level of levels) {
          const b = document.createElement('button')
          b.type = 'button'
          b.dataset.level = String(level)
          b.textContent = `Level ${level}`
          b.setAttribute('aria-pressed', String(level === z))
          b.addEventListener('click', () => setFloor(level))
          bar.append(b)
        }
        map.on('click', (event) => {
          const hit = map.queryRenderedFeatures(event.point, {layers: ['net-errors', 'net-nodes', 'net-edges']})[0]
          info.textContent = hit ? hit.properties.info : 'Nothing here. Click a node, an edge or a red ring.'
        })
      },
      onError: () => {
        info.textContent = 'The campus map could not be loaded.'
      },
    })
  }).catch((error) => {
    if (!stopped) host.textContent = `The network could not be loaded: ${error?.message ?? error}`
  })

  return () => {
    stopped = true
    instance?.destroy()
  }
}
