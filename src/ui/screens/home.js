// Home is the campus map: pins, a search bar, category chips and a card for the chosen place.
// #/?to=<id> opens with a place selected.
import {createCampusMap, loadMazeMap, planWhenStyleLoaded, quietIndoorLabels} from '../../map/mazemap.js'
import {clearRouteLine, drawRouteLine} from '../../map/route-line.js'
import {createLabelBlockers} from '../../map/label-blockers.js'
import {campusBounds, createMapViewport, measureViewport, paddingFor} from '../../map/map-viewport.js'
import {isOnCampus} from '../../route/route.js'
import {createMapTrip} from '../components/map-trip.js'
import {createDestinationSearch} from '../components/destination-search.js'
import {createMapPicker} from '../components/map-picker.js'
import {createMapPins} from '../components/map-pins.js'
import {createHomeSheet} from '../components/home-sheet.js'
import {showToast} from '../components/toast.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {markSeen} from '../first-use.js'
import {createFixWatch, locationPermissionState, readTripFix} from '../../geo/location.js'
import {addRecent, DESTINATIONS, findDestination, setCurrentDestination} from '../../map/destinations.js'
import {fetchPoiDestination, poiIdFrom} from '../../map/poi-lookup.js'
import {entranceOf, estimateWalkMinutes, getStepFree, planRoute, saveTripRoute, setStepFree, tripLengthM} from '../../route/route.js'
import {entranceNameFor, estimatedWalkM, indoorLines, locationApproximate, walkSummary} from '../../route/card-text.js'
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
import {GPS, HOME_MAP, INDOOR, START} from '../../config.js'
import {createSheets} from './home-sheets.js'
import {doorList, homePage, mapError, mapLoading, placeCard, placeLoading, placeNotFound} from './home-view.js'
import {prefersReducedMotion} from '../components/arrival.js'

const MAP_LOADING_FADE_MS = 300 // the loading screen fades out over this when the map is ready

