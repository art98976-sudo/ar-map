// The map's bottom sheet: three heights (peek, half, full) the user drags, the quick chips in its
// peek row, and the list of places for the chosen chip. Picking a row hands the place to the card.
//
// Chips for our own places also filter the pins (map-pins.js); toilets, lifts, lecture theatres and
// study spaces show as small dots on the map instead, nearest first in the list.
import {QUICK_CHIPS} from '../../map/filters.js'
import {loadRoomTypes, pinPlaces, roomTypeDestinations, searchPlaces, toRows} from '../../map/quick-places.js'
import {getRecent} from '../../map/destinations.js'
import {render} from '../dom.js'
import {chipLoading, chipResults, restView} from '../screens/home-view.js'

const RECENT_AT_REST = 3

/**
 * The nearest place of a kind to a point (Group C shortcuts): toilet and lift from the campus model,
 * café from our own food places. Pure on its inputs, so it is tested without a map.
 */
export function nearestOf(kind, from, {roomTypes = {}, food = []} = {}) {
  const pool = kind === 'cafe' ? food : roomTypeDestinations(roomTypes[kind] ?? [])
  return toRows(pool, from, undefined)[0]?.dest ?? null
}

export const SHEET_HEIGHTS = ['peek', 'half', 'full'] // collapsed, half, full
const DOTS = 'quick-places'
const DRAG_START_PX = 6 // less than this is a tap
const FLICK_PX_PER_MS = 0.45 // a release faster than this moves one height, whatever the distance
const DESKTOP = '(min-width: 768px)' // a side panel there, not a bottom sheet

/**
 * Height in px of each state for a screen viewport px tall: collapsed shows the handle and the chips
 * (collapsedPx, measured), half is half the screen, full nine tenths.
 */
export function sheetHeights(viewport, collapsedPx) {
  const full = Math.round(viewport * 0.9)
  const half = Math.max(collapsedPx, Math.round(viewport * 0.5))
  return {peek: Math.min(collapsedPx, half), half, full}
}

/**
 * Where a drag ends. visiblePx: how much of the sheet shows at release; velocity: px/ms, > 0 upwards.
 * A quick flick goes on to the next height in its direction (so a short flick moves one step, and a
 * long fast drag stays where the finger took it); otherwise the nearest height wins.
 */
export function snapHeight(heights, startName, visiblePx, velocity = 0) {
  const order = SHEET_HEIGHTS
  if (Math.abs(velocity) >= FLICK_PX_PER_MS) {
    const up = velocity > 0
    const ahead = order.filter((name) => (up ? heights[name] >= visiblePx - 1 : heights[name] <= visiblePx + 1))
    if (ahead.length) return up ? ahead[0] : ahead.at(-1)
    return up ? order.at(-1) : order[0]
  }
  return order.reduce((best, name) => (Math.abs(heights[name] - visiblePx) < Math.abs(heights[best] - visiblePx) ? name : best), order[0])
}

