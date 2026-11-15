// Home is the campus map: pins, a search bar, category chips and a card for the chosen place.
// #/?to=<id> opens with a place selected.
import {createCampusMap, loadMazeMap, planWhenStyleLoaded, quietIndoorLabels} from '../../map/mazemap.js'
import {clearRouteLine, drawRouteLine} from '../../map/route-line.js'
import {createLabelBlockers} from '../../map/label-blockers.js'
import {readLastView, watchLastView} from '../../map/last-view.js'
import {createDestinationSearch} from '../components/destination-search.js'
import {createMapPicker} from '../components/map-picker.js'
import {createMapPins} from '../components/map-pins.js'
import {createHomeSheet} from '../components/home-sheet.js'
import {showToast} from '../components/toast.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {seen} from '../first-use.js'
import {openingMove} from '../opening.js'
import {createFixWatch, locationPermissionState, readTripFix} from '../../geo/location.js'
import {locateForGo, noLocationText} from '../../route/go-start.js'
import {handoffUrl, hydrateHandoff, needsHandoff, phoneHandoff} from '../components/phone-handoff.js'
import {watchContextLoss} from '../webgl-loss.js'
import {arriveLabel} from './ar.js'
import {createVoice} from '../voice.js'
import {applyTheme, getTheme} from '../theme.js'
import {getLocale, setLocale, t} from '../../i18n/i18n.js'
import {SAVED_GROUPS, savedGroup, savePlace, unsavePlace} from '../../map/saved.js'
import {reportError} from '../../stats/errors.js'
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
import {GPS, HOME_MAP, INDOOR, MAZEMAP, START} from '../../config.js'
import {createSheets} from './home-sheets.js'
import {doorList, homePage, mapError, mapLoading, mapLost, placeCard, placeLoading, placeNotFound} from './home-view.js'

// Item 13: after a new language the screen is drawn again; the menu opens on the choice just made.
let reopenMenuOnLocale = false
// A language change redraws this screen (item 13). What the student was doing goes across
// unchanged: the place, the route already planned (so nothing is planned again, and no option
// such as step-free can be lost on the way), and whether the map trip was running.
let carried = null

