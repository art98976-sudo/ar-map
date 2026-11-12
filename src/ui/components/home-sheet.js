// The map's bottom sheet: three heights (peek, half, full) the user drags, the quick chips in its
// peek row, and the list of places for the chosen chip. Picking a row hands the place to the card.
//
// Chips for our own places also filter the pins (map-pins.js); toilets, lifts, lecture theatres and
// study spaces show as small dots on the map instead, nearest first in the list.
import {QUICK_CHIPS} from '../../map/filters.js'
import {loadRoomTypes, pinPlaces, roomTypeDestinations, searchPlaces, toRows} from '../../map/quick-places.js'
import {render} from '../dom.js'
import {chipLoading, chipResults} from '../screens/home-view.js'

export const SHEET_HEIGHTS = ['peek', 'half', 'full']
const DOTS = 'quick-places'
const SNAP_FLICK_PX = 40 // a short flick is enough to move one height

/** Height in px of each sheet state, for the screen it is on. */
export function sheetHeights(viewport, peekPx) {
  return {peek: peekPx, half: Math.round(viewport * 0.5), full: Math.round(viewport - 88)}
}

/** Where a drag ends: the nearest height, or one step on for a quick flick. */
export function snapHeight(heights, startName, draggedPx) {
  const order = SHEET_HEIGHTS
  const at = heights[startName] + draggedPx
  const i = order.indexOf(startName)
  if (Math.abs(draggedPx) >= SNAP_FLICK_PX) {
    const next = order[Math.max(0, Math.min(order.length - 1, i + (draggedPx > 0 ? 1 : -1)))]
    // A long drag goes wherever it ends; a flick moves one step.
    const nearest = order.reduce((best, name) => (Math.abs(heights[name] - at) < Math.abs(heights[best] - at) ? name : best), order[0])
    return Math.abs(heights[nearest] - heights[startName]) > Math.abs(heights[next] - heights[startName]) ? nearest : next
  }
  return startName
}