export function createHomeSheet(root, {getMap, getFrom, pins, onPick, onChange = () => {}}) {
  const sheet = root.querySelector('[data-home-sheet]')
  const body = sheet.querySelector('[data-chip-results]')
  const scroller = sheet.querySelector('[data-sheet-scroll]')
  const handle = sheet.querySelector('[data-action="sheet-step"]')
  const home = root.querySelector('.map-home')
  const desktop = window.matchMedia?.(DESKTOP)
  const isDesktop = () => Boolean(desktop?.matches)
  let height = 'peek'
  let chip = null
  let rows = []
  let request = 0
  let abort = null

  /** The handle and the chips row, and the iPhone home bar below them. */
  function collapsedPx() {
    const peek = sheet.querySelector('.home-sheet__peek')
    const safe = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
    return Math.round(peek.offsetTop + peek.offsetHeight + 8 + safe)
  }
  function heights() {
    return sheetHeights(home.clientHeight, collapsedPx())
  }

  // The sheet is always as tall as "full" and slides: only its transform changes, never its height,
  // so a drag costs no layout. visible: how much of it shows.
  let visible = 0
  let frame = 0
  function paint(px) {
    visible = px
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const full = heights().full
      sheet.style.transform = isDesktop() ? '' : `translate3d(0, ${Math.max(0, full - visible)}px, 0)`
      // The locate button, the logos and the credits ride on the sheet's top edge (home.css).
      home.style.setProperty('--sheet-visible-px', `${isDesktop() ? 0 : visible}px`)
      home.style.setProperty('--sheet-px', `${visible}px`)
      onChange({visiblePx: visible, height, settled: !drag})
    })
  }

  function setHeight(name, {animate = true} = {}) {
    height = name
    sheet.dataset.height = name
    home.dataset.sheet = name
    const h = heights()
    sheet.style.height = isDesktop() ? '' : `${h.full}px`
    sheet.classList.toggle('is-instant', !animate)
    if (!animate) requestAnimationFrame(() => sheet.classList.remove('is-instant'))
    // Only in full does the list scroll; anywhere else a swipe moves the sheet.
    if (name !== 'full') scroller.scrollTop = 0
    handle.setAttribute('aria-expanded', String(name !== 'peek'))
    handle.setAttribute('aria-label', name === 'full' ? 'Show less' : 'Show more')
    paint(h[name])
  }

  // ---------- dragging: the finger moves the sheet, release snaps it ----------
  let drag = null
  let justDragged = false // the click that ends a drag is not a tap on the handle
  const onDown = (event) => {
    if (isDesktop() || event.button > 0) return
    const inList = scroller.contains(event.target)
    drag = {id: event.pointerId, y: event.clientY, x: event.clientX, from: height, start: visible, moved: false, inList, samples: [{t: event.timeStamp, y: event.clientY}]}
  }
  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const dy = drag.y - event.clientY // > 0: the finger goes up
    if (!drag.moved) {
      if (Math.abs(dy) < DRAG_START_PX || Math.abs(event.clientX - drag.x) > Math.abs(dy)) return
      // In full, a swipe in the list scrolls it, unless it is at the top and the finger goes down.
      if (drag.inList && height === 'full' && (scroller.scrollTop > 0 || dy > 0)) {
        drag = null
        return
      }
      drag.moved = true
      sheet.setPointerCapture?.(event.pointerId)
      sheet.classList.add('is-dragging')
    }
    const h = heights()
    drag.samples.push({t: event.timeStamp, y: event.clientY})
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > 100) drag.samples.shift()
    paint(Math.max(h.peek, Math.min(h.full, drag.start + dy)))
  }
  const onUp = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const {moved, from, samples} = drag
    drag = null
    sheet.classList.remove('is-dragging')
    if (!moved) return
    justDragged = true
    setTimeout(() => (justDragged = false), 0)
    const a = samples[0]
    const b = {t: event.timeStamp, y: event.clientY}
    const velocity = b.t > a.t ? (a.y - b.y) / (b.t - a.t) : 0
    setHeight(snapHeight(heights(), from, visible, event.type === 'pointercancel' ? 0 : velocity))
  }
  // In full, at the top of the list, a pull down must move the sheet, not bounce the list: the
  // browser would take the touch for scrolling (and cancel the pointer) unless told no here.
  let touchY = null
  const onTouchStart = (event) => {
    touchY = event.touches[0]?.clientY ?? null
  }
  const onTouchMove = (event) => {
    if (touchY == null || isDesktop() || height !== 'full' || scroller.scrollTop > 0) return
    if (event.touches[0].clientY > touchY && event.cancelable) event.preventDefault()
  }
  sheet.addEventListener('pointerdown', onDown)
  sheet.addEventListener('pointermove', onMove)
  sheet.addEventListener('pointerup', onUp)
  sheet.addEventListener('pointercancel', onUp)
  scroller.addEventListener('touchstart', onTouchStart, {passive: true})
  scroller.addEventListener('touchmove', onTouchMove, {passive: false})
  // A drag that ends on a button is not a tap on it.
  sheet.addEventListener('click', (event) => justDragged && (event.stopImmediatePropagation(), event.preventDefault()), true)

  const onResize = () => setHeight(height, {animate: false})
  window.addEventListener('resize', onResize)
  desktop?.addEventListener?.('change', onResize)

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

  // ---------- at rest: "Nearest" shortcuts and Recent ----------
  const rest = sheet.querySelector('[data-rest]')
  let recent = []
  function paintRest() {
    if (!rest) return
    recent = getRecent().slice(0, RECENT_AT_REST)
    render(rest, restView(recent))
    setHeight(height, {animate: false}) // the peek is as tall as what it shows
  }
  async function pickNearest(kind, button) {
    const {point: from} = getFrom()
    button?.setAttribute('aria-busy', 'true')
    try {
      const roomTypes = kind === 'cafe' ? {} : await loadRoomTypes()
      const dest = nearestOf(kind, from, {roomTypes, food: pinPlaces('food')})
      if (dest) onPick(dest, {go: true})
    } catch (err) {
      console.warn('[home] nearest failed', err)
    } finally {
      button?.removeAttribute('aria-busy')
    }
  }
  const onRestClick = (event) => {
    const near = event.target.closest('[data-nearest]')
    if (near) return pickNearest(near.dataset.nearest, near)
    const row = event.target.closest('[data-recent]')
    const dest = row && recent[Number(row.dataset.recent)]
    if (dest) onPick(dest, {go: true})
  }
  rest?.addEventListener('click', onRestClick)

  setHeight('peek', {animate: false})
  paintRest()

  return {
    /** A place was picked: Recent changes. */
    refreshRest: paintRest,
    get height() {
      return height
    },
    get chip() {
      return chip
    },
    setHeight,
    /** Where the sheet's top edge will rest, from the top of the screen; null as a side panel. */
    coverTop() {
      if (isDesktop() || sheet.offsetParent === null) return null
      return home.clientHeight - heights()[height]
    },
    get desktop() {
      return isDesktop()
    },
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
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      desktop?.removeEventListener?.('change', onResize)
      clearDots()
    },
  }
}
