// /premium: the redesigned map, built beside the existing screens so the two can be compared.
// Step 1: the realistic map. The interface (opening, home, card, navigation) comes next.
import {createCampusMap, loadMazeMap} from '../map/mazemap.js'
import {html, render} from '../ui/dom.js'
import {createFpsGuard} from './fps-guard.js'
import {applyPremiumLook} from './map-look.js'
import {drawPremiumRoute} from './route-look.js'

const DEMO_ROUTE = [
  {lat: 56.14468, lng: -3.92137},
  {lat: 56.14512, lng: -3.92075},
  {lat: 56.14548, lng: -3.92031},
  {lat: 56.14581, lng: -3.92002},
  {lat: 56.14606, lng: -3.91985},
]

/** Sharp on high-density screens without drawing 9x the pixels on a 3x phone. */
export function premiumPixelRatio(dpr = window.devicePixelRatio || 1) {
  return Math.min(Math.max(1, dpr), 2)
}

/** Building names, in Inter, at the middle of each building. Shown until rooms take over. */
function addBuildingLabels(Mazemap, map, collection) {
  const markers = collection.features.map((f) => {
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length
    const el = document.createElement('div')
    el.className = 'p-building-label'
    el.textContent = f.properties.name
    return new Mazemap.mapboxgl.Marker({element: el, anchor: 'center'}).setLngLat([lng, lat]).addTo(map)
  })
  // Biggest buildings first; a label that would overlap one already shown waits.
  markers.sort((a, b) => b.getElement().textContent.length - a.getElement().textContent.length)
  const sync = () => {
    const tooClose = map.getZoom() >= 18
    const shown = []
    for (const m of markers) {
      const el = m.getElement()
      const p = map.project(m.getLngLat())
      const w = el.offsetWidth / 2 + 4
      const h = el.offsetHeight / 2 + 4
      const box = {l: p.x - w, r: p.x + w, t: p.y - h, b: p.y + h}
      const overlaps = shown.some((s) => box.l < s.r && box.r > s.l && box.t < s.b && box.b > s.t)
      const hide = tooClose || overlaps
      el.classList.toggle('is-hidden', hide)
      if (!hide) shown.push(box)
    }
  }
  map.on('moveend', sync)
  map.on('zoomend', sync)
  sync()
  return () => {
    map.off('moveend', sync)
    map.off('zoomend', sync)
    markers.forEach((m) => m.remove())
  }
}

export function premiumScreen(root, {params}) {
  render(
    root,
    html`<div class="premium">
      <h1 class="sr-only" tabindex="-1">Campus map</h1>
      <div class="premium__map" data-map role="region" aria-label="University of Stirling campus map"></div>
      <div class="premium__loading" data-loading aria-hidden="true"><span></span></div>
    </div>`,
  )
  const el = root.querySelector('.premium')
  let instance = null
  let look = null
  let guard = null
  let labels = null
  let gone = false
  let stopRoute = null

  ;(async () => {
    try {
      const Mazemap = await loadMazeMap()
      if (gone) return
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        options: {pixelRatio: premiumPixelRatio(), attributionControl: false, logoPosition: 'bottom-left', antialias: true},
        onReady: (map) => {
          if (gone) return
          // Credits stay visible (their terms ask for it): the small "i" sits beside the logos, bottom left.
          map.addControl(new Mazemap.mapboxgl.AttributionControl({compact: true}), 'bottom-left')
          const corner = map.getContainer().querySelector('.mapboxgl-ctrl-bottom-left')
          const mmLogo = map.getContainer().querySelector('.mazemap-ctrl-logo-wrapper')?.closest('.mapboxgl-ctrl')
          if (corner && mmLogo) corner.appendChild(mmLogo) // moved, never hidden
          look = applyPremiumLook(map)
          guard = createFpsGuard(map, (effect) => {
            look.drop(effect)
            if (effect === 'blur') el.classList.add('no-blur')
          })
          look.buildings.then((collection) => {
            if (!gone && collection.features.length) labels = addBuildingLabels(Mazemap, map, collection)
          })
          // The map is usable once it has drawn; detail (3D, indoor) keeps sharpening after.
          map.once('render', () => el.querySelector('[data-loading]')?.remove())
          if (params.debug === '1') window.__premiumMap = map
          // ?route=demo: a sample walk (Cottrell to the Library) to judge the route style.
          if (params.route === 'demo') {
            stopRoute = drawPremiumRoute(map, DEMO_ROUTE)
            map.jumpTo({center: [-3.9198, 56.1455], zoom: 16.8, pitch: 50, bearing: -20})
          }
        },
        onError: (err) => console.warn('[premium] map', err),
      })
    } catch (err) {
      console.error('[premium] map failed', err)
      el.querySelector('[data-loading]')?.classList.add('is-error')
    }
  })()

  return () => {
    gone = true
    stopRoute?.()
    labels?.()
    guard?.destroy()
    look?.destroy()
    instance?.destroy()
    if (window.__premiumMap) delete window.__premiumMap
  }
}