export function createHomeSheet(root, {getMap, getFrom, pins, onPick}) {
  const sheet = root.querySelector('[data-home-sheet]')
  const body = sheet.querySelector('[data-chip-results]')
  const handle = sheet.querySelector('[data-action="sheet-step"]')
  const home = root.querySelector('.map-home')
  let height = 'peek'
  let chip = null
  let rows = []
  let request = 0
  let abort = null

  function peekPx() {
    return sheet.querySelector('.home-sheet__peek').getBoundingClientRect().height + handle.getBoundingClientRect().height - 12
  }
  function heights() {
    return sheetHeights(home.getBoundingClientRect().height, peekPx())
  }

  function setHeight(name, {animate = true} = {}) {
    height = name
    sheet.dataset.height = name
    sheet.classList.toggle('is-dragging', !animate)
    const px = heights()[name]
    sheet.style.setProperty('--sheet-px', `${px}px`)
    home.style.setProperty('--sheet-px', `${px}px`)
    home.dataset.sheet = name
    handle.setAttribute('aria-expanded', String(name !== 'peek'))
    handle.setAttribute('aria-label', name === 'full' ? 'Show less' : 'Show more')
  }

  // ---------- dragging ----------
  let drag = null
  const onDown = (event) => {
    if (event.button > 0 || event.target.closest('.quick-chip, .round-btn, .home-menu, .place-row')) return
    drag = {y: event.clientY, from: height, start: heights()[height], moved: false, id: event.pointerId}
  }
  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const dy = drag.y - event.clientY
    if (!drag.moved && Math.abs(dy) < 6) return
    if (!drag.moved) sheet.setPointerCapture?.(event.pointerId)
    drag.moved = true
    const h = heights()
    const px = Math.max(h.peek, Math.min(h.full, drag.start + dy))
    sheet.classList.add('is-dragging')
    sheet.style.setProperty('--sheet-px', `${px}px`)
    home.style.setProperty('--sheet-px', `${px}px`)
  }
  const onUp = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const {moved, from, y} = drag
    drag = null
    if (!moved) return
    setHeight(snapHeight(heights(), from, y - event.clientY))
  }
  sheet.addEventListener('pointerdown', onDown)
  sheet.addEventListener('pointermove', onMove)
  sheet.addEventListener('pointerup', onUp)
  sheet.addEventListener('pointercancel', onUp)
  // A drag on the handle must not also count as a tap.
  handle.addEventListener('click', (event) => sheet.classList.contains('is-dragging') && event.stopImmediatePropagation(), true)

  const onResize = () => setHeight(height, {animate: false})
  window.addEventListener('resize', onResize)

  // ---------- chips ----------
  function paintChips() {
    sheet.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === chip)))
  }

  function showDots(dests) {
    const map = getMap()
    if (!map?.getStyle?.()) return
    const data = {type: 'FeatureCollection', features: dests.map((d) => ({type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [d.lng, d.lat]}}))}
    if (map.getSource(DOTS)) map.getSource(DOTS).setData(data)
    else {
      map.addSource(DOTS, {type: 'geojson', data})
      const css = getComputedStyle(sheet)
      map.addLayer({
        id: DOTS,
        type: 'circle',
        source: DOTS,
        paint: {
          'circle-radius': 6,
          'circle-color': css.getPropertyValue('--c-primary').trim() || '#00693e',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    }
  }
  function clearDots() {
    const map = getMap()
    try {
      if (map?.getLayer(DOTS)) map.removeLayer(DOTS)
      if (map?.getSource(DOTS)) map.removeSource(DOTS)
    } catch {
      // the map is gone
    }
  }

  function showRows(def, list, note = '') {
    rows = list
    render(body, chipResults(def.label, list, list.length ? note : `No ${def.label.toLowerCase()} found nearby.`))
  }

  async function choose(id) {
    const def = QUICK_CHIPS.find((c) => c.id === id)
    chip = chip === id ? null : id
    paintChips()
    abort?.abort()
    const ticket = ++request
    if (!chip) {
      pins.setFilter(null)
      clearDots()
      rows = []
      render(body, '')
      setHeight('peek')
      return
    }
    setHeight('half')
    const {point: from, isUser} = getFrom()
    const note = isUser || !from ? '' : 'Nearest to the middle of the map.'
    if (def.kind === 'pins') {
      pins.setFilter(id)
      clearDots()
      showRows(def, toRows(pinPlaces(id), from, undefined, {showDistance: isUser}), note)
      return
    }
    pins.setFilter(null)
    render(body, chipLoading(def.label))
    try {
      let dests
      if (def.kind === 'rooms') {
        const types = await loadRoomTypes()
        dests = roomTypeDestinations(types[def.type])
      } else {
        abort = new AbortController()
        dests = await searchPlaces(def.query, {signal: abort.signal})
      }
      if (ticket !== request) return
      const list = toRows(dests, from, def.icon, {showDistance: isUser})
      showDots(list.map((r) => r.dest))
      showRows(def, list, note)
    } catch (err) {
      if (ticket !== request || err?.name === 'AbortError') return
      console.warn('[home] quick chip failed', err)
      rows = []
      render(body, chipResults(def.label, [], 'Could not load these places. Check your connection and try again.'))
    }
  }

  const onClick = (event) => {
    const row = event.target.closest('[data-result]')
    if (!row) return
    const picked = rows[Number(row.dataset.result)]
    if (picked) onPick(picked.dest)
  }
  body.addEventListener('click', onClick)

  setHeight('peek', {animate: false})

  return {
    get height() {
      return height
    },
    get chip() {
      return chip
    },
    setHeight,
    /** The handle as a button: peek -> half -> full -> peek. */
    step() {
      setHeight(SHEET_HEIGHTS[(SHEET_HEIGHTS.indexOf(height) + 1) % SHEET_HEIGHTS.length])
    },
    choose,
    /** After a new map: the dots belong to the old one. */
    mapReady() {
      if (chip) {
        const again = chip
        chip = null
        choose(again)
      }
    },
    destroy() {
      abort?.abort()
      window.removeEventListener('resize', onResize)
      clearDots()
    },
  }
}
