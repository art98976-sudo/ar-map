// The live map under the camera: MazeMap with the trip route, always turned so the way the user
// faces is up, like a car's sat nav. If MazeMap cannot load, onFailed lets the screen draw its
// plain route picture instead: the arrow and the instructions carry on either way.
import {MAZEMAP} from '../../config.js'
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {stepBearing} from '../../nav/compass-guide.js'

export const COMPASS_MAP = {
  pitch: 45,
  zoom: 18.4,
  zoomExpanded: 17.6,
  maxTurnDegPerS: 90,
  frameMs: 50,
  dotFromTop: 0.72, // the user's dot sits this far down the map
}
const ROUTE = 'trip-route'
const LEG = 'trip-leg'
const GREEN = '#0a8a4a'
const LEG_GREEN = '#37e07f'
const AMBER = '#e09a00'

const line = (coordinates) => ({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}})

/** Where to point the map: heading up, tilted, with the user's dot low in the middle. */
export function mapCamera({user, bearing, height, expanded = false}) {
  // Padding moves the map's centre. Its centre is halfway down what is left below the top padding.
  const top = Math.max(0, (COMPASS_MAP.dotFromTop * 2 - 1) * height)
  return {
    center: [user.lng, user.lat],
    bearing,
    pitch: COMPASS_MAP.pitch,
    zoom: expanded ? COMPASS_MAP.zoomExpanded : COMPASS_MAP.zoom,
    padding: {top, bottom: 0, left: 0, right: 0},
  }
}

/** Two views with the same key look the same: under 10 cm and a tenth of a degree apart. */
export function viewKey({center: [lng, lat], bearing, zoom, padding}) {
  return [lng.toFixed(6), lat.toFixed(6), bearing.toFixed(1), zoom, Math.round(padding.top)].join()
}

function markerElement(className, text = '') {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  return el
}

/**
 * @param host element the map fills
 * @param o.getState () => the trip's mapState(), or null before it is ready
 * @param o.onReady the map has drawn
 * @param o.onFailed MazeMap could not load, or has not drawn in time
 */
export function createCompassMap(host, {getState, onReady, onFailed}) {
  let instance = null
  let mapReady = false
  let stopped = false
  let frame = 0
  let lastAt = 0
  let bearing = null
  let expanded = false
  let drawnVersion = null
  let drawnLeg = null
  let dot = null
  let dest = null
  let turn = null
  let shownTurn = null
  let shownView = null
  let failTimer = 0
  // The host grows and shrinks over a CSS transition: follow it, so the map always fills it.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => instance?.map.resize()) : null
  resize?.observe(host)

  function drawRoute(map, Marker, state) {
    const color = state.approximate ? AMBER : GREEN
    const data = line(state.routeCoords)
    if (map.getSource(ROUTE)) {
      map.getSource(ROUTE).setData(data)
      map.setPaintProperty(ROUTE, 'line-color', color)
    } else {
      map.addSource(ROUTE, {type: 'geojson', data})
      map.addSource(LEG, {type: 'geojson', data: line(state.leg)})
      const layout = {'line-cap': 'round', 'line-join': 'round'}
      map.addLayer({id: ROUTE, type: 'line', source: ROUTE, layout, paint: {'line-color': color, 'line-width': 9, 'line-opacity': 0.9}})
      map.addLayer({id: LEG, type: 'line', source: LEG, layout, paint: {'line-color': state.approximate ? AMBER : LEG_GREEN, 'line-width': 7}})
    }
    dest ??= new Marker({element: markerElement('ar-map__pin')}).setLngLat(state.entrance).addTo(map)
    dest.setLngLat(state.entrance)
    drawnVersion = state.routeVersion
  }

  function paint(map, Marker, dt) {
    const state = getState()
    if (!state) return
    if (drawnVersion !== state.routeVersion) drawRoute(map, Marker, state)
    if (drawnLeg !== state.leg) {
      map.getSource(LEG)?.setData(line(state.leg))
      drawnLeg = state.leg
    }
    dot ??= new Marker({element: markerElement('ar-map__dot')}).setLngLat(state.user).addTo(map)
    dot.setLngLat(state.user)
    if (state.turn) {
      turn ??= new Marker({element: markerElement('ar-map__turn')}).setLngLat(state.turn.at).addTo(map)
      if (shownTurn !== state.turn.number) {
        turn.getElement().textContent = String(state.turn.number)
        turn.setLngLat(state.turn.at)
        shownTurn = state.turn.number
      }
    } else if (turn) {
      turn.remove()
      turn = null
      shownTurn = null
    }
    if (state.headingDeg != null) {
      bearing = bearing == null ? state.headingDeg : stepBearing(bearing, state.headingDeg, dt, COMPASS_MAP.maxTurnDegPerS)
    }
    // A redraw costs battery and starves the camera: only move the map when the view has changed.
    const view = mapCamera({user: state.user, bearing: bearing ?? 0, height: host.clientHeight, expanded})
    const key = viewKey(view)
    if (key !== shownView) {
      shownView = key
      map.jumpTo(view)
    }
  }

  function loop(now) {
    if (stopped) return
    frame = requestAnimationFrame(loop)
    if (!mapReady || now - lastAt < COMPASS_MAP.frameMs) return
    const dt = Math.min(0.25, (now - lastAt) / 1000)
    lastAt = now
    try {
      paint(instance.map, window.Mazemap.mapboxgl.Marker, dt)
    } catch (err) {
      console.warn('[compass-map] paint failed', err)
    }
  }

  loadMazeMap()
    .then((Mazemap) => {
      if (stopped) return
      instance = createCampusMap(Mazemap, host, {
        controls: false,
        options: {interactive: false, zoom: COMPASS_MAP.zoom, pitch: COMPASS_MAP.pitch, fadeDuration: 0},
        onReady: () => {
          mapReady = true
          clearTimeout(failTimer)
          if (!stopped) onReady?.()
        },
        onError: (err) => {
          if (!mapReady) console.warn('[compass-map] map error', err)
        },
      })
      frame = requestAnimationFrame(loop)
      // The script can load and its map tiles still never arrive.
      failTimer = setTimeout(() => {
        if (!stopped && !mapReady) onFailed?.()
      }, MAZEMAP.loadTimeoutMs)
    })
    .catch((err) => {
      console.warn('[compass-map] could not load', err)
      if (!stopped) onFailed?.()
    })

  return {
    get ready() {
      return mapReady
    },
    get bearing() {
      return bearing
    },
    setExpanded(value) {
      expanded = value
    },
    destroy() {
      stopped = true
      clearTimeout(failTimer)
      resize?.disconnect()
      cancelAnimationFrame(frame)
      instance?.destroy()
      instance = null
    },
  }
}
