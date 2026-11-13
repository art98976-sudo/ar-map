// The destination pins on the campus map, and the category filter that shows and hides them.
import {DESTINATIONS} from '../../map/destinations.js'
import {matchesFilter} from '../../map/filters.js'
import {blockedPins, clusterPoints, labelBox, onePerBuilding, sizeAtZoom} from '../../map/pin-clusters.js'
import {HOME_MAP} from '../../config.js'
import {html, render} from '../dom.js'
import {icon, iconFor} from '../icons.js'

export function createMapPins(root, {getMap, getSelected, canSelect, onSelect}) {
  const pins = new Map()
  let tempPin = null
  let filter = null
  let clusters = [] // numbered markers for pins merged on screen (7.3)
  let frame = 0
  let drawnGroups = '' // the groups on screen: a move that keeps them changes nothing
  let listening = false

  function makePin(dest) {
    const Mazemap = window.Mazemap
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'map-pin'
    element.dataset.pin = dest.id
    element.dataset.category = dest.category
    element.setAttribute('aria-label', dest.name)
    render(element, html`<span class="map-pin__dot">${icon(iconFor(dest), {size: 18})}</span>`)
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      if (canSelect()) onSelect(dest)
    })
    const marker = new Mazemap.mapboxgl.Marker({element}).setLngLat({lng: dest.lng, lat: dest.lat}).addTo(getMap())
    // The map library labels markers as images; these are buttons.
    element.setAttribute('role', 'button')
    return marker
  }

  function markSelected() {
    const selected = getSelected()
    tempPin?.remove()
    tempPin = null
    // A room from the search has no permanent pin.
    if (selected && !pins.has(selected.id) && getMap() && pins.size && Number.isFinite(selected.lat)) tempPin = makePin(selected)
    root.querySelectorAll('.map-pin').forEach((el) => {
      const on = el.dataset.pin === selected?.id
      el.classList.toggle('is-selected', on)
      if (on) el.hidden = false
    })
    scheduleRecluster() // the selected place always shows on its own
  }

  function applyFilter() {
    for (const dest of DESTINATIONS) {
      const el = pins.get(dest.id)?.getElement()
      if (el) el.hidden = !matchesFilter(dest, filter)
    }
    markSelected()
    recluster()
  }

  /**
   * Keep the map readable (7.3): below building zoom one pin per building, and pins that would
   * overlap on screen merge into one numbered cluster. Tapping a cluster zooms in on it.
   */
  function recluster() {
    const map = getMap()
    const Mazemap = window.Mazemap
    if (!map || !Mazemap || !pins.size) return
    const selectedId = getSelected()?.id
    const shown = DESTINATIONS.filter((d) => pins.has(d.id) && matchesFilter(d, filter))
    const allowed = new Set(map.getZoom() < HOME_MAP.buildingZoom ? onePerBuilding(shown) : shown.map((d) => d.id))
    if (selectedId) allowed.add(selectedId)
    const points = shown
      .filter((d) => allowed.has(d.id))
      .map((d) => ({id: d.id, keep: d.id === selectedId, ...map.project([d.lng, d.lat])}))
    const groups = clusterPoints(points, HOME_MAP.clusterPx)
    // Moves fire often (the 3D view, a fly-to): only touch the DOM when the groups change.
    const key = groups.map((g) => g.ids.join('+')).join('|')
    if (key === drawnGroups) return avoidLabels()
    drawnGroups = key
    const alone = new Set(groups.filter((g) => g.ids.length === 1).map((g) => g.ids[0]))
    for (const d of shown) pins.get(d.id).getElement().classList.toggle('is-merged', !alone.has(d.id))
    for (const c of clusters) c.remove()
    clusters = groups
      .filter((g) => g.ids.length > 1)
      .map((g) => {
        const first = DESTINATIONS.find((d) => d.id === g.ids[0])
        const at = {lng: first.lng, lat: first.lat}
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'map-cluster'
        el.dataset.cluster = String(g.ids.length)
        el.setAttribute('aria-label', `${g.ids.length} places here. Zoom in`)
        const count = document.createElement('span')
        count.textContent = String(g.ids.length)
        el.append(count)
        el.addEventListener('click', (event) => {
          event.stopPropagation()
          map.easeTo({center: at, zoom: Math.min(19, map.getZoom() + HOME_MAP.clusterZoomStep)})
        })
        const marker = new Mazemap.mapboxgl.Marker({element: el}).setLngLat(at).addTo(map)
        el.setAttribute('role', 'button')
        return marker
      })
    avoidLabels()
  }

  // The screen's own bars: a pin under them could not be seen or tapped.
  const BARS = ['.map-search', '[data-rail] .round-btn:not([hidden])', '[data-floor-host] .mm-floor-bar', '[data-home-sheet]', '[data-card]:not([hidden])']

  /**
   * Building names come before pins, everywhere (7.3): a pin whose dot would cover a name, or
   * that sits under the search bar, the control stack or the sheet, is hidden until the map moves.
   */
  function avoidLabels() {
    const map = getMap()
    if (!map) return
    const box = map.getContainer().getBoundingClientRect()
    const boxes = []
    if (map.getLayer('mm-building-label')) {
      const stops = map.getLayoutProperty('mm-building-label', 'text-size')?.stops
      const size = stops ? sizeAtZoom(stops, map.getZoom()) : 12
      for (const f of map.queryRenderedFeatures({layers: ['mm-building-label']})) {
        if (f.geometry?.type !== 'Point' || !f.properties?.text) continue
        const {x, y} = map.project(f.geometry.coordinates)
        boxes.push(labelBox({x, y, text: f.properties.text}, size, {offsetEm: HOME_MAP.labelOffsetEm}))
      }
    }
    for (const sel of BARS) {
      for (const el of root.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width) boxes.push({left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top})
      }
    }
    const selectedId = getSelected()?.id
    const shown = [...pins.entries()].map(([id, m]) => ({id, el: m.getElement(), m})).filter((p) => !p.el.hidden && !p.el.classList.contains('is-merged'))
    const all = [
      // The selected place, and the places a chip asked for, always show; names win over the rest.
      ...shown.map((p) => ({id: p.id, el: p.el, keep: p.id === selectedId || Boolean(filter), ...map.project(p.m.getLngLat())})),
      ...clusters.map((m, i) => ({id: `cluster-${i}`, el: m.getElement(), ...map.project(m.getLngLat())})),
    ]
    const hide = blockedPins(all, boxes, HOME_MAP.pinDotPx)
    for (const p of all) p.el.classList.toggle('is-blocked', hide.has(p.id))
  }

  function scheduleRecluster() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(recluster)
  }

  function fitToFilter() {
    const map = getMap()
    const Mazemap = window.Mazemap
    if (!map || !filter) return
    const shown = DESTINATIONS.filter((d) => matchesFilter(d, filter))
    if (!shown.length) return
    const first = [shown[0].lng, shown[0].lat]
    const bounds = shown.reduce((b, d) => b.extend([d.lng, d.lat]), new Mazemap.mapboxgl.LngLatBounds(first, first))
    // Above the sheet, which rises to list the results: a pin under it would be hidden.
    const box = map.getContainer().getBoundingClientRect()
    // The sheet may still be sliding up: use the height it is going to (half: 50% of the screen).
    const sheet = root.querySelector('[data-home-sheet]')
    const sheetPx = sheet?.dataset.height === 'half' ? window.innerHeight * 0.5 : box.bottom - (sheet?.getBoundingClientRect().top ?? box.bottom)
    const bottom = Math.max(80, sheetPx + 40)
    map.fitBounds(bounds, {padding: {top: 170, bottom, left: 50, right: 50}, maxZoom: 16.5})
  }

  return {
    markSelected,
    addAll() {
      for (const dest of DESTINATIONS) pins.set(dest.id, makePin(dest))
      const map = getMap()
      if (map && !listening) {
        listening = true
        map.on('zoomend', scheduleRecluster)
        map.on('moveend', scheduleRecluster)
        map.on('idle', avoidLabels) // names arrive with their tiles, after the move
      }
      applyFilter()
    },
    recluster,
    clear: () => {
      pins.clear()
      for (const c of clusters) c.remove()
      clusters = []
      drawnGroups = ''
      listening = false
    },
    /** Show only this filter's pins (null: all). The bottom sheet paints its own chips. */
    setFilter(next) {
      filter = next ?? null
      applyFilter()
      fitToFilter()
    },
    destroy: () => {
      tempPin?.remove()
      cancelAnimationFrame(frame)
    },
  }
}