export function homeScreen(root, {navigate, params}) {
  const forced = params.force === '1'
  let instance = null
  let mapReady = false // the map's style has loaded: it can take the route line
  let labelBlockers = null // keeps labels clear of the logos, and the logos above the sheet or card
  let viewport = null // the map's padding, kept equal to what the search bar and the sheet leave visible
  let selected = findDestination(params.to)
  let cardRoute = null // the route planned for the card (door, level, whole distance)
  let planningFor = null // the destination a quiet plan is running for
  let planGeneration = 0 // discard a route if the selected start changed while it was loading
  let choosingIndoorStart = false
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
  const debugWalls = params.debug === 'walls' || new URLSearchParams(window.location.search).get('debug') === 'walls'
  const debugScene = params.debug === 'scene' || new URLSearchParams(window.location.search).get('debug') === 'scene'
  const debugRoute = params.debug === 'route' || new URLSearchParams(window.location.search).get('debug') === 'route'
  let alignDebug = null

  render(root, homePage())

  const overlay = root.querySelector('[data-overlay]')
  const card = root.querySelector('[data-card]')
  const searchSheet = root.querySelector('[data-search-sheet]')
  const infoSheet = root.querySelector('[data-info-sheet]')
  const startSheet = root.querySelector('[data-start-sheet]')
  const startSearch = createDestinationSearch(root.querySelector('[data-start-search]'), {
    label: 'Search for a starting point',
    placeholder: 'Room, building, entrance or place',
    places: PLACE_LIST,
    searchRooms: true,
    recent: {get: getRecentStarts, add: addRecentStart, clear: clearRecentStarts},
    onSelect: (place) => {
      const fullPlace = placeById(place.id) ?? place
      if (choosingIndoorStart) {
        choosingIndoorStart = false
        if (fullPlace.category !== 'room' || !Number.isFinite(fullPlace.floor)) {
          showToast('Choose a room result with a floor number for indoor AR.', {tone: 'warning'})
          return
        }
      }
      chooseStartPlace(fullPlace)
    },
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
    onPick: (dest, {go = false} = {}) => {
      select(dest)
      if (go) focusGo()
    },
  })

  /** The card's Go button, ready to tap (shortcuts, Recent and ?go=1 links). */
  function focusGo() {
    requestAnimationFrame(() => root.querySelector('[data-go]')?.focus({preventScroll: true}))
  }
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
      mapTrip?.update(fixWatch.fix)
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
    if (params.debug === '1' || params.debug === 'align' || params.debug === 'walls' || params.debug === 'scene' || params.debug === 'route') query.set('debug', params.debug)
    if (params.simulate === '1') query.set('simulate', '1')
    if (params.fieldtest === '1') query.set('fieldtest', '1')
    if (params.fieldlog === '1') query.set('fieldlog', '1')
    const text = query.toString()
    navigate(text ? `/?${text}` : '/', {replace: true, silent: true})
  }

  function select(dest) {
    if (selected?.id !== dest.id) {
      clearRoute()
      cardRoute = null
    }
    selected = dest
    // Fix 1: a room's floor plan starts downloading now, so it is cached when the user taps Go.
    import('../../scene/scene-load.js').then(({prefetchFloors}) => prefetchFloors(dest)).catch(() => {})
    setCurrentDestination(dest) // a room from the search is not in our list: this finds it after a reload
    addRecent(dest) // "Recent" in the sheet at rest: the last 3 places, however they were picked
    homeSheet?.refreshRest()
    keepAddressInStep()
    drawCard()
    pins.markSelected()
    flyToSelected()
    highlightIn3d()
    startSimulation()
  }

  function unselect() {
    endMapTrip()
    selected = null
    clearRoute()
    keepAddressInStep()
    card.hidden = true
    pins.markSelected()
    model?.highlight(null)
    stopSimulation()
    backToCampus()
  }

  // ---------- ?simulate=1: test the AR arrow on a laptop ----------
  function startSimulation() {
    stopSimulation()
    const map = instance?.map
    if (!simulate || !map || disposed) return
    // ?simulate=1&replay=1 (Phase 1): replay a downloaded trip log instead of a made-up walk.
    if (params.replay === '1' || new URLSearchParams(window.location.search).get('replay') === '1') {
      const token = {}
      sim = token
      import('../../map/replay-viewer.js').then(({createReplayViewer}) => {
        if (sim !== token || disposed || instance?.map !== map) return
        sim = createReplayViewer(map, {host: root.querySelector('.map-home') || root})
      })
      return
    }
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

  /** "1 min · 95 m": the planned route once there is one (to the room itself), else an estimate. */
  function walkText() {
    const start = getStart()
    const from = isManual(start) ? start : fixWatch.fix
    // One number, the same as in AR: the planned route. The straight-line estimate only if planning fails.
    if (cardRoute) return walkSummary(tripLengthM(cardRoute)) ?? 'On campus'
    if (planningFor === selected) return 'Working out the walk…'
    if (!from || estimateWalkMinutes(from, selected) == null) return 'On campus'
    return walkSummary(estimatedWalkM(from, entranceOf(selected))) ?? 'On campus'
  }

  /**
   * ?debug=walls: list where the MazeMap route walks through a wall away from a door (report only).
   */
  /** ?debug=scene (Step 1): build the 3D navigation scene for this route and show what it holds. */
  async function checkScene(route) {
    if (!debugScene || !selected || !route?.points) return
    const name = selected.name
    const points = [...route.points, ...(route.indoorPoints || []).slice(1)]
    const host = root.querySelector('.map-home') || root
    const {showSceneReport} = await import('../../scene/scene-debug.js')
    showSceneReport(host, null, {name})
    try {
      const {loadScene} = await import('../../scene/scene-load.js')
      const scene = await loadScene(points)
      if (!disposed) showSceneReport(host, instance?.map, {name, scene})
    } catch (err) {
      if (!disposed) showSceneReport(host, null, {name, error: 'Could not build the scene: ' + (err?.message || err)})
    }
  }

  async function checkWalls(route) {
    checkScene(route)
    if (debugRoute && selected) {
      const {showRouteReport} = await import('../../scene/scene-debug.js')
      if (!disposed) showRouteReport(root.querySelector('.map-home') || root, instance?.map, {name: selected.name, route})
    }
    if (!debugWalls || !selected || !route?.points) return
    const name = selected.name
    const points = [...route.points, ...(route.indoorPoints || [])]
    const host = root.querySelector('.map-home') || root
    try {
      const {checkRouteWalls, showWallsReport} = await import('../../map/walls-debug.js')
      showWallsReport(host, {name, crossings: [], error: 'Checking…'})
      const crossings = await checkRouteWalls(points)
      if (!disposed) showWallsReport(host, {name, crossings})
    } catch (err) {
      const {showWallsReport} = await import('../../map/walls-debug.js')
      if (!disposed) showWallsReport(host, {name, crossings: [], error: 'Could not load the walls: ' + (err?.message || err)})
    }
  }

  /**
   * A trip that is all indoors (hardly any walking outside before the door): no AR, the indoor
   * map straight away, and the button reads "Show the way".
   */
  function indoorTrip() {
    return Boolean(selected?.category === 'room' && cardRoute?.indoorPoints?.length >= 2 && cardRoute.lengthM < INDOOR.outdoorMinM)
  }

  function paintWayButton() {
    const indoor = indoorTrip()
    const way = root.querySelector('[data-action="show-way"]')
    const go = root.querySelector('[data-go]')
    if (way) way.hidden = !indoor
    if (go) go.hidden = indoor
  }

  // ---------- the map trip: "Go" where AR cannot run ----------
  let mapTrip = null

  async function startMapTrip() {
    const dest = selected
    if (!dest || !instance?.map) return
    const go = root.querySelector('[data-go]')
    if (!cardRoute) {
      if (go) go.setAttribute('aria-busy', 'true')
      await quietPlan()
      go?.removeAttribute('aria-busy')
      if (!cardRoute || selected !== dest) return showToast('Could not plan a route. Try again.', {tone: 'warning'})
    }
    endMapTrip()
    root.dataset.mapTripOn = ''
    card.hidden = true
    mapTrip = createMapTrip(root.querySelector('[data-map-trip]'), {map: instance.map, route: cardRoute, dest, onClose: endMapTrip})
    instance.geolocate?.trigger?.()
    mapTrip.update(fixWatch.fix)
  }

  function endMapTrip() {
    if (!mapTrip) return
    mapTrip.destroy()
    mapTrip = null
    delete root.dataset.mapTripOn
    if (selected) card.hidden = false
  }

  /** Plan and draw the route as soon as a card opens: it shows behind the card, with no extra tap. */
  function drawCardRoute() {
    const map = instance?.map
    // A map still loading its style cannot take the line yet: onReady draws it.
    if (!map || !mapReady || !cardRoute?.points?.length || !selected) return
    clearRouteLine(map)
    // The fitted route, outdoors and inside to the room: the same line the AR arrows follow.
    drawRouteLine(map, [...cardRoute.points, ...(cardRoute.indoorPoints ?? []).slice(1)], frameRoute)
  }

  /** The step-free switch: remembered on this device; the route is planned again without stairs. */
  function onStepFree(event) {
    const box = event.target.closest?.('[data-step-free]')
    if (!box || !selected) return
    setStepFree(box.checked)
    const note = root.querySelector('[data-step-free-note]')
    if (note) note.hidden = !box.checked
    clearRoute()
    cardRoute = null
    refreshWalkText()
    paintIndoor()
    paintWayButton()
    quietPlan()
  }
  card.addEventListener('change', onStepFree)

  /** A room indoors: which door, which level, and whether stairs or a lift are needed. */
  function paintIndoor() {
    if (!selected) return
    const lines = indoorLines(selected, {
      entranceName: entranceNameFor(selected, cardRoute?.entrance ?? null, DESTINATIONS),
      entryLevel: cardRoute?.entryLevel ?? null,
    })
    const enter = root.querySelector('[data-indoor]')
    if (enter) {
      enter.hidden = !lines.enter
      enter.querySelector('[data-indoor-text]').textContent = lines.enter ?? ''
    }
    const stairs = root.querySelector('[data-stairs]')
    if (stairs) stairs.hidden = !lines.stairs
  }

  /**
   * For a room, plan the route quietly as soon as there is a start, so the card can name the door
   * the route really uses, the level it comes in at, and the whole distance to the room.
   */
  async function quietPlan() {
    const dest = selected
    if (!dest || cardRoute || planningFor === dest) return
    const start = getStart()
    const from = isManual(start) ? start : fixWatch.fix
    if (!from) return
    const generation = ++planGeneration
    planningFor = dest
    refreshWalkText()
    try {
      const route = await planWhenStyleLoaded(instance?.map, () => planRoute(from, dest))
      if (!route || disposed || selected !== dest || generation !== planGeneration) return
      // The floor plan did not load: no AR route, but MazeMap's own line still shows on the 2D map.
      if (route.reason === 'floor-data-unavailable' && route.preview?.length >= 2 && instance?.map && mapReady) {
        drawRouteLine(instance.map, route.preview, frameRoute)
      }
      if (route.status !== 'ok') return
      cardRoute = route
      drawCardRoute()
      checkWalls(route)
      refreshWalkText()
      paintIndoor()
      paintWayButton()
    } catch (err) {
      console.warn('[home] could not plan the route for the card', err?.message)
    } finally {
      if (generation === planGeneration && planningFor === dest) planningFor = null
      refreshWalkText() // the route, or the estimate if planning failed
    }
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
    if (text) text.textContent = manual ? startLabel(start) : 'my location'
    const value = root.querySelector('[data-start-value]')
    if (value) value.textContent = manual ? startLabel(start) : gpsText()
    const prompt = root.querySelector('[data-start-prompt]')
    if (prompt) prompt.hidden = manual || !(trouble || fix?.accuracy > START.weakGpsM)
    const live = root.querySelector('[data-action="start-gps"][data-live]')
    if (live) live.hidden = !manual || !(fix?.accuracy <= START.liveGpsM)
    const approx = root.querySelector('[data-approx]')
    // One note at a time: the stronger "can't find you" prompt wins over "approximate".
    if (approx) approx.hidden = manual || !locationApproximate(fix) || (prompt && !prompt.hidden)
    if (selected) quietPlan() // GPS may only now have arrived
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
    planGeneration += 1
    planningFor = null
    cardRoute = null // a new start: a new route
    setStart(start)
    clearRoute()
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

  /**
   * A room link (#/?to=mm-<poiId>) opened in a fresh tab or on another device: the room is not in
   * our list nor in this tab's storage, so ask MazeMap for it, then open its card as usual.
   */
  async function lookUpLinkedRoom() {
    const poiId = selected ? null : poiIdFrom(params.to)
    if (!poiId) return
    render(card, placeLoading())
    card.hidden = false
    let dest
    try {
      dest = await fetchPoiDestination(poiId)
    } catch (err) {
      console.warn('[home] room lookup failed', err)
      if (!disposed && !selected) render(card, placeNotFound('We couldn’t load that place. Check your connection and try again.'))
      return
    }
    if (disposed || selected) return
    if (dest) select(dest)
    else render(card, placeNotFound())
  }

  // Group D: a link or QR code with ?go=1 opens the card with Go focused, once.
  let goPending = params.go === '1'

  function drawCard() {
    if (!selected) {
      card.hidden = true
      return
    }
    if (goPending) {
      goPending = false
      focusGo()
    }
    // 8.4: a device that cannot run AR never sees the AR button; the card offers the map.
    render(card, placeCard(selected, walkText(), {stepFree: getStepFree(), arIssue: deviceIssue(forced)}))
    paintWayButton()
    paintIndoor()
    quietPlan()
    card.hidden = false
    paintStart()
    prefetchEngine()
  }

  function refreshWalkText() {
    const text = root.querySelector('[data-walk-text]')
    if (text && selected) text.textContent = walkText()
  }

  function openStartSheet() {
    showDoors(null)
    sheets.open('start')
    paintStart()
    startSheet.querySelector('#start-title').focus({preventScroll: true})
  }

  // ---------- route on the map ----------
  function clearRoute() {
    if (instance?.map) clearRouteLine(instance.map)
  }

  // ---------- the camera: always framed in the part of the map that shows ----------
  /** Our places on campus (buildings, halls, the loch): the opening view frames all of them. */
  const CAMPUS = campusBounds(DESTINATIONS.filter((d) => d.category !== 'town' && isOnCampus(d))) ?? HOME_MAP.campusFallbackBounds
  const mapPanels = () => [root.querySelector('[data-home-sheet]'), card, root.querySelector('[data-map-trip]'), root.querySelector('[data-pick-bar]')]
  const sheetIsFull = () => root.querySelector('.map-home')?.dataset.sheet === 'full' && card.hidden

  /** The padding before the map exists, so its first frame is already the framed campus. */
  function initialPadding() {
    const container = root.querySelector('[data-map]')
    return paddingFor(measureViewport({container, topBar: root.querySelector('.map-search'), panels: mapPanels()}))
  }

  /** The zoom for a picked place: a room close enough to read its floor, a building whole. */
  function placeZoom(dest) {
    if (dest.category === 'room') return HOME_MAP.placeZoom.room
    if (dest.category === 'landmark') return HOME_MAP.placeZoom.landmark
    return HOME_MAP.placeZoom.other
  }

  function frameRoute(bounds) {
    viewport?.toBounds(bounds)
  }

  function flyToSelected() {
    const map = instance?.map
    if (!map || !viewport || !selected || !Number.isFinite(selected.lat)) return
    if (selected.floor != null && typeof map.setZLevel === 'function') map.setZLevel(selected.floor)
    const dest = selected
    // After the card has its height: the place lands in the middle of the map above it.
    requestAnimationFrame(() => {
      if (disposed || selected !== dest) return
      viewport.toPlace(dest, {zoom: placeZoom(dest), duration: prefersReducedMotion() ? 0 : HOME_MAP.cameraMs})
    })
  }

  /** The card closed: back to the whole campus. */
  function backToCampus() {
    requestAnimationFrame(() => {
      if (disposed || selected) return
      viewport?.toCampus({duration: prefersReducedMotion() ? 0 : HOME_MAP.cameraMs})
    })
  }

  // ---------- map loading ----------
  /** The loading screen fades out once the map style is ready (at once with reduced motion). */
  let fadeTimer = 0
  function fadeOutOverlay() {
    // Only the loading screen fades: an error message stays until the user acts on it.
    if (overlay.hidden || overlay.classList.contains('is-fading') || !overlay.querySelector('[data-map-loading]')) return
    clearTimeout(fadeTimer)
    if (prefersReducedMotion()) {
      overlay.hidden = true
      return
    }
    overlay.classList.add('is-fading')
    fadeTimer = setTimeout(() => {
      overlay.hidden = true
      overlay.classList.remove('is-fading')
    }, MAP_LOADING_FADE_MS)
  }

  function showMapError(err) {
    if (disposed) return
    clearTimeout(fadeTimer)
    overlay.classList.remove('is-fading')
    overlay.hidden = false
    render(overlay, mapError(err?.code === 'offline' || navigator.onLine === false))
  }

  async function load() {
    clearTimeout(fadeTimer)
    overlay.classList.remove('is-fading')
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
      labelBlockers?.destroy()
      labelBlockers = null
      viewport?.destroy()
      viewport = null
      instance?.destroy()
      mapReady = false
      pins.clear()
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        // The first frame is the whole campus, framed between the search bar and the sheet.
        options: {bounds: CAMPUS, fitBoundsOptions: {padding: initialPadding(), maxZoom: HOME_MAP.openMaxZoom}},
        onReady: () => {
          if (disposed) return
          mapReady = true
          fadeOutOverlay()
          if (params.debug === '1') window.__homeMap = instance.map // inspect it from the console
          quietIndoorLabels(instance.map)
          viewport = createMapViewport({
            map: instance.map,
            host: root.querySelector('.map-home'),
            topBar: root.querySelector('.map-search'),
            panels: mapPanels(),
            isFull: sheetIsFull,
            campus: CAMPUS,
          })
          labelBlockers = createLabelBlockers(instance.map, {
            host: root.querySelector('.map-home'),
            panels: [root.querySelector('[data-home-sheet]'), card, root.querySelector('[data-pick-bar]')],
            overlays: ['.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib', '.mazemap-ctrl-logo-wrapper', '[data-rail]', '.map-search', '[data-action="open-menu"]'],
          })
          pins.addAll()
          fitControls()
          homeSheet.mapReady()
          instance.map.on('click', (event) => {
            if (picker.active) picker.moveTo(event.lngLat)
            else if (selected) unselect()
          })
          // No place: the map was created framed on the campus. A place: straight to it.
          flyToSelected()
          drawCardRoute() // planned before the map was ready
          paintStartMarker()
          if (params.start === 'pick' && selected) openStartSheet()
          // "Choose on map" in "Where are you?" (locate.js): straight to dropping the pin.
          if (params.start === 'map' && selected) enterPick()
          startSimulation()
          startAlignDebug()
        },
      })
      // The loading screen leaves as soon as the style is drawn. A phone may wait a long time for
      // the full 'load' (every first tile), so 'style.load' and the first 'idle' also count.
      const map = instance.map
      map.once?.('style.load', () => !disposed && fadeOutOverlay())
      map.once?.('idle', () => !disposed && fadeOutOverlay())
    } catch (err) {
      console.warn('[home] map load failed', err)
      showMapError(err)
    }
  }

  // ---------- actions ----------
  const off = onAction(root, {
    // An indoor trip: the indoor map, with the route just planned for the card.
    'show-way': () => {
      if (!selected) return
      if (cardRoute) {
        const start = getStart()
        saveTripRoute({...cardRoute, destinationId: selected.id, origin: isManual(start) ? start : fixWatch.fix, start: isManual(start) ? start : null, plannedAt: Date.now()})
      }
      navigate(`/indoor?to=${encodeURIComponent(selected.id)}`)
    },
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
    'start-indoor': () => {
      choosingIndoorStart = true
      startSearch.focus()
    },
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
    'more-chips': () => {
      const more = root.querySelector('[data-action="more-chips"]')
      const open = more?.getAttribute('aria-expanded') !== 'true'
      root.querySelectorAll('[data-extra-chip]').forEach((el) => (el.hidden = !open))
      more?.setAttribute('aria-expanded', String(open))
      more?.querySelector('span')?.replaceChildren(open ? 'Less' : 'More')
    },
    locate: () => instance?.geolocate?.trigger(),
    north: () => instance?.map.easeTo({bearing: 0, duration: 400}),
    unselect: () => {
      unselect()
      root.querySelector('[data-action="open-search"]').focus({preventScroll: true}) // its button has gone
    },
    retry: () => load(),
    'toggle-3d': () => toggle3d(),
    'map-trip': () => startMapTrip(),
    'toggle-options': () => {
      const btn = root.querySelector('[data-action="toggle-options"]')
      const panel = root.querySelector('[data-options]')
      if (!btn || !panel) return
      panel.hidden = !panel.hidden
      btn.setAttribute('aria-expanded', String(!panel.hidden))
    },
    walk: () => {
      // First, inside the tap: iPhone only shows the camera and motion prompts in a user gesture,
      // and this tap on Go is that gesture. No extra "Before we start" step: the camera opens next.
      if (!deviceIssue(forced)) {
        startPermissionRequests({gps: !isManual(getStart())})
        markSeen('guide')
      }
      setCurrentDestination(selected)
      const next = new URLSearchParams({to: selected.id})
      if (forced) next.set('force', '1')
      if (params.debug === '1') next.set('debug', '1')
      if (params.fieldtest === '1') next.set('fieldtest', '1')
      if (params.fieldlog === '1') next.set('fieldlog', '1')
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
  lookUpLinkedRoom()
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
    card.removeEventListener('change', onStepFree)
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
    labelBlockers?.destroy()
    viewport?.destroy()
    instance?.destroy()
  }
}
