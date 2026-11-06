// The destination pins on the campus map, and the category filter that shows and hides them.
import {DESTINATIONS} from '../../map/destinations.js'
import {matchesFilter} from '../../map/filters.js'
import {html, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'

export function createMapPins(root, {getMap, getSelected, canSelect, onSelect}) {
  const pins = new Map()
  let tempPin = null
  let filter = null

  function makePin(dest) {
    const Mazemap = window.Mazemap
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'map-pin'
    element.dataset.pin = dest.id
    element.dataset.category = dest.category
    element.setAttribute('aria-label', dest.name)
    render(element, html`<span class="map-pin__dot">${icon(CATEGORY_ICON[dest.category] || 'pin', {size: 18})}</span>`)
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
  }

  function applyFilter() {
    for (const dest of DESTINATIONS) {
      const el = pins.get(dest.id)?.getElement()
      if (el) el.hidden = !matchesFilter(dest, filter)
    }
    markSelected()
  }

  function fitToFilter() {
    const map = getMap()
    const Mazemap = window.Mazemap
    if (!map || !filter) return
    const shown = DESTINATIONS.filter((d) => matchesFilter(d, filter))
    if (!shown.length) return
    const first = [shown[0].lng, shown[0].lat]
    const bounds = shown.reduce((b, d) => b.extend([d.lng, d.lat]), new Mazemap.mapboxgl.LngLatBounds(first, first))
    map.fitBounds(bounds, {padding: {top: 170, bottom: 80, left: 50, right: 50}, maxZoom: 16.5})
  }

  return {
    markSelected,
    addAll() {
      for (const dest of DESTINATIONS) pins.set(dest.id, makePin(dest))
      applyFilter()
    },
    clear: () => pins.clear(),
    setFilter(next) {
      filter = filter === next ? null : next
      root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)))
      applyFilter()
      fitToFilter()
    },
    destroy: () => tempPin?.remove(),
  }
}
