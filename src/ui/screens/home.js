// Home is the campus map: pins, a search bar, category chips and a card for the chosen place.
// #/?to=<id> opens with a place selected.
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {clearRouteLine, drawRouteLine} from '../../map/route-line.js'
import {createDestinationSearch} from '../components/destination-search.js'
import {createMapPicker} from '../components/map-picker.js'
import {createMapPins} from '../components/map-pins.js'
import {createHomeSheet} from '../components/home-sheet.js'
import {showToast} from '../components/toast.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {createFixWatch, locationPermissionState, readTripFix} from '../../geo/location.js'
import {findDestination, setCurrentDestination} from '../../map/destinations.js'
import {estimateWalkMinutes, planRoute} from '../../route/route.js'
import {
  addRecentStart,
  clearRecentStarts,
  entrancesOf,
  getRecentStarts,
  getStart,
  GPS_START,
  isManual,
  placeById,
  PLACE_LIST,
  setStart,
  startAsDestination,
  startFromPin,
  startFromPlace,
  startLabel,
} from '../../route/start-point.js'
import {onAction, render} from '../dom.js'
import {GPS, START} from '../../config.js'
import {createSheets} from './home-sheets.js'
import {doorList, homePage, mapError, mapLoading, placeCard} from './home-view.js'

export function homeScreen(root, {navigate, params}) {
  const forced = params.force === '1'
  let instance = null
  let selected = findDestination(params.to)
  let routeRequest = 0
  let disposed = false
  let enginePrefetched = false
  let startMarker = null
  // The 3D campus model: loaded the first time 3D is turned on (it is a 6 MB download).
  let model = null
  let modelLoad = null
  let show3d = false
  // ?simulate=1 (before or after the #): a fake walk to the chosen place, to test the AR arrow.
  const simulate = params.simulate === '1' || new URLSearchParams(window.location.search).get('simulate') === '1'
  let sim = null
  // ?debug=align: the model see-through over MazeMap, its origin, and click coordinates.
  const debugAlign = params.debug === 'align' || new URLSearchParams(window.location.search).get('debug') === 'align'
  let alignDebug = null

  render(root, homePage())

  const overlay = root.querySelector('[data-overlay]')
  const card = root.querySelector('[data-card]')
  const searchSheet = root.querySelector('[data-search-sheet]')
  const infoSheet = root.querySelector('[data-info-sheet]')
  const startSheet = root.querySelector('[data-start-sheet]')
  const startSearch = createDestinationSearch(root.querySelector('[data-start-search]'), {
    label: 'Search for a starting point',
    placeholder: 'Building, entrance or place',
    places: PLACE_LIST,
    searchRooms: false,
    recent: {get: getRecentStarts, add: addRecentStart, clear: clearRecentStarts},
    onSelect: (place) => chooseStartPlace(placeById(place.id) ?? place),
  })
  const search = createDestinationSearch(root.querySelector('[data-search]'), {
    label: 'Search for a destination',
    onSelect: (dest) => {
      sheets.close({restoreFocus: false})
      select(dest)
      card.querySelector('.dest-sheet__name')?.focus({preventScroll: true})
    },
  })
  const sheets = createSheets(
    root,
    {
      search: {element: searchSheet, opener: 'open-search'},
      info: {element: infoSheet, opener: 'open-info'},
      start: {element: startSheet, opener: 'open-start'},
    },
    [root.querySelector('[data-map]'), root.querySelector('.map-home__top'), root.querySelector('[data-rail]'), root.querySelector('[data-home-sheet]'), card, overlay],
    keepAddressInStep,
  )
  const picker = createMapPicker(root.querySelector('[data-pick-bar]'))
  const pins = createMapPins(root, {
    getMap: () => instance?.map,
    getSelected: () => selected,
    canSelect: () => !picker.active,
    onSelect: select,
  })
  const homeSheet = createHomeSheet(root, {
    getMap: () => instance?.map,
    // Nearest to the user when we know where they are, else to the middle of the map.
    getFrom: () => {
      const fix = fixWatch.fix
      if (fix && fix.accuracy <= GPS.goodEnoughFixM) return {point: fix, isUser: true}
      const c = instance?.map?.getCenter()
      return {point: c ? {lat: c.lat, lng: c.lng} : null, isUser: false}
    },
    pins,
    onPick: (dest) => select(dest),
  })
  const menu = root.querySelector('[data-menu]')
  const menuButton = root.querySelector('[data-action="open-menu"]')
  function setMenu(open) {
    menu.hidden = !open
    menuButton.setAttribute('aria-expanded', String(open))
    if (open) menu.querySelector('[role="menuitem"]')?.focus({preventScroll: true})
  }
  const onOutside = (event) => {
    if (!menu.hidden && !event.target.closest('[data-menu], [data-action="open-menu"]')) setMenu(false)
  }
  document.addEventListener('pointerdown', onOutside)

  /** MazeMap's floor bar goes in the right-hand rail; north only shows on a turned map. */
  function fitControls() {
    const bar = root.querySelector('.mm-floor-bar')
    const host = root.querySelector('[data-floor-host]')
    if (bar && host && bar.parentElement !== host) host.append(bar)
    const north = root.querySelector('[data-north]')
    const map = instance?.map
    const paintNorth = () => {
      north.hidden = Math.abs(map.getBearing()) < 1
    }
    map.on('rotate', paintNorth)
    paintNorth()
  }

  // Location, only if the phone has already allowed it.
  const fixWatch = createFixWatch(readTripFix(), {
    onFix: () => {
      refreshWalkText()
      paintStart()
    },
    onTrouble: () => paintStart(),
  })

  // ---------- the chosen place ----------
  /** The address names the chosen place, so a reload or Back from the next screen keeps it. */
  function keepAddressInStep() {
    if (window.history.state?.sheet) return // waiting for the sheet's own history entry to go
    const query = new URLSearchParams()
    if (selected) query.set('to', selected.id)
    if (forced) query.set('force', '1')
    if (params.debug === '1' || params.debug === 'align') query.set('debug', params.debug)
    if (params.simulate === '1') query.set('simulate', '1')
    if (params.fieldtest === '1') query.set('fieldtest', '1')
    const text = query.toString()
    navigate(text ? `/?${text}` : '/', {replace: true, silent: true})
  }

  function select(dest) {
    if (selected?.id !== dest.id) clearRoute()
    selected = dest
    setCurrentDestination(dest) // a room from the search is not in our list: this finds it after a reload
    keepAddressInStep()
    drawCard()
    pins.markSelected()
    flyToSelected()
    highlightIn3d()
    startSimulation()
  }

  function unselect() {
    selected = null
    clearRoute()
    keepAddressInStep()
    card.hidden = true
    pins.markSelected()
    model?.highlight(null)
    stopSimulation()
  }

  // ---------- ?simulate=1: test the AR arrow on a laptop ----------
  function startSimulation() {
    stopSimulation()
    const map = instance?.map
    if (!simulate || !map || disposed) return
    if (!selected) {
      showToast('Test mode: pick a place to watch a simulated walk to it')
      return
    }
    const start = getStart()
    const dest = selected
    const token = {}
    sim = token
    import('../../map/simulate.js').then(({createSimulator, SIM_START}) => {
      if (sim !== token || disposed || instance?.map !== map) return
      sim = createSimulator(map, {from: isManual(start) ? {lat: start.lat, lng: start.lng} : SIM_START, dest, host: root})
    })
  }

  function stopSimulation() {
    sim?.destroy?.()
    sim = null
  }

  // ---------- ?debug=align: does the 3D model sit on MazeMap's floor plan? ----------
  async function startAlignDebug() {
    stopAlignDebug()
    const map = instance?.map
    if (!debugAlign || !map || disposed) return
    show3d = true
    paint3dButton(!model)
    try {
      const [loaded, {createAlignDebug}] = await Promise.all([loadModel(map), import('../../map/align-debug.js')])
      if (!loaded || disposed || instance?.map !== map) return
      loaded.setOpacity(0.5)
      loaded.setVisible(true)
      highlightIn3d()
      paint3dButton()
      alignDebug = createAlignDebug(map, {model: loaded, host: root})
    } catch (err) {
      console.warn('[home] alignment check could not load the model', err)
      show3d = false
      paint3dButton()
      showToast('Could not load the 3D buildings. Try again.', {tone: 'warning'})
    }
  }

  function stopAlignDebug() {
    alignDebug?.destroy()
    alignDebug = null
  }

  // ---------- 3D buildings ----------
  function paint3dButton(loading = false) {
    const button = root.querySelector('[data-action="toggle-3d"]')
    button.setAttribute('aria-pressed', String(show3d))
    button.setAttribute('aria-label', show3d ? 'Hide 3D buildings' : 'Show 3D buildings')
    button.toggleAttribute('aria-busy', loading)
    button.querySelector('[data-3d-label]').hidden = loading
    button.querySelector('[data-3d-spinner]').hidden = !loading
    button.querySelector('[data-3d-label]').textContent = show3d ? '2D' : '3D'
  }

  function loadModel(map) {
    modelLoad ??= import('../../map/campus-model.js')
      .then(({createCampusModel}) => createCampusModel(map, window.Mazemap.mapboxgl))
      .then((loaded) => {
        if (disposed || instance?.map !== map) {
          loaded.destroy()
          return null
        }
        model = loaded
        if (params.debug === '1' || debugAlign) window.__campusModel = model // inspect it from the console
        return model
      })
      .catch((err) => {
        modelLoad = null // let the next tap try again
        throw err
      })
    return modelLoad
  }

  async function toggle3d() {
    const map = instance?.map
    if (!map) return
    show3d = !show3d
    if (!show3d) {
      paint3dButton()
      model?.setVisible(false)
      map.easeTo({pitch: 0, duration: 600})
      return
    }
    paint3dButton(!model)
    try {
      const loaded = await loadModel(map)
      if (!loaded || disposed || !show3d) return
      loaded.setVisible(true)
      highlightIn3d()
      map.easeTo({pitch: 50, duration: 800})
    } catch (err) {
      console.warn('[home] 3D model failed', err)
      show3d = false
      showToast('Could not load the 3D buildings. Try again.', {tone: 'warning'})
    } finally {
      if (!disposed) paint3dButton()
    }
  }

  /** The chosen room, coloured in the model. A place from our list may not say its floor: the model does. */
  function highlightIn3d() {
    if (!model || !show3d) return
    const level = model.highlight(selected?.mazemapPoi)
    const map = instance?.map
    if (level != null && selected?.floor == null && map?.getZLevel?.() !== level) map.setZLevel(level)
  }

  function walkText() {
    const start = getStart()
    const minutes = estimateWalkMinutes(isManual(start) ? start : fixWatch.fix, selected)
    return minutes == null ? 'On campus' : `About ${minutes} min walk`
  }

  // ---------- the starting point ----------
  function gpsText() {
    const {fix} = fixWatch
    if (fix) return `Current location · ±${Math.round(fix.accuracy)} m`
    return fixWatch.watching ? 'Locating you…' : 'Current location'
  }

  function paintStart() {
    const {fix, trouble} = fixWatch
    const start = getStart()
    const manual = isManual(start)
    const text = root.querySelector('[data-start-text]')
    if (text) text.textContent = manual ? startLabel(start) : gpsText()
    const prompt = root.querySelector('[data-start-prompt]')
    if (prompt) prompt.hidden = manual || !(trouble || fix?.accuracy > START.weakGpsM)
    const live = root.querySelector('[data-action="start-gps"][data-live]')
    if (live) live.hidden = !manual || !(fix?.accuracy <= START.liveGpsM)
    const row = root.querySelector('.route-from__row')
    row?.setAttribute('aria-label', `Starting point: ${manual ? startLabel(start) : gpsText()}. Change`)
    const sheetText = root.querySelector('[data-start-gps-text]')
    if (sheetText) sheetText.textContent = fix ? `Accurate to ±${Math.round(fix.accuracy)} m` : trouble ? 'Not available right now' : 'Use GPS'
    paintStartMarker()
  }

  function paintStartMarker() {
    const start = getStart()
    startMarker?.remove()
    startMarker = null
    if (!isManual(start) || !instance?.map) return
    const element = document.createElement('div')
    element.className = 'map-start'
    startMarker = new window.Mazemap.mapboxgl.Marker({element}).setLngLat({lng: start.lng, lat: start.lat}).addTo(instance.map)
  }

  function useStart(start) {
    setStart(start)
    clearRoute()
    setRouteLink('Show route on map')
    sheets.close({restoreFocus: false})
    showDoors(null)
    paintStart()
    refreshWalkText()
    root.querySelector('.route-from__row')?.focus({preventScroll: true})
  }

  function chooseStartPlace(place) {
    const doors = entrancesOf(place)
    if (doors.length > 1) showDoors(place)
    else useStart(startFromPlace(place, doors[0]))
  }

  /** A place with several entrances: which one are you at? */
  function showDoors(place) {
    const doors = root.querySelector('[data-start-doors]')
    root.querySelector('[data-start-choices]').hidden = Boolean(place)
    doors.hidden = !place
    if (!place) return
    doors.dataset.place = place.id
    render(doors, doorList(place))
    doors.querySelector('h3').focus({preventScroll: true})
  }

  function swapEnds() {
    const start = getStart()
    const {fix} = fixWatch
    if (!selected) return
    const here = isManual(start) ? startAsDestination(start) : fix && {id: 'your-location', name: 'Your location', category: 'landmark', building: '', floor: null, lat: fix.lat, lng: fix.lng}
    if (!here) return showToast('Still finding you. Choose a starting point to swap.', {tone: 'warning'})
    const place = placeById(selected.id)
    useStart(place ? startFromPlace(place) : startFromPin(selected))
    select(here)
  }

  // ---------- pick on the map ----------
  function enterPick() {
    if (!instance?.map) return showToast('The map is still loading', {tone: 'warning'})
    sheets.close({restoreFocus: false})
    showDoors(null)
    card.hidden = true
    root.querySelector('.map-home').dataset.picking = ''
    const start = getStart()
    const c = instance.map.getCenter()
    picker.enter(instance.map, isManual(start) ? start : fixWatch.fix || {lat: c.lat, lng: c.lng})
  }

  function leavePick() {
    picker.leave()
    delete root.querySelector('.map-home').dataset.picking
    drawCard()
  }

  /** Fetch the AR engine ahead of time, so the camera opens at once. The camera itself waits for a tap. */
  function prefetchEngine() {
    if (enginePrefetched || deviceIssue(forced) || navigator.connection?.saveData) return
    enginePrefetched = true
    const load = () => import('../../ar/engine.js').then((engine) => engine.loadEngine()).catch(() => {})
    if (window.requestIdleCallback) window.requestIdleCallback(load)
    else setTimeout(load, 500)
  }

  function drawCard() {
    if (!selected) {
      card.hidden = true
      return
    }
    render(card, placeCard(selected, walkText()))
    card.hidden = false
    paintStart()
    prefetchEngine()
  }

  function refreshWalkText() {
    const text = root.querySelector('[data-walk-text]')
    if (text && selected && !root.querySelector('[data-route-link][aria-expanded="true"]')) text.textContent = walkText()
  }

  function openStartSheet() {
    showDoors(null)
    sheets.open('start')
    paintStart()
    startSheet.querySelector('#start-title').focus({preventScroll: true})
  }

  // ---------- route on the map ----------
  function clearRoute() {
    routeRequest += 1
    if (instance?.map) clearRouteLine(instance.map)
  }

  function setRouteLink(text, expanded = false) {
    const link = root.querySelector('[data-route-link]')
    if (!link) return
    link.textContent = text
    link.setAttribute('aria-expanded', String(expanded))
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
      const start = getStart()
      const from = isManual(start) ? start : await fixWatch.current()
      const route = await planRoute(from, dest)
      if (disposed || request !== routeRequest) return
      if (route.status === 'off-campus') {
        setRouteLink('Show route on map')
        return showToast('Routes start once you are in Stirling', {tone: 'warning'})
      }
      drawRouteLine(instance.map, route.points, card.offsetHeight + 40)
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
    overlay.hidden = false
    render(overlay, mapError(err?.code === 'offline' || navigator.onLine === false))
  }

  async function load() {
    render(overlay, mapLoading())
    overlay.hidden = false
    try {
      const Mazemap = await loadMazeMap()
      if (disposed) return
      stopSimulation()
      stopAlignDebug()
      model?.destroy()
      model = null
      modelLoad = null
      show3d = false
      paint3dButton()
      instance?.destroy()
      pins.clear()
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        onReady: () => {
          if (disposed) return
          overlay.hidden = true
          pins.addAll()
          fitControls()
          homeSheet.mapReady()
          instance.map.on('click', (event) => {
            if (picker.active) picker.moveTo(event.lngLat)
            else if (selected) unselect()
          })
          flyToSelected()
          paintStartMarker()
          if (params.start === 'pick' && selected) openStartSheet()
          startSimulation()
          startAlignDebug()
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
      sheets.open('search')
      // Inside the tap, or iPhone will not open the keyboard.
      search.focus()
    },
    'open-start': () => openStartSheet(),
    'start-gps': () => {
      useStart(GPS_START)
      locationPermissionState().then((state) => {
        if (!disposed && state === 'granted') fixWatch.ensure()
      })
    },
    'start-pick': () => enterPick(),
    'start-door': (_, target) => {
      const place = placeById(root.querySelector('[data-start-doors]').dataset.place)
      const door = place && entrancesOf(place).find((d) => d.id === target.dataset.door)
      if (door) useStart(startFromPlace(place, door))
    },
    swap: () => swapEnds(),
    'pick-confirm': () => {
      if (!picker.point) return
      const start = startFromPin(picker.point)
      leavePick()
      useStart(start)
    },
    'pick-cancel': () => leavePick(),
    'open-info': () => {
      setMenu(false)
      sheets.open('info')
      infoSheet.querySelector('#info-title').focus({preventScroll: true})
    },
    'close-sheets': () => sheets.close(),
    filter: (_, target) => homeSheet.choose(target.dataset.filter),
    'sheet-step': () => homeSheet.step(),
    'open-menu': () => setMenu(menu.hidden),
    locate: () => instance?.geolocate?.trigger(),
    north: () => instance?.map.easeTo({bearing: 0, duration: 400}),
    unselect: () => {
      unselect()
      root.querySelector('[data-action="open-search"]').focus({preventScroll: true}) // its button has gone
    },
    retry: () => load(),
    'toggle-3d': () => toggle3d(),
    route: () => toggleRoute(),
    walk: () => {
      // First, inside the tap: iPhone only shows the motion prompt here.
      if (!deviceIssue(forced)) startPermissionRequests({gps: !isManual(getStart())})
      setCurrentDestination(selected)
      const next = new URLSearchParams({to: selected.id})
      if (forced) next.set('force', '1')
      if (params.debug === '1') next.set('debug', '1')
      if (params.fieldtest === '1') next.set('fieldtest', '1')
      navigate(`/locate?${next}`)
    },
  })

  const onKey = (event) => {
    if (event.key !== 'Escape') return
    if (!menu.hidden) setMenu(false)
    else sheets.close()
  }
  document.addEventListener('keydown', onKey)

  drawCard()
  load()
  // A reload keeps the history entry of a sheet that was open.
  if (window.history.state?.sheet) sheets.show(window.history.state.sheet)
  locationPermissionState().then((state) => {
    if (!disposed && state === 'granted' && !(fixWatch.fix?.accuracy <= GPS.goodAccuracyM)) fixWatch.ensure()
  })

  return () => {
    disposed = true
    off()
    document.removeEventListener('keydown', onKey)
    sheets.destroy()
    search.destroy()
    startSearch.destroy()
    if (picker.active) picker.leave()
    startMarker?.remove()
    fixWatch.destroy()
    pins.destroy()
    homeSheet.destroy()
    document.removeEventListener('pointerdown', onOutside)
    stopSimulation()
    stopAlignDebug()
    model?.destroy()
    instance?.destroy()
  }
}
