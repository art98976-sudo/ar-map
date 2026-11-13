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