export function homeScreen(root, {navigate, params, refresh = () => {}}) {
  const forced = params.force === '1'
  let instance = null
  let mapReady = false // the map's style has loaded: it can take the route line
  let labelBlockers = null // keeps labels clear of the logos, and the logos above the sheet or card
  let stopMapLoss = null // stops watching the map canvas for a lost WebGL context
  let stopLastView = null // stops saving the view the student leaves the map at
  let selected = findDestination(params.to)
  let cardRoute = null // the route planned for the card (door, level, whole distance)
  const kept = carried && carried.destId === (params.to ?? null) ? carried : null
  carried = null
  if (kept?.dest) {
    selected ??= kept.dest // a MazeMap room is not in our list: no second look-up
    cardRoute = kept.route
  }
  let planningFor = null // the destination a quiet plan is running for
  let planning = Promise.resolve() // that plan, for Go to wait on
  let stopDemo = () => {} // the demo video's watcher on the place card
  let goAfterStart = false // the start sheet opened by Go: Go is next once a start is chosen
  let locationPermission = 'unknown' // read once at start, so the Go tap can decide without waiting
  let disposed = false
  let enginePrefetched = false
  let startMarker = null
  // The 3D campus model: loaded the first time 3D is turned on (it is a 6 MB download).
  let model = null
  let modelLoad = null
  let show3d = false
  // ?simulate=1 (before or after the #): a fake walk to the chosen place, to test the AR arrow.
  // Developer tools only (__DEV_TOOLS__, vite.config.js): a production build has none of them.
  const devParam = (name, value) => __DEV_TOOLS__ && (params[name] === value || new URLSearchParams(window.location.search).get(name) === value)
  const simulate = devParam('simulate', '1')
  let sim = null
  // ?debug=align: the model see-through over MazeMap, its origin, and click coordinates.
  const debugAlign = devParam('debug', 'align')
  const debugWalls = devParam('debug', 'walls')
  const debugScene = devParam('debug', 'scene')
  const debugRoute = devParam('debug', 'route')
  let alignDebug = null

  render(root, homePage())

  const overlay = root.querySelector('[data-overlay]')
  const card = root.querySelector('[data-card]')
  const searchSheet = root.querySelector('[data-search-sheet]')
  const infoSheet = root.querySelector('[data-info-sheet]')
  const startSheet = root.querySelector('[data-start-sheet]')
  const startSearch = createDestinationSearch(root.querySelector('[data-start-search]'), {
    label: t('start.searchLabel'),
    placeholder: t('start.searchPlaceholder'),
    places: PLACE_LIST,
    searchRooms: false,
    recent: {get: getRecentStarts, add: addRecentStart, clear: clearRecentStarts},
    onSelect: (place) => chooseStartPlace(placeById(place.id) ?? place),
  })
  // The search sheet opens two ways: Search (where to), or Directions (the start row above it).
  let searchMode = 'search'
  let startFromDirections = false // the start sheet sits on top of the Directions search
  function openSearchSheet(mode) {
    searchMode = mode
    const directions = mode === 'directions'
    searchSheet.querySelector('[data-search-from]').hidden = !directions
    searchSheet.querySelector('[data-search-title]').textContent = t(directions ? 'home.directions' : 'search.title')
    paintStart()
    sheets.open('search')
    // Inside the tap, or iPhone will not open the keyboard.
    search.focus()
  }
  const search = createDestinationSearch(root.querySelector('[data-search]'), {
    label: t('search.destination'),
    onSelect: (dest) => {
      sheets.close({restoreFocus: false})
      select(dest)
      card.querySelector('.dest-sheet__name')?.focus({preventScroll: true})
    },
  })
  const sheets = createSheets(
    root,
    {
      search: {element: searchSheet, opener: () => (searchMode === 'directions' ? 'open-directions' : 'open-search')},
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
    menuButton.closest('.map-home__top')?.classList.toggle('is-menu-open', open)
    menuButton.setAttribute('aria-expanded', String(open))
    if (open) [...menu.querySelectorAll('[role^="menuitem"]')].find((el) => !el.hidden)?.focus({preventScroll: true})
  }

  // Item 3: spoken directions, off by default, remembered. Only offered where the browser speaks.
  const voice = createVoice()
  let announcer = null
  function paintVoice() {
    const item = root.querySelector('[data-voice]')
    if (!item) return
    item.hidden = !voice.supported
    item.setAttribute('aria-checked', String(voice.on))
  }
  paintVoice()

  // Item 11: Device setting, Light or Dark (menuitemradio).
  function paintTheme() {
    const now = getTheme()
    for (const b of root.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === now))
  }
  paintTheme()

  // Item 13: the language (menuitemradio). The screen is drawn again in it; the address keeps the place.
  async function chooseLocale(button) {
    const id = button.dataset.localeChoice
    if (id === getLocale().id) return
    button.setAttribute('aria-busy', 'true')
    const now = await setLocale(id)
    if (disposed) return
    button.removeAttribute('aria-busy')
    if (now.id !== id) return showToast(t('lang.failed'), {tone: 'warning'})
    reopenMenuOnLocale = true
    carried = {destId: selected?.id ?? null, dest: selected, route: cardRoute, tripOn: Boolean(mapTrip)}
    refresh()
  }
  if (reopenMenuOnLocale) {
    reopenMenuOnLocale = false
    // After the router has moved focus to the heading: back to the language just chosen.
    requestAnimationFrame(() => {
      if (disposed) return
      setMenu(true)
      menu.querySelector('[data-locale-choice][aria-checked="true"]')?.focus({preventScroll: true})
    })
  }
  const onOutside = (event) => {
    if (!menu.hidden && !event.target.closest('[data-menu], [data-action="open-menu"]')) setMenu(false)
  }
  document.addEventListener('pointerdown', onOutside)

  // Toasts sit just above the place card, never over its Go button.
  function liftToasts() {
    const style = document.documentElement.style
    const top = card.hidden ? 0 : card.getBoundingClientRect().top
    if (top > 0) style.setProperty('--toast-above', `${Math.round(window.innerHeight - top + 12)}px`)
    else style.removeProperty('--toast-above')
  }
  const cardWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(liftToasts) : null
  cardWatch?.observe(card)
  window.addEventListener('resize', liftToasts)

  /**
   * MazeMap's floor bar goes in the right-hand rail (it shows itself only in a building with
   * floors). The compass shows only on a turned map, its needle pointing north; a tap turns north up.
   */
  function fitControls() {
    const bar = root.querySelector('.mm-floor-bar')
    const host = root.querySelector('[data-floor-host]')
    if (bar && host && bar.parentElement !== host) host.append(bar)
    const north = root.querySelector('[data-north]')
    const map = instance?.map
    const paintNorth = () => {
      const bearing = map.getBearing()
      north.hidden = Math.abs(bearing) < 1
      north.style.setProperty('--bearing', `${-bearing}deg`)
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
    const text = query.toString()
    navigate(text ? `/?${text}` : '/', {replace: true, silent: true})
  }

  function select(dest) {
    if (selected?.id !== dest.id) {
      clearRoute()
      cardRoute = null
    }
    selected = dest
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
    if (!__DEV_TOOLS__) return
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
    if (!__DEV_TOOLS__ || !debugAlign || !map || disposed) return
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
      showToast(t('home.3dFailed'), {tone: 'warning'})
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
    button.setAttribute('aria-label', t(show3d ? 'home.hide3d' : 'home.show3d'))
    button.toggleAttribute('aria-busy', loading)
    button.querySelector('[data-3d-label]').hidden = loading
    button.querySelector('[data-3d-spinner]').hidden = !loading
    button.querySelector('[data-3d-label]').textContent = t(show3d ? 'home.mode2d' : 'home.mode3d')
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
      showToast(t('home.3dFailed'), {tone: 'warning'})
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
    if (cardRoute) return walkSummary(tripLengthM(cardRoute)) ?? t('card.onCampus')
    if (planningFor === selected) return t('card.working')
    if (!from || estimateWalkMinutes(from, selected) == null) return t('card.onCampus')
    return walkSummary(estimatedWalkM(from, entranceOf(selected))) ?? t('card.onCampus')
  }

  /**
   * ?debug=walls: list where the MazeMap route walks through a wall away from a door (report only).
   */
  /** ?debug=scene (Step 1): build the 3D navigation scene for this route and show what it holds. */
  async function checkScene(route) {
    if (!__DEV_TOOLS__ || !debugScene || !selected || !route?.points) return
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
    if (!__DEV_TOOLS__) return
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
    const go = root.querySelector('[data-go-actions]') // Walk with AR and Map directions, or the one map button
    if (way) way.hidden = !indoor
    if (go) go.hidden = indoor
  }

  // ---------- the map trip: "Map directions", and "Go" where AR cannot run ----------
  let mapTrip = null

  async function startMapTrip() {
    const dest = selected
    if (!dest || !instance?.map) return
    const go = card.querySelector('[data-action="map-trip"]') // the button that was tapped
    if (!cardRoute) {
      if (go) go.setAttribute('aria-busy', 'true')
      // "From my location" with no position: ask where the walk starts, not a route error.
      if (!isManual(getStart())) {
        const got = await locateForGo({
          fix: fixWatch.fix,
          current: () => fixWatch.current(),
          hasGeolocation: Boolean(navigator.geolocation),
          permission: await locationPermissionState(),
          trouble: fixWatch.trouble,
          timeoutMs: START.goLocateMs,
        })
        if (disposed || selected !== dest) return go?.removeAttribute('aria-busy')
        if (!got.fix) {
          go?.removeAttribute('aria-busy')
          return askStart()
        }
      }
      await quietPlan()
      go?.removeAttribute('aria-busy')
      if (disposed || selected !== dest) return
      if (!cardRoute) return showToast(t('home.noRoute'), {tone: 'warning'})
    }
    // The map trip (and its turn-by-turn) loads on Go, keeping the first screen light.
    const [{createMapTrip}, {createTurnAnnouncer}, {default: osm}] = await Promise.all([
      import('../components/map-trip.js'),
      import('../../route/trip-steps.js'),
      import('../../data/landmarks-osm.json'), // named roads, buildings and the loch, for the steps
    ])
    if (disposed || selected !== dest) return
    endMapTrip()
    announcer = createTurnAnnouncer({arriveLabel: arriveLabel(dest)})
    root.dataset.mapTripOn = ''
    card.hidden = true
    // The trip frames the route itself and runs its own GPS: no geolocate.trigger(), whose camera
    // fits the GPS accuracy circle (a laptop's ~1 km Wi-Fi fix zooms out to Causewayhead).
    mapTrip = createMapTrip(root.querySelector('[data-map-trip]'), {
      map: instance.map,
      route: cardRoute,
      dest,
      onClose: endMapTrip,
      onLost: (button) => imLost(dest, button), // item 8
      arriveLabel: arriveLabel(dest), // "Library entrance", as in AR
      destinations: DESTINATIONS, // corners are named after the places beside them
      osm,
      onStep: speakStep,
    })
    mapTrip.update(fixWatch.fix)
  }

  /**
   * Item 8, "I'm lost": where the walker is (the trip's latest fix, or a fresh one), the nearest
   * named place, a new route from there, and the map back on them.
   */
  async function imLost(dest, button) {
    button?.setAttribute('aria-busy', 'true')
    try {
      const [{nearestPlace, lostMessage}, {default: osm}] = await Promise.all([import('../../route/lost.js'), import('../../data/landmarks-osm.json')])
      let fix = mapTrip?.lastFix ?? fixWatch.fix
      if (!fix && navigator.geolocation) fix = await Promise.race([fixWatch.current(), new Promise((r) => setTimeout(() => r(null), 8000))]).catch(() => null)
      if (disposed || selected !== dest) return
      if (!fix) {
        endMapTrip()
        return askStart() // "We can't see your location. Choose where you're starting from."
      }
      const message = lostMessage(nearestPlace(fix, {destinations: DESTINATIONS, osm}), fix.accuracy)
      const route = await planRoute(fix, dest)
      if (disposed || selected !== dest) return
      if (route?.status === 'ok') {
        cardRoute = route
        drawCardRoute()
        await startMapTrip() // the new route, its steps and its framing
      }
      instance?.map?.easeTo({center: [fix.lng, fix.lat], zoom: Math.max(instance.map.getZoom(), 17), duration: 600})
      showToast(route?.status === 'ok' ? message : `${message.replace(t('lost.newRoute'), '')} ${t('home.noNewRoute')}`, {duration: 6000})
      voice.say(message)
    } finally {
      button?.removeAttribute('aria-busy')
    }
  }

  /** Spoken directions for the map trip: each turn as it comes up, again close to it, and arrival. */
  function speakStep(next) {
    if (next.type === 'arrived') return voice.say(next.text)
    const words = announcer?.next(next.manoeuvre, next.distanceM)
    if (words) voice.say(words)
  }

  function endMapTrip() {
    if (!mapTrip) return
    voice.stop()
    announcer = null
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
    drawRouteLine(map, [...cardRoute.points, ...(cardRoute.indoorPoints ?? []).slice(1)], card.offsetHeight + 40)
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
  function quietPlan() {
    const dest = selected
    if (!dest || cardRoute) return Promise.resolve()
    // Already planning for this place: Go waits for that plan rather than giving up on it.
    if (planningFor === dest) return planning
    const start = getStart()
    const from = isManual(start) ? start : fixWatch.fix
    if (!from) return Promise.resolve()
    planningFor = dest
    refreshWalkText()
    planning = planFor(dest, from)
    return planning
  }

  async function planFor(dest, from) {
    try {
      const route = await planWhenStyleLoaded(instance?.map, () => planRoute(from, dest))
      if (!route || disposed || selected !== dest || route.status !== 'ok') return
      cardRoute = route
      drawCardRoute()
      checkWalls(route)
      refreshWalkText()
      paintIndoor()
      paintWayButton()
    } catch (err) {
      console.warn('[home] could not plan the route for the card', err?.message)
    } finally {
      if (planningFor === dest) planningFor = null
      refreshWalkText() // the route, or the estimate if planning failed
    }
  }

  // ---------- the starting point ----------
  function gpsText() {
    const {fix} = fixWatch
    if (fix) return t('start.gpsAccuracy', {m: Math.round(fix.accuracy)})
    return t(fixWatch.watching ? 'start.locating' : 'start.gps')
  }

  function paintStart() {
    const {fix, trouble} = fixWatch
    const start = getStart()
    const manual = isManual(start)
    const text = root.querySelector('[data-start-text]')
    if (text) text.textContent = manual ? startLabel(start) : t('start.myLocation')
    const value = root.querySelector('[data-start-value]')
    if (value) value.textContent = manual ? startLabel(start) : gpsText()
    const from = root.querySelector('[data-search-from-text]') // Directions: the start row
    if (from) from.textContent = manual ? startLabel(start) : t('home.yourLocation')
    const prompt = root.querySelector('[data-start-prompt]')
    if (prompt) prompt.hidden = manual || !(trouble || fix?.accuracy > START.weakGpsM)
    const live = root.querySelector('[data-action="start-gps"][data-live]')
    if (live) live.hidden = !manual || !(fix?.accuracy <= START.liveGpsM)
    const approx = root.querySelector('[data-approx]')
    // One note at a time: the stronger "can't find you" prompt wins over "approximate".
    if (approx) approx.hidden = manual || !locationApproximate(fix) || (prompt && !prompt.hidden)
    if (selected) quietPlan() // GPS may only now have arrived
    const row = root.querySelector('.route-from__row')
    row?.setAttribute('aria-label', t('start.rowLabel', {start: manual ? startLabel(start) : gpsText()}))
    const sheetText = root.querySelector('[data-start-gps-text]')
    if (sheetText) sheetText.textContent = fix ? t('start.accurateTo', {m: Math.round(fix.accuracy)}) : t(trouble ? 'start.notAvailable' : 'start.useGps')
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
    cardRoute = null // a new start: a new route
    setStart(start)
    clearRoute()
    sheets.close({restoreFocus: false})
    showDoors(null)
    paintStart()
    refreshWalkText()
    if (goAfterStart && selected) focusGo()
    else root.querySelector('.route-from__row')?.focus({preventScroll: true})
    goAfterStart = false
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
    const here = isManual(start) ? startAsDestination(start) : fix && {id: 'your-location', name: t('home.yourLocation'), category: 'landmark', building: '', floor: null, lat: fix.lat, lng: fix.lng}
    if (!here) return showToast(t('home.swapNoFix'), {tone: 'warning'})
    const place = placeById(selected.id)
    useStart(place ? startFromPlace(place) : startFromPin(selected))
    select(here)
  }

  // ---------- pick on the map ----------
  function enterPick() {
    if (!instance?.map) return showToast(t('home.mapStillLoading'), {tone: 'warning'})
    // From Directions the start sheet is on top of the search: close both, the map is needed.
    if (startFromDirections && !startSheet.hidden) window.addEventListener('popstate', () => sheets.close({restoreFocus: false}), {once: true})
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
      if (!disposed && !selected) render(card, placeNotFound(t('card.notLoaded')))
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
    const arIssue = deviceIssue(forced)
    // A laptop, or no location here: a QR code to carry on with AR on a phone.
    const handoff = needsHandoff({issueCode: arIssue?.code, hasGeolocation: Boolean(navigator.geolocation)}) ? phoneHandoff(handoffUrl(selected.id)) : null
    render(card, placeCard(selected, walkText(), {stepFree: getStepFree(), arIssue, handoff, savedIn: savedGroup(selected.id), groups: SAVED_GROUPS}))
    stopDemo()
    stopDemo = hydrateHandoff(card) // the QR code, and the AR demo beside it on wide screens
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

  /** note: one line above the choices, e.g. why we are asking (no location for Go). */
  function openStartSheet(note = '') {
    showDoors(null)
    const line = startSheet.querySelector('[data-start-note]')
    if (line) {
      line.textContent = note
      line.hidden = !note
    }
    if (!note) goAfterStart = false
    sheets.open('start')
    paintStart()
    startSheet.querySelector('#start-title').focus({preventScroll: true})
  }

  /** Go with no position: choose a start, then Go is ready to tap again. */
  function askStart() {
    goAfterStart = true
    openStartSheet(noLocationText())
  }

  // ---------- route on the map ----------
  function clearRoute() {
    if (instance?.map) clearRouteLine(instance.map)
  }

  /**
   * The opening view: where the student left the map last time, else HOME_MAP.openOn at indoor
   * zoom (rooms, codes, icons), in the middle of the map between the search bar and the sheet.
   */
  function campusView(map) {
    const last = readLastView()
    if (last) return {center: {lng: last.lng, lat: last.lat}, zoom: last.zoom, bearing: last.bearing, pitch: 0}
    const place = DESTINATIONS.find((d) => d.id === HOME_MAP.openOn)
    const fallback = {center: MAZEMAP.center, zoom: HOME_MAP.openZoom, bearing: 0, pitch: 0}
    if (!place) return fallback
    const box = map.getContainer().getBoundingClientRect()
    const bar = root.querySelector('.map-search')?.getBoundingClientRect()
    const sheet = root.querySelector('[data-home-sheet]')?.getBoundingClientRect()
    const pad = HOME_MAP.openPaddingPx
    const padding = {
      top: Math.max(0, (bar ? bar.bottom - box.top : 0) + pad),
      bottom: Math.max(0, (sheet ? box.bottom - sheet.top : 0) + pad),
      left: pad,
      right: pad,
    }
    // A box a few metres round the building's point, held at openZoom: the point lands in the
    // middle of the clear part of the map, not under the sheet.
    const d = 0.00005
    const bounds = [[place.lng - d, place.lat - d], [place.lng + d, place.lat + d]]
    let camera = null
    try {
      camera = map.cameraForBounds(bounds, {padding, maxZoom: HOME_MAP.openZoom})
    } catch {
      // padding larger than the map (a very short window): the plain centre below
    }
    return camera ? {...fallback, center: camera.center, zoom: HOME_MAP.openZoom} : {...fallback, center: {lng: place.lng, lat: place.lat}}
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
      labelBlockers?.destroy()
      labelBlockers = null
      stopMapLoss?.()
      stopMapLoss = null
      instance?.destroy()
      mapReady = false
      pins.clear()
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        onReady: () => {
          if (disposed) return
          mapReady = true
          overlay.hidden = true
          if (params.debug === '1') window.__homeMap = instance.map // inspect it from the console
          quietIndoorLabels(instance.map)
          // The phone took the GPU away: wait for it back, else offer a reload (not a black map).
          stopMapLoss = watchContextLoss(instance.map.getCanvas?.(), {
            onLost: () => {
              if (disposed) return
              reportError('webgl-lost')
              render(overlay, mapLost())
              overlay.hidden = false
              overlay.querySelector('[data-autofocus]')?.focus({preventScroll: true})
            },
            onRestored: () => {
              if (disposed) return
              if (overlay.querySelector('[data-action="retry"]')) overlay.hidden = true
              instance?.map?.triggerRepaint?.()
            },
          })
          labelBlockers = createLabelBlockers(instance.map, {
            host: root.querySelector('.map-home'),
            panels: [root.querySelector('[data-home-sheet]'), card, root.querySelector('[data-pick-bar]')],
            overlays: ['.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib', '.mazemap-ctrl-logo-wrapper', '[data-rail]', '.map-home__top'],
          })
          pins.addAll()
          fitControls()
          homeSheet.mapReady()
          instance.map.on('click', (event) => {
            if (picker.active) picker.moveTo(event.lngLat)
            else if (selected) unselect()
          })
          stopLastView?.()
          stopLastView = watchLastView(instance.map) // the next visit opens where this one left off
          if (!selected) {
            // Campus Central at indoor zoom (or the last view) in the middle of the map that shows
            // between the search bar and the sheet; with the opening, the camera ends there.
            const view = campusView(instance.map)
            if (!openingMove(instance.map, view)) instance.map.jumpTo(view)
          }
          flyToSelected()
          drawCardRoute() // planned before the map was ready
          if (kept?.tripOn && cardRoute) startMapTrip() // the same trip, in the new language
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
    // An indoor trip: the indoor map, with the route just planned for the card.
    'show-way': () => {
      if (!selected) return
      if (cardRoute) {
        const start = getStart()
        saveTripRoute({...cardRoute, destinationId: selected.id, origin: isManual(start) ? start : fixWatch.fix, start: isManual(start) ? start : null, plannedAt: Date.now()})
      }
      navigate(`/indoor?to=${encodeURIComponent(selected.id)}`)
    },
    'open-search': () => openSearchSheet('search'),
    'open-directions': () => openSearchSheet('directions'),
    // Saved places: the sheet at half, on the saved groups; with none yet, how to save one.
    'open-saved': () => {
      if (!homeSheet.showSaved()) showToast(t('home.noSaved'), {duration: 5000})
    },
    'open-start': (_, target) => {
      // From the Directions row: once a start is chosen (or the sheet closed), back to the search.
      startFromDirections = Boolean(target.closest('[data-search-from]'))
      if (startFromDirections) {
        window.addEventListener(
          'popstate',
          () => {
            if (!disposed && !searchSheet.hidden) search.focus()
          },
          {once: true},
        )
      }
      openStartSheet()
    },
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
    // Item 12: Save. Not saved: choose My lectures, My halls or Other places. Saved: remove it.
    save: (_, button) => {
      if (!selected) return
      const group = savedGroup(selected.id)
      const choices = card.querySelector('[data-save-groups]')
      if (group) {
        unsavePlace(selected.id)
        button.setAttribute('aria-pressed', 'false')
        showToast(t('home.removedFrom', {group: SAVED_GROUPS.find((g) => g.id === group).label}))
        return homeSheet.refreshRest()
      }
      const open = choices.hidden
      choices.hidden = !open
      button.setAttribute('aria-expanded', String(open))
      if (open) choices.querySelector('button')?.focus({preventScroll: true})
    },
    'save-to': (_, chip) => {
      if (!selected) return
      savePlace(selected, chip.dataset.group)
      const button = card.querySelector('[data-save]')
      card.querySelector('[data-save-groups]').hidden = true
      button?.setAttribute('aria-pressed', 'true')
      button?.setAttribute('aria-expanded', 'false')
      button?.focus({preventScroll: true})
      showToast(t('home.savedTo', {group: SAVED_GROUPS.find((g) => g.id === chip.dataset.group).label}))
      homeSheet.refreshRest()
    },
    // Item 9: the phone's share sheet, or the link copied. The link is #/?to=<id>, nothing added.
    share: async () => {
      if (!selected) return
      const {sharePlace} = await import('../share.js')
      const {result, url} = await sharePlace(selected)
      if (result === 'copied') showToast(t('common.linkCopied'))
      else if (result === 'failed') showToast(url, {duration: 8000})
    },
    'set-theme': (_, button) => {
      applyTheme(button.dataset.themeChoice)
      paintTheme()
    },
    'set-locale': (_, button) => chooseLocale(button),
    'toggle-voice': () => {
      voice.set(!voice.on) // inside the tap: iPhone only lets a page speak after one
      paintVoice()
    },
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
      more?.querySelector('span')?.replaceChildren(t(open ? 'home.less' : 'home.more'))
    },
    locate: () => instance?.geolocate?.trigger(),
    north: () => {
      instance?.map.easeTo({bearing: 0, duration: 400})
      // The compass hides once north is up: keep the keyboard on the rail, not on the page.
      root.querySelector('[data-action="toggle-3d"]')?.focus({preventScroll: true})
    },
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
      // "From my location" where location is blocked or missing: ask for a start, not a dead end.
      if (!isManual(getStart()) && !fixWatch.fix && (!navigator.geolocation || locationPermission === 'denied')) return askStart()
      // First, inside the tap: iPhone only shows the motion prompt here. The very first time,
      // the next screen explains the three prompts before asking.
      if (!deviceIssue(forced) && seen('guide')) startPermissionRequests({gps: !isManual(getStart())})
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
  lookUpLinkedRoom()
  // Item 8: arrived from a calibration sign (/c/<id>): the start is set there; ask where to.
  if (params.sign && !selected) {
    import('../../route/markers.js').then(({findMarker}) => {
      const sign = findMarker(params.sign)
      if (!sign || disposed || selected) return
      showToast(t('home.signStart', {name: sign.label}), {duration: 5000})
      sheets.open('search')
    })
  }
  load()
  // A reload keeps the history entry of a sheet that was open.
  if (window.history.state?.sheet) sheets.show(window.history.state.sheet)
  locationPermissionState().then((state) => {
    locationPermission = state
    if (!disposed && state === 'granted' && !(fixWatch.fix?.accuracy <= GPS.goodAccuracyM)) fixWatch.ensure()
  })

  return () => {
    disposed = true
    off()
    voice.destroy() // the trip ends with the screen: stop talking
    stopDemo()
    cardWatch?.disconnect()
    window.removeEventListener('resize', liftToasts)
    document.documentElement.style.removeProperty('--toast-above')
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
    stopMapLoss?.()
    stopLastView?.()
    instance?.destroy()
  }
}
