// The part of the home map the user can actually see: below the search bar and above whatever
// panel covers the bottom (the sheet, the place card, the map trip). The map's padding is kept
// equal to it, so every camera move (the opening view, a picked place, a route) centres on what is
// visible, never under the sheet. Pure helpers first, so they are tested without a browser.
import {HOME_MAP} from '../config.js'

const M_PER_DEG_LAT = 111_320

/**
 * The campus as [[west, south], [east, north]]: every place given (our buildings, halls, the loch,
 * the castle), widened by marginM on every side, since a place is one point in a building that
 * has size. null with no places: the caller uses HOME_MAP.campusFallbackBounds.
 */
export function campusBounds(places, {marginM = HOME_MAP.campusMarginM} = {}) {
  const pts = (places ?? []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
  if (!pts.length) return null
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const dLat = marginM / M_PER_DEG_LAT
  const dLng = marginM / (M_PER_DEG_LAT * Math.cos((((south + north) / 2) * Math.PI) / 180))
  return [
    [Math.min(...lngs) - dLng, south - dLat],
    [Math.max(...lngs) + dLng, north + dLat],
  ]
}

/**
 * The map's padding from the page: the bottom of the top bar and the top of the bottom panel,
 * each with gapPx to spare. Rectangles in px relative to the map's container
 * ({height, topBarBottom, panelTop}); panelTop null when nothing covers the bottom.
 */
export function paddingFor({height, topBarBottom = 0, panelTop = null}, gapPx = HOME_MAP.edgeGapPx) {
  const bottomCover = panelTop == null ? 0 : Math.max(0, height - panelTop)
  return {
    top: Math.max(0, Math.round(topBarBottom + gapPx)),
    bottom: Math.max(0, Math.round(bottomCover + gapPx)),
    left: gapPx,
    right: gapPx,
  }
}

const samePadding = (a, b) => Boolean(a && b) && ['top', 'bottom', 'left', 'right'].every((k) => Math.abs(a[k] - b[k]) < 1)

/**
 * Measure the page as paddingFor wants it. Layout boxes (offsetTop / offsetHeight), not
 * getBoundingClientRect: the place card slides in with a transform, which would make it look
 * lower than it will be.
 */
export function measureViewport({container, topBar, panels}) {
  const height = container.clientHeight
  const topBarBottom = topBar ? topBar.getBoundingClientRect().bottom - container.getBoundingClientRect().top : 0
  let panelTop = null
  for (const el of panels) {
    if (!el || el.hidden || el.offsetParent === null || !el.offsetHeight) continue // not shown
    // Panels hang from the bottom of the same host as the map.
    const top = height - (el.offsetParent.clientHeight - el.offsetTop)
    panelTop = panelTop == null ? top : Math.min(panelTop, top)
  }
  return {height, topBarBottom, panelTop}
}

/**
 * Keeps the map's padding in step with the page, and frames the campus and places in what shows.
 * @param o.map the Mapbox / MazeMap map
 * @param o.host the element that holds the map and the panels (gets --map-panel-px for the buttons)
 * @param o.topBar the search bar
 * @param o.panels the elements that can cover the bottom of the map
 * @param o.isFull the sheet covers the whole screen: keep the padding ready, move nothing
 * @param o.campus the campus bounds
 */
export function createMapViewport({map, host, topBar, panels, isFull = () => false, campus}) {
  const container = map.getContainer()
  let padding = map.getPadding?.() ?? null
  let pending = null // a padding that waits for the current camera move to end
  let frame = 0
  let lastSize = `${container.clientWidth}x${container.clientHeight}`
  // What the camera last framed: when the sheet or the screen changes it is framed again in what
  // shows now (the whole campus may no longer fit). Forgotten once the user moves the map.
  let framed = null // {kind: 'campus'} | {kind: 'place', place, zoom} | {kind: 'bounds', bounds, maxZoom}

  function measure() {
    return paddingFor(measureViewport({container, topBar, panels}))
  }

  function apply(next) {
    if (samePadding(next, padding)) return
    padding = next
    // Moving the camera while the user drags or a flight is under way would stop it: wait.
    if (map.isMoving?.()) {
      pending = next
      return
    }
    pending = null
    if (framed?.kind === 'campus' || framed?.kind === 'bounds') {
      const bounds = framed.kind === 'campus' ? campus : framed.bounds
      const maxZoom = framed.kind === 'campus' ? HOME_MAP.openMaxZoom : framed.maxZoom
      map.fitBounds(bounds, {padding: next, maxZoom, duration: 0, bearing: map.getBearing(), pitch: map.getPitch()})
    } else map.easeTo({padding: next, duration: 0}) // a place: it stays in the middle of what shows
  }

  function update() {
    frame = 0
    const size = `${container.clientWidth}x${container.clientHeight}`
    if (size !== lastSize) {
      lastSize = size
      map.resize()
    }
    const next = measure()
    // The panel's top edge, for the buttons and logos that ride on it.
    const panelPx = Math.max(0, next.bottom - HOME_MAP.edgeGapPx)
    host.style.setProperty('--map-panel-px', `${panelPx}px`)
    if (isFull()) return // nothing to see: keep the last padding for when the sheet comes down
    apply(next)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const onMoveEnd = () => {
    if (!pending) return
    const next = pending
    pending = null
    padding = null
    apply(next)
  }

  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  for (const el of [container, topBar, ...panels]) if (el) watcher?.observe(el)
  // A panel shown or hidden (the card opens, the sheet goes) is not always a resize.
  const shown = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
  for (const el of panels) if (el) shown?.observe(el, {attributes: true, attributeFilter: ['hidden', 'data-height', 'style']})
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  map.on('moveend', onMoveEnd)
  // A pan, zoom or turn by the user: their view, not ours to frame again.
  const onUserMove = (event) => {
    if (event?.originalEvent) framed = null
  }
  for (const name of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) map.on(name, onUserMove)
  // The map is created framed on the campus (its first frame, home.js).
  framed = {kind: 'campus'}
  update()

  return {
    /** The padding the camera works with now (measured, so it is right even mid-transition). */
    get padding() {
      return isFull() ? padding ?? measure() : measure()
    },
    update: schedule,
    /** The whole campus in what shows. */
    toCampus({duration = HOME_MAP.cameraMs} = {}) {
      const p = this.padding
      padding = p
      framed = {kind: 'campus'}
      map.fitBounds(campus, {padding: p, duration, maxZoom: HOME_MAP.openMaxZoom, bearing: map.getBearing(), pitch: map.getPitch()})
    },
    /** One place, centred in what shows. */
    toPlace(place, {zoom, duration = HOME_MAP.cameraMs} = {}) {
      const p = this.padding
      padding = p
      framed = {kind: 'place', place, zoom}
      map.flyTo({center: {lng: place.lng, lat: place.lat}, zoom, padding: p, duration, essential: true})
    },
    /** A route: all of it in what shows. */
    toBounds(bounds, {maxZoom = HOME_MAP.routeMaxZoom, duration = HOME_MAP.cameraMs} = {}) {
      const p = this.padding
      padding = p
      framed = {kind: 'bounds', bounds, maxZoom}
      map.fitBounds(bounds, {padding: p, maxZoom, duration})
    },
    destroy() {
      cancelAnimationFrame(frame)
      watcher?.disconnect()
      shown?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      map.off('moveend', onMoveEnd)
      for (const name of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) map.off(name, onUserMove)
      host.style.removeProperty('--map-panel-px')
    },
  }
}
