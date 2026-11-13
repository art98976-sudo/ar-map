// ?debug=align: check that the 3D campus model sits on MazeMap's floor plan.
// - the model, see-through, over MazeMap (home.js turns it on at 50%)
// - a red dot at the model's origin (CAMPUS_ORIGIN, 56.1455, -3.92)
// - a panel with the clicked point in lat/lon and in metres east/north of that origin
//
// Loaded only when the address asks for it. Draws its own map layers (align-*), never MazeMap's.
import {CAMPUS_ORIGIN} from './campus-geo.js'
import {distanceM, toLocal} from '../geo/geo.js'
import {CAMPUS_MODEL} from '../config.js'

const ID = {origin: 'align-origin', click: 'align-click'}
const point = (lng, lat) => ({type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [lng, lat]}})

/** A clicked point, as the panel shows it. Exported for tests. */
export function describePoint({lat, lng}) {
  // In model metres, so a click can be compared with the model's own coordinates.
  const {x, y} = toLocal(CAMPUS_ORIGIN, {lat, lng})
  const k = CAMPUS_MODEL.earthScale
  return {lat, lng, east: x / k, north: y / k, fromOrigin: distanceM(CAMPUS_ORIGIN, {lat, lng})}
}

/**
 * @param map    the Mapbox GL map inside MazeMap
 * @param o.model the campus model (campus-model.js), for the opacity slider
 * @param o.host where to put the panel
 */
export function createAlignDebug(map, {model, host = document.body}) {
  addLayers(map)
  const panel = buildPanel(host)
  const floorText = () => {
    const z = typeof map.getZLevel === 'function' ? map.getZLevel() : null
    panel.floor.textContent = z == null ? '' : `MazeMap floor ${z}`
  }
  floorText()

  const onClick = (event) => {
    const p = describePoint({lat: event.lngLat.lat, lng: event.lngLat.lng})
    map.getSource(ID.click)?.setData(point(p.lng, p.lat))
    panel.latlon.textContent = `${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}`
    panel.metres.textContent =
      `${Math.abs(p.east).toFixed(2)} m ${p.east >= 0 ? 'east' : 'west'}, ` + `${Math.abs(p.north).toFixed(2)} m ${p.north >= 0 ? 'north' : 'south'}`
    panel.model.textContent = `model x ${p.east.toFixed(2)}, z ${(-p.north).toFixed(2)} (Y-up, -Z north) · ${p.fromOrigin.toFixed(1)} m from origin`
  }
  const onZLevel = () => floorText()
  map.on('click', onClick)
  map.on('zlevel', onZLevel)
  panel.opacity.oninput = () => {
    const value = Number(panel.opacity.value)
    panel.opacityLabel.textContent = `${value}%`
    model?.setOpacity(value / 100)
  }

  return {
    destroy() {
      map.off('click', onClick)
      map.off('zlevel', onZLevel)
      panel.root.remove()
      try {
        for (const id of [ID.click, ID.origin]) {
          if (map.getLayer(id)) map.removeLayer(id)
          if (map.getSource(id)) map.removeSource(id)
        }
      } catch {
        // the map is already gone
      }
    },
  }
}

function addLayers(map) {
  map.addSource(ID.origin, {type: 'geojson', data: point(CAMPUS_ORIGIN.lng, CAMPUS_ORIGIN.lat)})
  map.addSource(ID.click, {type: 'geojson', data: {type: 'FeatureCollection', features: []}})
  // On top of everything, the model included.
  map.addLayer({
    id: ID.click,
    type: 'circle',
    source: ID.click,
    paint: {'circle-radius': 5, 'circle-color': '#111827', 'circle-stroke-color': '#facc15', 'circle-stroke-width': 2},
  })
  map.addLayer({
    id: ID.origin,
    type: 'circle',
    source: ID.origin,
    paint: {'circle-radius': 7, 'circle-color': '#dc2626', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2},
  })
}

function buildPanel(host) {
  const root = document.createElement('section')
  root.className = 'align-panel'
  root.setAttribute('aria-label', 'Model alignment check')
  root.innerHTML = `
    <style>
      .align-panel{position:fixed;z-index:40;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 124px);max-width:360px;
        background:#fff;color:#111827;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;font:13px/1.45 system-ui,sans-serif}
      .align-panel h2{font-size:13px;margin:0 0 4px;font-weight:600}
      .align-panel p{margin:2px 0;font-variant-numeric:tabular-nums}
      .align-panel .align-muted{color:#6b7280;font-size:12px}
      .align-panel .align-row{display:flex;gap:8px;align-items:center;margin-top:6px}
      .align-panel input[type=range]{flex:1}
    </style>
    <h2>Alignment check</h2>
    <p class="align-muted"><span style="color:#dc2626">●</span> model origin 56.1455, -3.92 · <span data-align-floor></span></p>
    <p data-align-latlon>Click the map to measure a point.</p>
    <p data-align-metres></p>
    <p class="align-muted" data-align-model></p>
    <div class="align-row">
      <label for="align-opacity">Model</label>
      <input id="align-opacity" type="range" min="0" max="100" step="5" value="50" data-align-opacity>
      <output for="align-opacity" data-align-opacity-label>50%</output>
    </div>`
  host.append(root)
  const q = (sel) => root.querySelector(sel)
  return {
    root,
    floor: q('[data-align-floor]'),
    latlon: q('[data-align-latlon]'),
    metres: q('[data-align-metres]'),
    model: q('[data-align-model]'),
    opacity: q('[data-align-opacity]'),
    opacityLabel: q('[data-align-opacity-label]'),
  }
}
