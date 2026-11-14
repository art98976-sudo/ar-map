// Loads the University's MazeMap campus map (campus 2058) on demand.
// The MazeMap script is ~1 MB, so it downloads only when a map is first shown.
import {HOME_MAP, MAZEMAP} from '../config.js'
import {handleMissingImages} from './map-icons.js'

let ready = null

class MapLoadError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MapLoadError'
    this.code = code
  }
}

/** Resolve with window.Mazemap once the library and its stylesheet have loaded. */
export function loadMazeMap() {
  if (window.Mazemap?.Map) return Promise.resolve(window.Mazemap)
  if (ready) return ready

  ready = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-mazemap]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${MAZEMAP.scriptBase}mazemap.min.css`
      css.dataset.mazemap = ''
      document.head.appendChild(css)
    }
    const script = document.createElement('script')
    script.src = `${MAZEMAP.scriptBase}mazemap.min.js`
    script.async = true
    const timer = setTimeout(() => {
      reject(new MapLoadError('timeout', 'The campus map is taking too long to load.'))
    }, MAZEMAP.loadTimeoutMs)
    script.onload = () => {
      clearTimeout(timer)
      if (window.Mazemap?.Map) {
        useModernLights(window.Mazemap)
        resolve(window.Mazemap)
      } else reject(new MapLoadError('broken', 'The campus map loaded but could not start.'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      script.remove()
      reject(new MapLoadError(navigator.onLine ? 'network' : 'offline', 'The campus map could not be downloaded.'))
    }
    document.head.appendChild(script)
  }).catch((err) => {
    ready = null // allow "Try again"
    throw err
  })
  return ready
}

/**
 * MazeMap 2.2.6 (the newest release) calls the deprecated `map.setLight()` itself while
 * loading its style, which logs a warning. Route that call to `map.setLights()` with the
 * 'flat' light type, as the map engine recommends. If anything about it fails, fall back
 * to the original method so the map still draws.
 */
function useModernLights(Mazemap) {
  const proto = Mazemap?.Map?.prototype
  if (!proto || typeof proto.setLights !== 'function' || proto.setLight?.__welcomeAR) return
  const legacy = proto.setLight
  const modern = function setLight(light, options) {
    try {
      return this.setLights([{id: 'flat', type: 'flat', properties: light || {}}], options)
    } catch (err) {
      console.warn('[map] setLights failed, using setLight', err)
      return legacy.call(this, light, options)
    }
  }
  modern.__welcomeAR = true
  proto.setLight = modern
}

/**
 * The home map's look (7.3): softer greens and water, and building names moved below their
 * point so a pin never sits on top of one. A layer or property this style lacks is skipped.
 */
export function softenBaseMap(map) {
  for (const [layer, property, value] of HOME_MAP.soft) {
    try {
      if (map.getLayer(layer)) map.setPaintProperty(layer, property, value)
    } catch {
      // not in this style
    }
  }
  try {
    // The campus name is a large label at the campus centre: at campus zoom it runs off the
    // screen edge. Show it only zoomed out, where it fits.
    if (map.getLayer('mm-campus-label')) map.setLayerZoomRange('mm-campus-label', 0, HOME_MAP.campusLabelMaxZoom)
  } catch {
    // not in this style
  }
  try {
    if (map.getLayer('mm-building-label')) {
      map.setLayoutProperty('mm-building-label', 'text-anchor', 'top')
      map.setLayoutProperty('mm-building-label', 'text-offset', [0, HOME_MAP.labelOffsetEm])
    }
  } catch {
    // not in this style
  }
}

/**
 * Which MazeMap place labels show: everything from indoor zoom up; below it only outdoor places
 * (car parks, cafés), never a stairs or lift icon or a room label.
 */
export function indoorLabelFilter({indoorZoom = HOME_MAP.indoorZoom, outdoorFloorId = HOME_MAP.outdoorFloorId, stairLiftIcons = HOME_MAP.stairLiftIcons} = {}) {
  return [
    'any',
    ['>=', ['zoom'], indoorZoom],
    ['all', ['==', ['get', 'floorId'], outdoorFloorId], ['match', ['coalesce', ['get', 'icon'], -1], stairLiftIcons, false, true]],
  ]
}

/** The home map only: hide stairs and lift icons and room labels until the floor plan can be read. */
export function quietIndoorLabels(map) {
  try {
    if (map.getLayer('mm-poi-label')) map.setFilter('mm-poi-label', indoorLabelFilter())
  } catch (err) {
    console.warn('[map] could not quieten the indoor labels', err?.message)
  }
}

/**
 * Wait until the map's style can take sources and layers: adding one earlier throws "Style is
 * not done loading". Resolves true once the style is ready, or false after `timeoutMs` (a map
 * that never loads must not hold the caller for ever).
 */
export function whenStyleLoaded(map, {timeoutMs = MAZEMAP.loadTimeoutMs} = {}) {
  if (map.isStyleLoaded()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (loaded) => {
      clearTimeout(timer)
      map.off('load', onReady)
      map.off('idle', onReady)
      resolve(loaded)
    }
    const onReady = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    map.on('load', onReady)
    map.on('idle', onReady)
  })
}

/**
 * Plan a route only once the map's style has loaded, so the route line is never added to a
 * style that is still loading. With no map yet (its script is still downloading) the plan runs
 * at once: the screen draws the line when the map is ready.
 */
export async function planWhenStyleLoaded(map, plan, options) {
  if (map) await whenStyleLoaded(map, options)
  return plan()
}

/**
 * Create a campus map in `container`.
 * Returns {map, destroy}. `onReady` fires when the map style has loaded.
 */
export function createCampusMap(Mazemap, container, {onReady, onError, controls = true, options = {}} = {}) {
  const map = new Mazemap.Map({
    container,
    campuses: MAZEMAP.campusId,
    center: MAZEMAP.center,
    zoom: MAZEMAP.zoom,
    zLevel: 1,
    // MazeMap adds its own floor switcher by default; we add one styled control below.
    zLevelControl: false,
    scrollZoom: true,
    doubleClickZoom: true,
    touchZoomRotate: true,
    ...options,
  })
  // Every place type gets an icon, and no "image could not be loaded" warnings (map-icons.js).
  handleMissingImages(map)

  const instance = {
    map,
    floorBar: null,
    geolocate: null,
    destroy: () => {
      try {
        map.remove()
      } catch {
        // already removed
      }
    },
  }

  map.on('load', () => {
    try {
      if (!controls) {
        onReady?.(map)
        return
      }
      softenBaseMap(map) // the home map only: the AR map keeps strong colours for sunlight
      // Floor switcher, shown when an indoor building is in view. The screen places and styles it.
      instance.floorBar = new Mazemap.ZLevelBarControl({className: 'mm-floor-bar', autoUpdate: true, maxHeight: 220})
      map.addControl(instance.floorBar, 'bottom-left')
      // "My location": the screen draws its own button and calls geolocate.trigger().
      instance.geolocate = new Mazemap.mapboxgl.GeolocateControl({
        positionOptions: {enableHighAccuracy: true},
        trackUserLocation: true,
        showUserHeading: true,
        fitBoundsOptions: {maxZoom: 17.5}, // close enough to see the paths around you
      })
      map.addControl(instance.geolocate, 'bottom-right')
    } catch (err) {
      console.warn('[map] control setup failed', err)
    }
    onReady?.(map)
  })
  map.on('error', (event) => {
    console.warn('[map] error', event?.error)
    onError?.(event?.error)
  })

  return instance
}
