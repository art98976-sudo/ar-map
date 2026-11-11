// ?simulate=1 test mode for the AR arrow, for a laptop: plans the route to the chosen place, draws
// it on the map, walks a fake user along it at walking speed, and draws the AR arrow's direction at
// the fake user (from arrow-direction.js, exactly as the AR screen works it out). A slider pushes the
// fake user 0-20 m off the route, to see the arrow lead back on to it.
//
// Loaded only when the address asks for it. Draws its own map layers (sim-*), never MazeMap's.
import {fromLocal, pointAt, polylineLength, toLocal} from '../geo/geo.js'
import {LOOK_AHEAD_M, arrowDirection, routeFromPoints} from '../route/arrow-direction.js'
import {planRoute} from '../route/route.js'
import {COLOURS, ROUTING} from '../config.js'

/** A fixed start on a campus path, by the loch walkway, when no start was chosen. */
export const SIM_START = {lat: 56.14525, lng: -3.9201}
export const SIM_MAX_OFFSET_M = 20
const ARROW_M = 10 // drawn length of the arrow on the map
const ID = {route: 'sim-route', aim: 'sim-aim', arrow: 'sim-arrow', arrowEdge: 'sim-arrow-edge', target: 'sim-target', user: 'sim-user'}

/**
 * Where the fake user is: distance s along the route (local metres), pushed offsetM to the right
 * of the way the route runs there.
 */
export function fakeUserAt(local, s, offsetM) {
  const total = polylineLength(local)
  const a = pointAt(local, Math.max(0, s - 0.5))
  const b = pointAt(local, Math.min(total, s + 0.5))
  const p = pointAt(local, s)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  // Right of the direction (dx, dy) is (dy, -dx): east of a route going north.
  return {x: p.x + (offsetM * (b.y - a.y)) / len, y: p.y - (offsetM * (b.x - a.x)) / len}
}

/** An arrow outline (GeoJSON ring of [lng, lat]) at the user, pointing along bearingDeg. */
export function arrowRing(user, bearingDeg, lengthM = ARROW_M) {
  const r = (bearingDeg * Math.PI) / 180
  const fwd = {x: Math.sin(r), y: Math.cos(r)}
  const side = {x: fwd.y, y: -fwd.x}
  const shaft = lengthM * 0.62
  const at = (along, across) => {
    const p = fromLocal(user, {x: fwd.x * along + side.x * across, y: fwd.y * along + side.y * across})
    return [p.lng, p.lat]
  }
  const w = lengthM * 0.12
  const head = lengthM * 0.3
  const ring = [at(0, -w), at(shaft, -w), at(shaft, -head), at(lengthM, 0), at(shaft, head), at(shaft, w), at(0, w)]
  return [...ring, ring[0]]
}

const featureOf = (geometry) => ({type: 'Feature', properties: {}, geometry})
const pointOf = (p) => featureOf({type: 'Point', coordinates: [p.lng ?? p.lon, p.lat]})

/**
 * Start the simulation on a map. Returns {destroy} at once; the route is planned in the background.
 * @param map   the Mapbox GL map inside MazeMap
 * @param o.from {lat, lng} where the walk starts
 * @param o.dest the destination (as on the place card)
 * @param o.host where to put the control panel
 */
