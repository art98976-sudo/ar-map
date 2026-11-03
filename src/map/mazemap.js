// Loads the University's MazeMap campus map (campus 2058) on demand.
// The MazeMap script is ~1 MB, so it downloads only when a map is first shown.
import {MAZEMAP} from '../config.js'

let ready = null

export class MapLoadError extends Error {
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
      if (window.Mazemap?.Map) resolve(window.Mazemap)
      else reject(new MapLoadError('broken', 'The campus map loaded but could not start.'))
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
 * Create a campus map in `container`.
 * Returns {map, destroy}. `onReady` fires when the map style has loaded.
 */
export function createCampusMap(Mazemap, container, {onReady, onError} = {}) {
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
  })

  map.on('load', () => {
    try {
      // Floor switcher, shown when an indoor building is in view.
      map.addControl(
        new Mazemap.ZLevelBarControl({className: 'mm-floor-bar', autoUpdate: true, maxHeight: 260}),
        'bottom-left',
      )
      map.addControl(new Mazemap.mapboxgl.NavigationControl({showCompass: true}), 'bottom-right')
      map.addControl(
        new Mazemap.mapboxgl.GeolocateControl({
          positionOptions: {enableHighAccuracy: true},
          trackUserLocation: true,
          showUserHeading: true,
        }),
        'bottom-right',
      )
    } catch (err) {
      console.warn('[map] control setup failed', err)
    }
    onReady?.(map)
  })
  map.on('error', (event) => {
    console.warn('[map] error', event?.error)
    onError?.(event?.error)
  })

  return {
    map,
    destroy: () => {
      try {
        map.remove()
      } catch {
        // already removed
      }
    },
  }
}
