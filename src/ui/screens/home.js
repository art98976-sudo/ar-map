// Home is the campus map: pins, a search bar, category chips and a card for the chosen place.
// #/?to=<id> opens with a place selected.
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {createDestinationSearch} from '../components/destination-search.js'
import {infoSheetContent} from '../components/info-sheet.js'
import {showToast} from '../components/toast.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {GPS, locationPermissionState, readTripFix, watchLocation} from '../../geo/location.js'
import {DESTINATIONS, findDestination, setCurrentDestination} from '../../nav/destinations.js'
import {categoryLabel, MAP_FILTERS, matchesFilter} from '../../nav/filters.js'
import {estimateWalkMinutes, planRoute} from '../../nav/route.js'
import {describeDestination} from '../../nav/search.js'
import {html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'
import {APP} from '../../config.js'

const ROUTE_ID = 'walking-route'
const BRAND_GREEN = '#006938'
const GOOD_ENOUGH_FIX_M = 50 // enough for a walking time; stop the GPS after this to save battery

export function homeScreen(root, {navigate, params}) {
  const forced = params.force === '1'
  let instance = null
  let selected = findDestination(params.to)
  let filter = null
  let tempPin = null
  const pins = new Map()
  let fix = readTripFix()
  let stopWatch = null
  let fixWaiters = []
  let routeRequest = 0
  let disposed = false

  render(
    root,
    html`
      <div class="map-home">
        <h1 class="sr-only" tabindex="-1">Campus map</h1>
        <div class="map-home__map" data-map role="region" aria-label="University of Stirling campus map"></div>
        <header class="map-home__top">
          <div class="map-home__row">
            <button class="map-search" type="button" data-action="open-search" aria-label="Where do you want to go?">
              ${icon('search', {size: 20})}<span>Where do you want to go?</span>
            </button>
            <button class="icon-btn icon-btn--glass-light" type="button" data-action="open-info" aria-label="About and privacy">${icon('info')}</button>
          </div>
          <div class="map-chips" role="group" aria-label="Filter the map">
            ${MAP_FILTERS.map(
              (f) => html`
                <button class="map-chip" type="button" data-action="filter" data-filter="${f.id}" aria-pressed="false">
                  ${icon(f.icon, {size: 18})}<span>${f.label}</span>
                </button>
              `,
            )}
          </div>
        </header>
        <div class="map-home__overlay" data-overlay>
          <span class="spinner spinner--dark" aria-hidden="true"></span>
          <p>Loading the University map…</p>
        </div>
        <section class="dest-sheet" data-card hidden aria-live="polite" aria-label="Selected place"></section>

        <div class="sheet" data-search-sheet role="dialog" aria-modal="true" aria-labelledby="search-title" hidden>
          <header class="sheet__bar">
            <h2 class="sheet__title" id="search-title">Where do you want to go?</h2>
            <button class="icon-btn" type="button" data-action="close-sheets" aria-label="Close search">${icon('close')}</button>
          </header>
          <div data-search></div>
        </div>

        <div class="sheet" data-info-sheet role="dialog" aria-modal="true" aria-labelledby="info-title" hidden>
          <header class="sheet__bar sheet__bar--end">
            <button class="icon-btn" type="button" data-action="close-sheets" aria-label="Close about">${icon('close')}</button>
          </header>
          ${infoSheetContent()}
        </div>
      </div>
    `,
  )

  const overlay = root.querySelector('[data-overlay]')
  const card = root.querySelector('[data-card]')
  const searchSheet = root.querySelector('[data-search-sheet]')
  const infoSheet = root.querySelector('[data-info-sheet]')

  const search = createDestinationSearch(root.querySelector('[data-search]'), {
    label: 'Search for a destination',
    onSelect: (dest) => {
      closeSheets({restoreFocus: false})
      select(dest)
      card.querySelector('.dest-sheet__name')?.focus({preventScroll: true})
    },
  })

  // ---------- full-height sheets ----------
  // Each open sheet is one history entry, so the phone's back button closes it.
  const SHEETS = {
    search: {element: searchSheet, opener: 'open-search'},
    info: {element: infoSheet, opener: 'open-info'},
  }
  const behindSheets = [root.querySelector('[data-map]'), root.querySelector('.map-home__top'), card, overlay]
  let shownSheet = null

  function showSheet(name) {
    shownSheet = name
    for (const [key, sheet] of Object.entries(SHEETS)) sheet.element.hidden = key !== name
    behindSheets.forEach((el) => el.toggleAttribute('inert', true))
  }

  function hideSheet({restoreFocus = true} = {}) {
    if (!shownSheet) return
    const opener = root.querySelector(`[data-action="${SHEETS[shownSheet].opener}"]`)
    shownSheet = null
    for (const sheet of Object.values(SHEETS)) sheet.element.hidden = true
    behindSheets.forEach((el) => el.toggleAttribute('inert', false))
    if (restoreFocus) opener?.focus({preventScroll: true})
  }

  function openSheet(name) {
    showSheet(name)
    window.history.pushState({sheet: name}, '')
  }

  function closeSheets(options) {
    if (!shownSheet) return
    hideSheet(options)
    if (window.history.state?.sheet) window.history.back()
  }

  const onHistory = () => {
    const wanted = window.history.state?.sheet ?? null
    if (wanted !== shownSheet) {
      if (wanted) showSheet(wanted)
      else hideSheet()
    }
    keepAddressInStep()
  }
  window.addEventListener('popstate', onHistory)

  // ---------- the chosen place ----------
  /** The address names the chosen place, so a reload or Back from the next screen keeps it. */
  function keepAddressInStep() {
    if (window.history.state?.sheet) return // waiting for the sheet's own history entry to go
    const query = new URLSearchParams()
    if (selected) query.set('to', selected.id)
    if (forced) query.set('force', '1')
    if (params.debug === '1') query.set('debug', '1')
    const text = query.toString()
    navigate(text ? `/?${text}` : '/', {replace: true, silent: true})
  }

  function select(dest) {
    if (selected?.id !== dest.id) clearRoute()
    selected = dest
    setCurrentDestination(dest) // a room from the search is not in our list: this finds it after a reload
    keepAddressInStep()
    drawCard()
    markSelectedPin()
    flyToSelected()
  }

  function unselect() {
    selected = null
    clearRoute()
    keepAddressInStep()
    card.hidden = true
    markSelectedPin()
  }

  function walkText() {
    const minutes = estimateWalkMinutes(fix, selected)
    return minutes == null ? 'On campus' : `About ${minutes} min walk`
  }

  function drawCard() {
    if (!selected) {
      card.hidden = true
      return
    }
    const room = selected.category === 'room' ? describeDestination(selected) : ''
    render(
      card,
      html`
        ${selected.photo ? html`<img class="dest-sheet__photo" src="${selected.photo}" alt="" loading="lazy" />` : ''}
        <div class="dest-sheet__head">
          <div class="dest-sheet__text">
            <h2 class="dest-sheet__name" tabindex="-1">${selected.name}</h2>
            <p class="dest-sheet__meta">${room || categoryLabel(selected.category)}</p>
            <p class="dest-sheet__walk" data-walk>${icon('footsteps', {size: 16})}<span data-walk-text>${walkText()}</span></p>
          </div>
          <button class="icon-btn" type="button" data-action="unselect" aria-label="Close">${icon('close', {size: 20})}</button>
        </div>
        <button class="btn btn--primary btn--block" type="button" data-action="walk" aria-label="Walk here in AR">
          ${icon('camera')}<span>Walk here in AR</span>
        </button>
        <button class="dest-sheet__link" type="button" data-action="route" aria-expanded="false" data-route-link>Show route on map</button>
      `,
    )
    card.hidden = false
  }

  function refreshWalkText() {
    const text = root.querySelector('[data-walk-text]')
    if (text && selected && !root.querySelector('[data-route-link][aria-expanded="true"]')) text.textContent = walkText()
  }

  // ---------- location, only if the phone has already allowed it ----------
  function ensureWatch() {
    if (stopWatch) return
    stopWatch = watchLocation({
      onFix: (position) => {
        const c = position.coords
        fix = {lat: c.latitude, lng: c.longitude, accuracy: c.accuracy}
        refreshWalkText()
        fixWaiters.splice(0).forEach((w) => w.resolve(fix))
        if (c.accuracy <= GOOD_ENOUGH_FIX_M) stopLocation()
      },
      onError: (code) => {
        fixWaiters.splice(0).forEach((w) => w.reject(code))
        stopLocation()
      },
    })
  }

  function stopLocation() {
    stopWatch?.()
    stopWatch = null
  }

  function currentFix() {
    if (fix) return Promise.resolve(fix)
    return new Promise((resolve, reject) => {
      fixWaiters.push({resolve, reject})
      ensureWatch()
    })
  }

  // ---------- route on the map ----------
  function clearRoute() {
    routeRequest += 1
    const map = instance?.map
    if (!map) return
    if (map.getLayer?.(ROUTE_ID)) map.removeLayer(ROUTE_ID)
    if (map.getSource?.(ROUTE_ID)) map.removeSource(ROUTE_ID)
  }

  function setRouteLink(text, expanded = false) {
    const link = root.querySelector('[data-route-link]')
    if (!link) return
    link.textContent = text
    link.setAttribute('aria-expanded', String(expanded))
  }

  function drawRoute(points) {
    const map = instance.map
    const Mazemap = window.Mazemap
    const coordinates = points.map((p) => [p.lng, p.lat])
    map.addSource(ROUTE_ID, {type: 'geojson', data: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}})
    map.addLayer({
      id: ROUTE_ID,
      type: 'line',
      source: ROUTE_ID,
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': BRAND_GREEN, 'line-width': 6, 'line-opacity': 0.9},
    })
    const bounds = coordinates.reduce((b, c) => b.extend(c), new Mazemap.mapboxgl.LngLatBounds(coordinates[0], coordinates[0]))
    map.fitBounds(bounds, {padding: {top: 150, bottom: card.offsetHeight + 40, left: 40, right: 40}, maxZoom: 18})
  }

  async function toggleRoute() {
    if (root.querySelector('[data-route-link][aria-expanded="true"]')) {
      clearRoute()
      setRouteLink('Show route on map')
      refreshWalkText()
      return
    }
    if (!instance?.map) return showToast('The map is still loading')
    const request = ++routeRequest
    const dest = selected
    setRouteLink('Finding your route…')
    try {
      const from = await currentFix()
      const route = await planRoute(from, dest)
      if (disposed || request !== routeRequest) return
      if (route.status === 'off-campus') {
        setRouteLink('Show route on map')
        return showToast('Routes start once you are on campus', {tone: 'warning'})
      }
      drawRoute(route.points)
      setRouteLink('Hide route', true)
      root.querySelector('[data-walk-text]').textContent = `About ${route.minutes} min walk`
      if (route.source === 'direct') showToast('Approximate route - no path found', {tone: 'warning'})
    } catch (err) {
      if (disposed || request !== routeRequest) return
      console.warn('[home] route failed', err)
      setRouteLink('Show route on map')
      showToast(err === 'denied' ? 'Turn on location to see the route' : 'Could not plan a route. Try again.', {tone: 'warning'})
    }
  }

  // ---------- pins ----------
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
      select(dest)
    })
    const marker = new Mazemap.mapboxgl.Marker({element}).setLngLat({lng: dest.lng, lat: dest.lat}).addTo(instance.map)
    // The map library labels markers as images; these are buttons.
    element.setAttribute('role', 'button')
    return marker
  }

  function addPins() {
    for (const dest of DESTINATIONS) pins.set(dest.id, makePin(dest))
    applyFilter()
  }

  function applyFilter() {
    for (const dest of DESTINATIONS) {
      const el = pins.get(dest.id)?.getElement()
      if (el) el.hidden = !matchesFilter(dest, filter)
    }
    markSelectedPin()
  }

  function markSelectedPin() {
    tempPin?.remove()
    tempPin = null
    // A room from the search has no permanent pin.
    if (selected && !pins.has(selected.id) && instance?.map && pins.size && Number.isFinite(selected.lat)) tempPin = makePin(selected)
    root.querySelectorAll('.map-pin').forEach((el) => {
      const on = el.dataset.pin === selected?.id
      el.classList.toggle('is-selected', on)
      if (on) el.hidden = false
    })
  }

  function setFilter(next) {
    filter = filter === next ? null : next
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)))
    applyFilter()
    fitToFilter()
  }

  function fitToFilter() {
    const map = instance?.map
    const Mazemap = window.Mazemap
    if (!map || !filter) return
    const shown = DESTINATIONS.filter((d) => matchesFilter(d, filter))
    if (!shown.length) return
    const first = [shown[0].lng, shown[0].lat]
    const bounds = shown.reduce((b, d) => b.extend([d.lng, d.lat]), new Mazemap.mapboxgl.LngLatBounds(first, first))
    map.fitBounds(bounds, {padding: {top: 170, bottom: 80, left: 50, right: 50}, maxZoom: 16.5})
  }

  function flyToSelected() {
    const map = instance?.map
    if (!map || !selected || !Number.isFinite(selected.lat)) return
    if (selected.floor != null && typeof map.setZLevel === 'function') map.setZLevel(selected.floor)
    // Leave room for the search bar above and the card below.
    map.flyTo({
      center: {lng: selected.lng, lat: selected.lat},
      zoom: selected.category === 'room' ? 19 : 17,
      padding: {top: 140, bottom: card.offsetHeight + 24},
      speed: 1.4,
    })
  }

  // ---------- map loading ----------
  function showMapError(err) {
    if (disposed) return
    const offline = err?.code === 'offline' || navigator.onLine === false
    overlay.hidden = false
    render(
      overlay,
      html`
        <div class="map-home__error" role="alert">
          <span class="error-state__icon" data-tone="warn">${icon(offline ? 'wifiOff' : 'map', {size: 28})}</span>
          <h2>${offline ? 'You are offline' : 'The map could not load'}</h2>
          <p>${offline ? 'Connect to Wi-Fi or mobile data and try again.' : 'Check your connection and try again.'}</p>
          <button class="btn btn--primary btn--block" type="button" data-action="retry" aria-label="Try again">
            ${icon('refresh')}<span>Try again</span>
          </button>
          <a class="btn btn--secondary btn--block" aria-label="Open the full campus map" href="${APP.campusMapUrl}" target="_blank" rel="noopener">
            ${icon('external')}<span>Open the full campus map</span>
          </a>
        </div>
      `,
    )
  }

  async function load() {
    render(
      overlay,
      html`<span class="spinner spinner--dark" aria-hidden="true"></span>
        <p>Loading the University map…</p>`,
    )
    overlay.hidden = false
    try {
      const Mazemap = await loadMazeMap()
      if (disposed) return
      instance?.destroy()
      pins.clear()
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        onReady: () => {
          if (disposed) return
          overlay.hidden = true
          addPins()
          instance.map.on('click', () => {
            if (selected) unselect()
          })
          flyToSelected()
        },
      })
    } catch (err) {
      console.warn('[home] map load failed', err)
      showMapError(err)
    }
  }

  // ---------- actions ----------
  const off = onAction(root, {
    'open-search': () => {
      openSheet('search')
      // Inside the tap, or iPhone will not open the keyboard.
      search.focus()
    },
    'open-info': () => {
      openSheet('info')
      infoSheet.querySelector('#info-title').focus({preventScroll: true})
    },
    'close-sheets': () => closeSheets(),
    filter: (_, target) => setFilter(target.dataset.filter),
    unselect: () => {
      unselect()
      root.querySelector('[data-action="open-search"]').focus({preventScroll: true}) // its button has gone
    },
    retry: () => load(),
    route: () => toggleRoute(),
    walk: () => {
      // First, inside the tap: iPhone only shows the motion prompt here.
      if (!deviceIssue(forced)) startPermissionRequests()
      setCurrentDestination(selected)
      const next = new URLSearchParams({to: selected.id})
      if (forced) next.set('force', '1')
      if (params.debug === '1') next.set('debug', '1')
      navigate(`/locate?${next}`)
    },
  })

  const onKey = (event) => {
    if (event.key === 'Escape') closeSheets()
  }
  document.addEventListener('keydown', onKey)

  drawCard()
  load()
  // A reload keeps the history entry of a sheet that was open.
  if (window.history.state?.sheet) showSheet(window.history.state.sheet)
  locationPermissionState().then((state) => {
    if (!disposed && state === 'granted' && !(fix?.accuracy <= GPS.goodAccuracyM)) ensureWatch()
  })

  return () => {
    disposed = true
    off()
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('popstate', onHistory)
    search.destroy()
    stopLocation()
    fixWaiters = []
    tempPin?.remove()
    instance?.destroy()
  }
}