export function createSimulator(map, {from = SIM_START, dest, host = document.body, plan = planRoute}) {
  let destroyed = false
  let raf = 0
  let unhook = () => {}
  const panel = buildPanel(host)
  panel.status.textContent = 'Planning the route…'

  plan(from, dest)
    .then((route) => {
      if (destroyed) return
      if (route.status !== 'ok') {
        panel.status.textContent = 'No walking route from the start to this place.'
        return
      }
      run(route)
    })
    .catch((err) => {
      if (!destroyed) panel.status.textContent = `Could not plan the route (${err?.message ?? err}).`
    })

  function run(route) {
    const origin = route.points[0]
    const local = route.points.map((p) => toLocal(origin, p))
    const total = polylineLength(local)
    const arrowRoute = routeFromPoints(route.points)
    let s = 0
    let offset = 0
    let playing = true
    let speed = 1
    let along = 0 // the arrow's last distanceAlong: the walk starts at the route's start, as in AR
    let last = null
    let dirty = true

    addLayers(map, route.points)
    const coords = route.points.map((p) => [p.lng, p.lat])
    const bounds = coords.reduce((b, c) => b.extend(c), new window.Mazemap.mapboxgl.LngLatBounds(coords[0], coords[0]))
    // The map between the panel above and the place card below.
    const padding = () => {
      const view = map.getContainer().getBoundingClientRect()
      const top = Math.max(60, panel.root.getBoundingClientRect().bottom - view.top + 24)
      const cardTop = host.querySelector('[data-card]:not([hidden])')?.getBoundingClientRect().top ?? view.bottom
      const bottom = Math.max(40, view.bottom - cardTop + 24)
      return view.height - top - bottom > 120 ? {top, bottom, left: 40, right: 40} : {top: 40, bottom: 40, left: 40, right: 40}
    }
    // Follow the fake user close up, so the arrow is big enough to read. Dragging the map stops it.
    let follow = true
    let zoomed = false
    const stopFollowing = (event) => {
      if (!event.originalEvent) return // our own camera moves
      follow = false
      paintButtons()
    }
    map.on('dragstart', stopFollowing)
    unhook = () => map.off('dragstart', stopFollowing)
    panel.follow.onclick = () => {
      follow = !follow
      if (follow) zoomed = false
      dirty = true
      paintButtons()
    }
    panel.overview.onclick = () => {
      follow = false
      paintButtons()
      map.fitBounds(bounds, {padding: padding(), maxZoom: 18.5})
    }

    panel.status.textContent = `${route.source === 'mazemap' ? 'MazeMap' : route.source} route, ${Math.round(total)} m`
    panel.play.onclick = () => {
      if (s >= total) restart()
      playing = !playing
      paintButtons()
    }
    panel.restart.onclick = () => {
      restart()
      playing = true
      paintButtons()
    }
    panel.speed.onclick = () => {
      speed = speed === 1 ? 4 : 1
      paintButtons()
    }
    panel.offset.oninput = () => {
      offset = Number(panel.offset.value)
      panel.offsetLabel.textContent = `${offset} m`
      dirty = true
    }

    function restart() {
      s = 0
      along = 0
      dirty = true
    }

    function paintButtons() {
      panel.play.textContent = playing ? 'Pause' : s >= total ? 'Replay' : 'Play'
      panel.speed.textContent = speed === 1 ? 'Walking speed' : '4× speed'
      panel.speed.setAttribute('aria-pressed', String(speed !== 1))
      panel.follow.setAttribute('aria-pressed', String(follow))
    }
    paintButtons()

    function frame(time) {
      if (destroyed) return
      const dt = last == null ? 0 : Math.min(0.1, (time - last) / 1000)
      last = time
      if (playing) {
        s = Math.min(total, s + ROUTING.walkSpeedMps * speed * dt)
        dirty = true
        if (s >= total) {
          playing = false
          paintButtons()
        }
      }
      if (dirty) draw()
      raf = requestAnimationFrame(frame)
    }

    function draw() {
      dirty = false
      const user = fromLocal(origin, fakeUserAt(local, s, offset))
      const dir = arrowDirection(arrowRoute, user, along)
      if (!dir) return
      along = dir.progress.distanceAlong
      setData(map, ID.user, pointOf(user))
      setData(map, ID.target, pointOf(dir.target))
      setData(map, ID.aim, featureOf({type: 'LineString', coordinates: [[user.lng, user.lat], [dir.target.lon, dir.target.lat]]}))
      setData(map, ID.arrow, featureOf({type: 'Polygon', coordinates: [arrowRing(user, dir.bearingDeg)]}))
      if (follow) {
        map.jumpTo({center: [user.lng, user.lat], padding: padding(), ...(zoomed ? {} : {zoom: 18.6})})
        zoomed = true
      }
      const p = dir.progress
      panel.readout.textContent =
        `Walked ${Math.round(s)} of ${Math.round(total)} m · arrow ${Math.round(dir.bearingDeg)}° from north\n` +
        `On the route at ${p.distanceAlong.toFixed(1)} m (segment ${p.segmentIndex}) · ${p.distanceFromRoute.toFixed(1)} m off it`
    }

    raf = requestAnimationFrame(frame)
  }

  return {
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      unhook()
      panel.root.remove()
      removeLayers(map)
    },
  }
}

function setData(map, id, data) {
  map.getSource(id)?.setData(data)
}

