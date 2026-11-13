// ?debug=scene on the map (Step 1 check): what the scene built from MazeMap holds for the chosen
// route, level by level, with anything missing, and the doors near the route and its stairs and
// lifts drawn on the map.
import {fromLocal} from '../geo/geo.js'
import {html, render} from '../ui/dom.js'
import {sceneSummary} from './scene-data.js'

const DOORS = 'scene-debug-doors'
const LINKS = 'scene-debug-links'

/** The doors within nearM of the route on each level, as GeoJSON points. */
export function doorsNearRoute(scene, nearM = 12) {
  const features = []
  for (const level of scene.levels) {
    const pts = scene.route3d.filter((p) => p.z === level)
    const seen = new Set()
    for (const p of pts) {
      for (const d of scene.doorsNear(level, p, nearM)) {
        const key = `${level}:${d.centre.x.toFixed(2)},${d.centre.y.toFixed(2)}`
        if (seen.has(key)) continue
        seen.add(key)
        const {lat, lng} = fromLocal(scene.origin, d.centre)
        features.push({type: 'Feature', properties: {level, width: Number(d.width.toFixed(2))}, geometry: {type: 'Point', coordinates: [lng, lat]}})
      }
    }
  }
  return {type: 'FeatureCollection', features}
}

export function showSceneReport(host, map, {name, scene, error}) {
  let panel = host.querySelector('[data-scene-debug]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'walls-debug'
    panel.dataset.sceneDebug = ''
    panel.setAttribute('aria-label', 'Navigation scene check')
    host.append(panel)
  }
  if (error || !scene) {
    render(panel, html`<h2>Scene: ${name}</h2><p>${error ?? 'Loading…'}</p>`)
    return panel
  }
  const doors = doorsNearRoute(scene)
  render(
    panel,
    html`<h2>Scene: ${name}</h2>
      <ul>${sceneSummary(scene).map((row) => html`<li>${row}</li>`)}</ul>
      <p>${doors.features.length} doors within 12 m of the route (green dots)</p>
      ${scene.problems.length
        ? html`<h3>Missing from MazeMap</h3><ol>${scene.problems.map((p) => html`<li>${p.text}</li>`)}</ol>`
        : html`<p>Nothing missing: walls, doors, stairs and lifts found for every level used.</p>`}`,
  )
  if (map) {
    const links = {
      type: 'FeatureCollection',
      features: scene.links.flatMap((l) =>
        [l.bottom, l.top].map((p) => {
          const {lat, lng} = fromLocal(scene.origin, p)
          return {type: 'Feature', properties: {kind: l.kind}, geometry: {type: 'Point', coordinates: [lng, lat]}}
        }),
      ),
    }
    const draw = () => {
      for (const [id, data, color, radius] of [[DOORS, doors, '#16a34a', 4], [LINKS, links, '#7c3aed', 7]]) {
        if (map.getSource(id)) map.getSource(id).setData(data)
        else {
          map.addSource(id, {type: 'geojson', data})
          map.addLayer({id, type: 'circle', source: id, paint: {'circle-radius': radius, 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5}})
        }
      }
    }
    // The map may still be loading its style (or an indoor floor): draw once it has settled.
    if (map.isStyleLoaded()) draw()
    else map.once('idle', draw)
  }
  return panel
}

const RAW = 'route-debug-raw'
const REPAIRS = 'route-debug-repairs'

/** ?debug=route (Step 2): MazeMap's raw route (grey, dashed) under the fitted one, every repair listed. */
export function showRouteReport(host, map, {name, route}) {
  let panel = host.querySelector('[data-route-debug]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'walls-debug'
    panel.dataset.routeDebug = ''
    panel.setAttribute('aria-label', 'Route fit check')
    host.append(panel)
  }
  const fit = route?.fitted
  if (!fit) {
    render(panel, html`<h2>Route: ${name}</h2><p>${route ? 'Not a MazeMap route: nothing to fit.' : 'Planning…'}</p>`)
    return panel
  }
  const rawM = fit.raw.reduce((m, p, i) => (i ? m + Math.hypot((p.lat - fit.raw[i - 1].lat) * 111320, (p.lng - fit.raw[i - 1].lng) * 111320 * Math.cos((p.lat * Math.PI) / 180)) : 0), 0)
  render(
    panel,
    html`<h2>Route: ${name}</h2>
      <ul>
        <li>MazeMap: ${Math.round(rawM)} m (grey dashes). Fitted: ${Math.round(fit.lengthM)} m (green)</li>
        <li>Doors passed at their centre: ${fit.doors}</li>
        <li>Start kink removed: ${fit.startSavedM.toFixed(1)} m</li>
        <li>Floors loaded: ${fit.sceneLoaded ? 'yes' : 'no (fitted outdoors only)'}</li>
      </ul>
      ${fit.repairs.length
        ? html`<h3>Repairs</h3><ol>${fit.repairs.map((r) => html`<li>Level ${r.level}: MazeMap's line went through a wall. ${r.fixed ? (r.door ? `Now through the door (${r.door.width.toFixed(2)} m)` : `Moved ${Math.abs(r.side).toFixed(1)} m sideways`) : 'Could not repair'}</li>`)}</ol>`
        : html`<p>No repairs: MazeMap's line never went through a wall.</p>`}`,
  )
  if (map) {
    const line = {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: fit.raw.map((p) => [p.lng, p.lat])}}
    const dots = {type: 'FeatureCollection', features: fit.repairs.map((r) => ({type: 'Feature', properties: {fixed: r.fixed}, geometry: {type: 'Point', coordinates: [r.lng, r.lat]}}))}
    const draw = () => {
      if (map.getSource(RAW)) map.getSource(RAW).setData(line)
      else {
        map.addSource(RAW, {type: 'geojson', data: line})
        map.addLayer({id: RAW, type: 'line', source: RAW, paint: {'line-color': '#6b7280', 'line-width': 3, 'line-dasharray': [2, 2]}})
      }
      if (map.getSource(REPAIRS)) map.getSource(REPAIRS).setData(dots)
      else {
        map.addSource(REPAIRS, {type: 'geojson', data: dots})
        map.addLayer({id: REPAIRS, type: 'circle', source: REPAIRS, paint: {'circle-radius': 7, 'circle-color': ['case', ['get', 'fixed'], '#f59e0b', '#dc2626'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2}})
      }
    }
    if (map.isStyleLoaded()) draw()
    else map.once('idle', draw)
  }
  return panel
}
