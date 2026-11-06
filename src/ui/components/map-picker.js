// "Pick on map": a draggable pin that always ends up on a walkable path, so routing works from it.
import {loadTownGraph, nearestOnPaths} from '../../route/footpaths.js'
import {render} from '../dom.js'
import {icon} from '../icons.js'

export function createMapPicker(bar) {
  const confirm = bar.querySelector('[data-action="pick-confirm"]')
  const text = bar.querySelector('[data-pick-text]')
  let pick = null // while picking: {marker, point}

  async function snap(p) {
    const current = pick
    confirm.disabled = true
    try {
      const hit = nearestOnPaths(await loadTownGraph(), {lat: p.lat, lng: p.lng})
      if (pick !== current || !hit) return
      current.point = {lat: hit.lat, lng: hit.lng}
      current.marker.setLngLat({lng: hit.lng, lat: hit.lat})
      confirm.disabled = false
      text.textContent = 'Moved to the nearest path. Tap the map or drag the pin to change it.'
    } catch (err) {
      console.warn('[home] could not snap the pin', err)
      if (pick === current) text.textContent = 'Could not load the paths. Check your connection and try again.'
    }
  }

  function leave() {
    pick?.marker.remove()
    pick = null
    bar.hidden = true
  }

  return {
    get active() {
      return Boolean(pick)
    },
    get point() {
      return pick?.point ?? null
    },
    enter(map, from) {
      bar.hidden = false
      const element = document.createElement('div')
      element.className = 'map-pick-pin'
      render(element, icon('pin', {size: 36}))
      const marker = new window.Mazemap.mapboxgl.Marker({element, draggable: true, anchor: 'bottom'}).setLngLat({lng: from.lng, lat: from.lat}).addTo(map)
      marker.on('dragend', () => snap(marker.getLngLat()))
      pick = {marker, point: null}
      snap({lat: from.lat, lng: from.lng})
      confirm.focus({preventScroll: true})
    },
    moveTo(lngLat) {
      pick.marker.setLngLat(lngLat)
      snap(lngLat)
    },
    leave,
  }
}