function addLayers(map, points) {
  removeLayers(map)
  const empty = featureOf({type: 'Point', coordinates: [points[0].lng, points[0].lat]})
  map.addSource(ID.route, {type: 'geojson', data: featureOf({type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat])})})
  for (const id of [ID.aim, ID.arrow, ID.target, ID.user]) map.addSource(id, {type: 'geojson', data: empty})
  map.addLayer({
    id: ID.route,
    type: 'line',
    source: ID.route,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.75},
  })
  map.addLayer({id: ID.aim, type: 'line', source: ID.aim, paint: {'line-color': '#f97316', 'line-width': 2, 'line-dasharray': [2, 2]}})
  map.addLayer({id: ID.arrow, type: 'fill', source: ID.arrow, paint: {'fill-color': COLOURS.arrowGreen, 'fill-opacity': 0.8}})
  map.addLayer({id: ID.arrowEdge, type: 'line', source: ID.arrow, paint: {'line-color': '#064e3b', 'line-width': 1.5}})
  map.addLayer({
    id: ID.target,
    type: 'circle',
    source: ID.target,
    paint: {'circle-radius': 5, 'circle-color': '#f97316', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2},
  })
  map.addLayer({
    id: ID.user,
    type: 'circle',
    source: ID.user,
    paint: {'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3},
  })
}

function removeLayers(map) {
  try {
    for (const id of [ID.user, ID.target, ID.arrowEdge, ID.arrow, ID.aim, ID.route]) if (map.getLayer(id)) map.removeLayer(id)
    for (const id of [ID.user, ID.target, ID.arrow, ID.aim, ID.route]) if (map.getSource(id)) map.removeSource(id)
  } catch {
    // the map is already gone
  }
}

function buildPanel(host) {
  const root = document.createElement('section')
  root.className = 'sim-panel'
  root.setAttribute('aria-label', 'Arrow test mode')
  root.innerHTML = `
    <style>
      .sim-panel{position:fixed;z-index:40;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 124px);max-width:380px;
        background:#fff;color:#111827;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;font:13px/1.4 system-ui,sans-serif}
      .sim-panel h2{font-size:13px;margin:0 0 6px;font-weight:600}
      .sim-panel .sim-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
      .sim-panel button{font:inherit;border:1px solid #d1d5db;border-radius:999px;background:#f9fafb;padding:4px 12px;cursor:pointer;min-height:32px}
      .sim-panel button[aria-pressed="true"]{background:#2563eb;color:#fff;border-color:#2563eb}
      .sim-panel input[type=range]{flex:1;min-width:120px}
      .sim-panel output,.sim-panel .sim-readout{font-variant-numeric:tabular-nums}
      .sim-panel .sim-readout{white-space:pre-line;color:#374151;margin:0}
      .sim-panel .sim-key{color:#6b7280;margin:6px 0 0;font-size:12px}
      .sim-panel .sim-key b{font-weight:600}
    </style>
    <h2>Arrow test: simulated walk</h2>
    <p class="sim-readout" data-sim-status role="status"></p>
    <div class="sim-row">
      <button type="button" data-sim-play>Pause</button>
      <button type="button" data-sim-restart>Restart</button>
      <button type="button" data-sim-speed aria-pressed="false">Walking speed</button>
      <button type="button" data-sim-follow aria-pressed="true">Follow</button>
      <button type="button" data-sim-overview>Whole route</button>
    </div>
    <div class="sim-row">
      <label for="sim-offset">Off the route</label>
      <input id="sim-offset" type="range" min="0" max="${SIM_MAX_OFFSET_M}" step="1" value="0" data-sim-offset>
      <output for="sim-offset" data-sim-offset-label>0 m</output>
    </div>
    <p class="sim-readout" data-sim-readout></p>
    <p class="sim-key"><b style="color:#2563eb">●</b> fake user · <b style="color:${COLOURS.arrowGreen}">➤</b> AR arrow ·
      <b style="color:#f97316">●</b> point ${LOOK_AHEAD_M} m ahead on the route</p>`
  host.append(root)
  const q = (sel) => root.querySelector(sel)
  return {
    root,
    status: q('[data-sim-status]'),
    play: q('[data-sim-play]'),
    restart: q('[data-sim-restart]'),
    speed: q('[data-sim-speed]'),
    follow: q('[data-sim-follow]'),
    overview: q('[data-sim-overview]'),
    offset: q('[data-sim-offset]'),
    offsetLabel: q('[data-sim-offset-label]'),
    readout: q('[data-sim-readout]'),
  }
}
