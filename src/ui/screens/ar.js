// AR screen. States, in order:
//   loading  download the AR engine with a real progress bar
//   live     full-screen camera + world tracking: the trip pill on top, arrows lying on the real
//            floor (3D, in the AR scene), and a small heading-up map in the corner. Debug tools only with ?debug=1.
//   error    camera denied, motion denied, offline, timeout or engine crash; each says what to do
import {permissionsAllowed} from '../../ar/permissions.js'
import {parseUserAgent} from '../../ar/device.js'
import {DESTINATIONS, findDestination} from '../../map/destinations.js'
import {entranceNameFor} from '../../route/card-text.js'
import {GPS_START, isManual, setStart, standHereText} from '../../route/start-point.js'
import {readTripRoute} from '../../route/route.js'
import {readTripFix} from '../../geo/location.js'
import {formatDistance} from '../../ar/pin.js'
import {prefersReducedMotion, showArrival} from '../components/arrival.js'
import {showToast} from '../components/toast.js'
import {drawMinimap} from '../components/ar-minimap.js'
import {createCompassMap} from '../components/compass-map.js'
import {focusScreen, haptic, onAction, render} from '../dom.js'
import {icon} from '../icons.js'
import {GROUND, INDOOR, ROUTING} from '../../config.js'
import {paintDebugStats, paintLiveDebug, setStat as setDebugStat, toggleDebugPanel} from './ar-debug.js'
import {errorCopy} from './ar-errors.js'
import {statusMessage} from './ar-status.js'
import {errorView, liveView, loadingView} from './ar-view.js'

const MAP_SWIPE_PX = 40
const LINE_UP_DEG_PER_WIDTH = 90 // a drag across the whole screen turns the route this far
const SWIPE_CLICK_MS = 500 // a mouse swipe also fires a click; a finger's does not

/** How the pill names the end of the walk: "Pathfoot entrance", but not "Bus Hub entrance". */
export function arriveLabel({name, category}) {
  const short = name.replace(/ Building$/, '')
  return category === 'bus' || category === 'landmark' || category === 'town' ? short : `${short} entrance`
}

/** The one line on the AR screen: "Pathfoot · 120 m · 2 min". */
export function tripPillText(name, metres) {
  const minutes = Math.max(1, Math.round(metres / ROUTING.walkSpeedMps / 60))
  return `${name.replace(/ Building$/, '')} · ${formatDistance(metres)} · ${minutes} min`
}

export function arScreen(root, {navigate, params}) {
  const allowDesktop = params.force === '1'
  const showDebug = params.debug === '1' || new URLSearchParams(window.location.search).get('debug') === '1'
  // ?fieldtest=1: a readout, a once-a-second log and marker buttons for walking a route (ar-fieldtest.js).
  const fieldTestOn = params.fieldtest === '1' || new URLSearchParams(window.location.search).get('fieldtest') === '1'
  // Every trip starts with a destination. Without one, go and pick it first.
  const destination = findDestination(params.to)
  if (!destination) {
    // Defer, so the router finishes mounting this screen before it switches again.
    // Not known here (a room link on a new device): the map looks it up and opens its card.
    queueMicrotask(() => navigate(params.to ? `/?to=${encodeURIComponent(params.to)}` : '/', {replace: true}))
    return
  }
  // The walking route and the one permission tap happen on the location screen. Without them, go back.
  const route = readTripRoute()
  const tripStart = route?.start ?? null
  const manualStart = isManual(tripStart)
  // A chosen start is where the user stands, whatever an old GPS fix says.
  const origin = manualStart ? route.origin : readTripFix() || route?.origin
  if (!route || route.destinationId !== destination.id || !origin || !permissionsAllowed()) {
    const debugQuery = (params.debug === '1' ? '&debug=1' : '') + (fieldTestOn ? '&fieldtest=1' : '')
    queueMicrotask(() => navigate(`/locate?to=${encodeURIComponent(destination.id)}${allowDesktop ? '&force=1' : ''}${debugQuery}`, {replace: true}))
    return
  }
  const device = parseUserAgent(navigator.userAgent, {maxTouchPoints: navigator.maxTouchPoints})
  let wasLocked = false
  let trip = null
  let stopSession = null
  let wakeLock = null
  let disposed = false
  let offAction = () => {}
  let fieldTest = null
  let mapOpenedForPosition = false // the 2D map was opened because the position is uncertain
  if (fieldTestOn) {
    import('./ar-fieldtest.js').then(({createFieldTest}) => {
      if (disposed) return
      fieldTest = createFieldTest({haptic})
      mountFieldTest()
    })
  }
  let compassMap = null
  let mapFailed = false
  let mapSwipedAt = -Infinity
  let lineUpDraggedAt = -Infinity // a line-up drag also fires a click: not a floor tap
  let lineUpOpen = false
  const setStat = (name, text, tone) => setDebugStat(root, name, text, tone)

  const actions = {
    'toggle-map': () => {
      if (performance.now() - mapSwipedAt > SWIPE_CLICK_MS) toggleMap()
    },
    repick: () => navigate(`/?${new URLSearchParams({to: destination.id, start: 'pick', ...(allowDesktop ? {force: '1'} : {})})}`),
    'go-live': () => {
      setStart(GPS_START)
      trip?.switchToLive()
    },
    exit: () => navigate('/'),
    // "I'm here": the nearby doors, stairs and lifts on the map; the one tapped is where the user is.
    reanchor: () => {
      const choices = trip?.reanchorChoices() ?? []
      if (!choices.length || !compassMap) return showToast('No doors, stairs or lifts nearby on the map', {tone: 'warning'})
      toggleMap(true)
      const pick = root.querySelector('[data-pick]')
      if (pick) pick.hidden = false
      compassMap.showPicks(choices, (choice) => {
        trip?.reanchorAt(choice)
        compassMap?.clearPicks()
        if (pick) pick.hidden = true
        toggleMap(false)
        haptic(20)
      })
    },
    'pick-cancel': () => {
      compassMap?.clearPicks()
      const pick = root.querySelector('[data-pick]')
      if (pick) pick.hidden = true
      toggleMap(false)
    },
    // "I'm on Level n": the stair or lift is done; carry on from its other end.
    'confirm-floor': () => {
      if (trip?.confirmFloor()) haptic(20)
    },
    'looks-right': () => {
      trip?.confirmLineUp()
      haptic(20)
    },
    realign: () => {
      if (trip?.reopenLineUp()) paintLineUp(true)
    },
    done: () => navigate('/'),
    inside: () => navigate(`/indoor?to=${encodeURIComponent(destination.id)}`),
    'start-walk': () => {
      const result = trip?.start()
      const note = root.querySelector('[data-start-note]')
      if (note) note.hidden = result !== 'look'
      if (result === 'path' && note) {
        note.hidden = false
        note.textContent = 'Walk to the path first, then tap Start again.'
      }
    },
    map: () => navigate(`/?to=${encodeURIComponent(destination.id)}`),
    retry: () => begin(),
    reload: () => window.location.reload(),
    debug: () => toggleDebugPanel(root),
    recalibrate: () => {
      trip?.recalibrate()
      toggleDebugPanel(root, false)
    },
    // ?debug=1: the building shell (MazeMap walls) as a see-through wireframe.
    'walls-wire': (_, button) => {
      const on = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', String(on))
      trip?.setWireframe(on)
    },
    'floor-grid': (_, button) => {
      const on = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', String(on))
      trip?.setFloorGrid(on)
    },
    'floor-down': () => setStat('floor', `${trip?.nudgeFloor(GROUND.eyeStepM).toFixed(2)} m`),
    'floor-up': () => setStat('floor', `${trip?.nudgeFloor(-GROUND.eyeStepM).toFixed(2)} m`),
  }

  function setView(fragment, state) {
    root.dataset.arState = state
    render(root, fragment)
    focusScreen(root)
  }

  // ---------- loading ----------
  function showLoading() {
    setView(loadingView(), 'loading')
  }

  function setProgress(p) {
    const ring = root.querySelector('[data-progress]')
    if (!ring) return
    const pct = Math.round(p * 100)
    ring.style.setProperty('--p', String(pct))
    ring.setAttribute('aria-valuenow', String(pct))
    root.querySelector('[data-progress-text]').textContent = `${pct}%`
    if (pct >= 99) root.querySelector('[data-loading-text]').textContent = 'Starting the camera…'
  }

  // ---------- live ----------
  function showLive() {
    mapFailed = false
    setView(
      liveView({
        showDebug,
        routeSource: route.source,
        pillText: tripPillText(destination.name, route.lengthM),
        startTitle: manualStart ? standHereText(tripStart) : 'Walk to the path first',
      }),
      'live',
    )
    mountFieldTest()
  }

  /** The field-test panel lives on the camera view, so it goes back on whenever that is drawn. */
  function mountFieldTest() {
    const host = root.querySelector('.ar')
    if (fieldTest && host) fieldTest.mount(host)
  }

  function toggleMap(force) {
    const host = root.querySelector('[data-compass-map]')
    const button = root.querySelector('[data-action="toggle-map"]')
    if (!host) return
    if (force === undefined) mapOpenedForPosition = false // the user's own choice now
    const expanded = host.classList.toggle('is-expanded', force)
    button.setAttribute('aria-expanded', String(expanded))
    button.setAttribute('aria-label', expanded ? 'Shrink map' : 'Expand map')
    render(root.querySelector('[data-map-expand]'), icon(expanded ? 'shrink' : 'expand', {size: 18}))
    compassMap?.setExpanded(expanded)
  }

  /** Swipe the open map down to put it away. A tap does the same. */
  function wireMapSwipe() {
    const tap = root.querySelector('[data-action="toggle-map"]')
    if (!tap) return
    let fromY = null
    tap.addEventListener('pointerdown', (event) => {
      fromY = event.clientY
    })
    tap.addEventListener('pointerup', (event) => {
      if (fromY == null) return
      const moved = event.clientY - fromY
      fromY = null
      if (moved < MAP_SWIPE_PX || !root.querySelector('[data-compass-map]')?.classList.contains('is-expanded')) return
      mapSwipedAt = performance.now()
      toggleMap()
    })
    tap.addEventListener('pointercancel', () => {
      fromY = null
    })
  }


  function onPhase(phase) {
    const card = root.querySelector('[data-start]')
    if (!card) return
    setStat('phase', phase)
    const wasHidden = card.hidden
    card.hidden = phase !== 'await-start' || !manualStart // a trip from GPS starts by itself
    if (wasHidden && !card.hidden) focusScreen(card)
    if (phase === 'ready') haptic([20, 60, 20])
  }

  function onArrived() {
    const host = root.querySelector('[data-arrival]')
    if (!host) return
    // A room inside a building (indoor AR off): stop at the door and carry on, on the indoor map.
    const inside = destination.category === 'room' && !INDOOR.indoorAR
    const entrance = inside ? entranceNameFor(destination, route.entrance ?? null, DESTINATIONS) : null
    showArrival(host, {name: destination.name, entrance})
  }

  function onStats(s) {
    fieldTest?.update(s)
    paintHints(s)
    followMapWhileUncertain(s.positionUncertain)
    if (s.locked && !wasLocked) haptic(18)
    wasLocked = s.locked
    paintStartCard(s)
    if (s.debug) paintLiveDebug(root, s)
    const minimap = root.querySelector('[data-minimap]')
    if (minimap && mapFailed && s.minimap) drawMinimap(minimap, s.minimap)
    paintDebugStats(root, s)
    paintStatusLine(s)
    paintLineUp(Boolean(s.lineUp), s.canRealign)
    paintEdgeArrow(s.edgeArrowDeg)
    paintIndoorUi(s)
    const pillText = root.querySelector('[data-trip-pill]')
    if (pillText && s.phase === 'ready') pillText.textContent = tripPillText(destination.name, s.remainingM)
  }

  /**
   * Not sure where the user is: open the 2D map with the route while the arrow is hidden, and put
   * it back once the position is good again, unless the user has opened or closed it meanwhile.
   */
  function followMapWhileUncertain(uncertain) {
    const open = root.querySelector('[data-compass-map]')?.classList.contains('is-expanded')
    if (uncertain && !open) {
      toggleMap(true)
      mapOpenedForPosition = true
    } else if (!uncertain && mapOpenedForPosition) {
      mapOpenedForPosition = false
      if (open) toggleMap(false)
    }
  }

  /** ?debug=1: one line saying why the floor arrows are, or are not, there. */
  function paintStatusLine(s) {
    const line = root.querySelector('[data-ar-status]')
    if (!line) return
    const below = Number.isFinite(s.floorBelowM) ? `${s.floorBelowM.toFixed(2)} m below` : '–'
    line.textContent = [
      `Tracking ${s.tracking ?? '–'}`,
      `floor ${s.floorSource ?? 'fallback'} ${below}`,
      `aligned ${s.aligned ? 'yes' : 'no'}`,
      `chevrons ${s.arrowsVisible ?? 0} visible, ${s.arrowsBlocked ?? 0} blocked`,
      `walls ${s.shellLoaded ? `level ${s.shellLevel}` : 'no'}`,
      `in view ${s.arrowsInView ?? 0}`,
    ].join(' · ')
  }

  /** Tap the floor in the camera view: that spot sets the floor height straight away. */
  function wireFloorTap() {
    const view = root.querySelector('.ar')
    if (!view) return
    view.addEventListener('click', (event) => {
      // Only a tap on the camera picture itself, not on a button, the map or a card, nor a line-up drag.
      if (performance.now() - lineUpDraggedAt < SWIPE_CLICK_MS) return
      if (event.target !== view && !event.target.matches?.('[data-canvas]')) return
      const box = view.getBoundingClientRect()
      if (trip?.tapFloor((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)) haptic(15)
    })
  }

  /** The line-up step: its card while open, the "Re-align" button otherwise. */
  function paintLineUp(open, canRealign = false) {
    const card = root.querySelector('[data-lineup]')
    const view = root.querySelector('.ar')
    const realign = root.querySelector('[data-action="realign"]')
    if (!card || !view) return
    if (open && !lineUpOpen) haptic(12)
    lineUpOpen = open
    card.hidden = !open
    view.classList.toggle('is-lining-up', open)
    if (realign) realign.hidden = open || !canRealign
  }

  /**
   * Line-up: a finger dragged left or right anywhere on the camera view turns the route about the
   * user. The whole width of the screen is LINE_UP_DEG_PER_WIDTH degrees.
   */
  function wireLineUpDrag() {
    const view = root.querySelector('.ar')
    if (!view) return
    let drag = null
    view.addEventListener('pointerdown', (event) => {
      if (!lineUpOpen || event.target.closest('button, a, .ar-map, [data-lineup]')) return
      drag = {id: event.pointerId, x: event.clientX, moved: 0}
      view.setPointerCapture?.(event.pointerId)
    })
    view.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x
      if (!dx) return
      drag.x = event.clientX
      drag.moved += Math.abs(dx)
      trip?.rotateRoute((dx / view.clientWidth) * LINE_UP_DEG_PER_WIDTH)
    })
    const end = (event) => {
      if (!drag || event.pointerId !== drag.id) return
      if (drag.moved > 6) lineUpDraggedAt = performance.now()
      drag = null
    }
    view.addEventListener('pointerup', end)
    view.addEventListener('pointercancel', end)
  }

  /**
   * No chevron in view: one small chevron at the screen edge, pointing the way to them. No text.
   * angleDeg: 0 = to the right, 90 = down (screen directions).
   */
  function paintEdgeArrow(angleDeg) {
    const el = root.querySelector('[data-edge-arrow]')
    if (!el) return
    el.hidden = angleDeg == null
    if (angleDeg == null) return
    const r = (angleDeg * Math.PI) / 180
    // On an ellipse just inside the screen edge, turned to point outwards.
    el.style.left = `${50 + Math.cos(r) * 42}%`
    el.style.top = `${50 + Math.sin(r) * 40}%`
    el.style.transform = `translate(-50%, -50%) rotate(${angleDeg + 90}deg)`
  }

  /** Indoors: "Go to Level n" at a stair or lift, and the "I'm here" button (lit when the walk keeps missing). */
  function paintIndoorUi(s) {
    const card = root.querySelector('[data-floor-change]')
    if (card) {
      card.hidden = !s.floorChange
      if (s.floorChange) {
        const {toLevel, up} = s.floorChange
        card.querySelector('[data-floor-text]').textContent = `Go to Level ${toLevel}`
        card.querySelector('[data-floor-button]').textContent = `I’m on Level ${toLevel}`
        render(card.querySelector('[data-floor-icon]'), icon(up ? 'arrowUp' : 'arrowDown', {size: 22}))
      }
    }
    const here = root.querySelector('[data-action="reanchor"]')
    if (here) {
      here.hidden = !s.canReanchor || Boolean(s.lineUp)
      here.dataset.offer = String(Boolean(s.offerReanchor))
    }
  }

  /** One thing to do at a time: only the most urgent of these shows. */
  /** The one status slot: only the most urgent message (ar-status.js), fading from one to the next. */
  function paintHints(s) {
    const slot = root.querySelector('[data-status-slot]')
    if (slot) {
      const message = statusMessage(s)
      const key = message?.key ?? ''
      if (slot.dataset.key !== key) {
        slot.dataset.key = key
        slot.classList.remove('is-showing')
        slot.hidden = !message
        if (message) {
          render(slot.querySelector('[data-status-icon]'), icon(message.icon, {size: 18}))
          slot.querySelector('[data-status-text]').textContent = message.text
          void slot.offsetWidth // restart the fade
          slot.classList.add('is-showing')
        }
      }
    }
    const live = root.querySelector('[data-action="go-live"]')
    if (live) live.hidden = !s.liveAvailable
    const repick = root.querySelector('[data-action="repick"]')
    if (repick) repick.hidden = !s.repick
  }

  function mapSettled() {
    const status = root.querySelector('[data-map-status]')
    if (status) status.hidden = true
  }

  /** The Start card: no directions in words, only whether to tap Start or reach the path first. */
  function paintStartCard(s) {
    const card = root.querySelector('[data-start]')
    if (!card) return
    // A trip from GPS only shows this if the user is too far from any path to place the route.
    if (!manualStart) card.hidden = !(s.phase === 'await-start' && s.startBlocked)
    if (card.hidden) return
    const start = card.querySelector('[data-action="start-walk"]')
    if (start.disabled === Boolean(s.canStart)) {
      start.disabled = !s.canStart
      card.querySelector('[data-start-label]').textContent = s.canStart ? 'Start' : 'Getting ready…'
    }
    if (s.routeBearingDeg == null || manualStart) return
    const far = s.startGapM > 25
    card.querySelector('[data-start-title]').textContent = far ? 'Walk to the path first' : 'Stand on the path and tap Start'
  }

  function onTracking(detail) {
    trip?.onTracking(detail)
    const {status, reason} = detail
    const chip = root.querySelector('[data-tracking-chip]')
    const label = root.querySelector('[data-tracking-label]')
    if (!chip) {
      if (status === 'NORMAL') haptic(18)
      return
    }
    if (status === 'NORMAL') {
      if (chip.dataset.tone !== 'ok') haptic(18)
      chip.dataset.tone = 'ok'
      label.textContent = 'Tracking'
      setStat('tracking', 'Ready', 'ok')
    } else {
      chip.dataset.tone = 'warn'
      label.textContent = reason === 'INITIALIZING' ? 'Starting tracking' : 'Tracking limited'
      setStat('tracking', reason === 'INITIALIZING' ? 'Starting…' : 'Limited', 'warn')
    }
  }

  function onCamera(status, reason) {
    if (status === 'ready') {
      root.querySelector('[data-veil]')?.classList.add('is-hidden')
      setStat('camera', 'Working', 'ok')
    } else if (status === 'requesting') {
      const t = root.querySelector('[data-veil-text]')
      if (t) t.textContent = 'Tap Allow to use the camera'
    } else if (status === 'denied') {
      showError('camera-denied')
    } else if (status === 'missing') {
      showError('camera-missing')
    } else {
      console.warn('[ar] camera failed', reason)
      showError('camera-failed')
    }
  }

  // ---------- error ----------
  function showError(code) {
    teardownSession()
    setView(errorView(errorCopy(code, device)), 'error')
  }

  // ---------- flow ----------
  async function begin() {
    showLoading()
    if (!navigator.onLine && !window.XR8) return showError('offline')

    let XR8
    let startSession
    try {
      // Three.js and the engine loader are fetched only now, keeping the home screen light.
      const engine = await import('../../ar/engine.js')
      startSession = engine.startSession
      XR8 = await engine.loadEngine(setProgress)
    } catch (err) {
      if (disposed) return
      return showError(err?.name === 'EngineError' ? err.code : navigator.onLine === false ? 'offline' : 'load-failed')
    }
    if (disposed) return

    showLive()
    const canvas = root.querySelector('[data-canvas]')
    const {createArTrip} = await import('../../ar/trip.js')
    if (disposed) return
    trip = createArTrip({route, origin, destination, allowDesktop, debug: showDebug, arriveLabel: arriveLabel(destination), onPhase, onStats, onArrived, onTurnClose: () => haptic(30), onTurnNow: () => haptic([30, 50, 30]), startPoint: tripStart, autoStart: !manualStart, reducedMotion: prefersReducedMotion(), onEnterCampus: () => showToast('Welcome to campus', {tone: 'success'})})
    wireMapSwipe()
    wireFloorTap()
    wireLineUpDrag()
    compassMap = createCompassMap(root.querySelector('[data-map-canvas]'), {
      getState: () => trip?.mapState() ?? null,
      onReady: () => {
        mapFailed = false
        mapSettled()
        const fallback = root.querySelector('[data-minimap]')
        if (fallback) fallback.hidden = true
      },
      onFailed: () => {
        mapFailed = true
        mapSettled()
        const fallback = root.querySelector('[data-minimap]')
        if (fallback) fallback.hidden = false
      },
    })
    stopSession = startSession(
      XR8,
      canvas,
      {
        onCamera,
        onTracking,
        onFrame: (fps) => {
          trip?.setFps(fps)
          setStat('fps', `${fps} fps`, fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad')
        },
        onError: (err) => showError(err.code),
        onSceneReady: (ctx) => trip?.onSceneReady(ctx),
        onTick: (t) => trip?.onTick(t),
      },
      {allowDesktop},
    )
    keepScreenOn()
  }

  async function keepScreenOn() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen')
    } catch {
      wakeLock = null // not supported or battery saver: harmless
    }
  }
  // The browser drops the wake lock when the tab is hidden; take it again on return.
  // Back from the background: the engine resumes tracking (engine.js); the trip starts its floor
  // search and walk match afresh and reopens the line-up step.
  let wasHidden = false
  const onVisibility = () => {
    if (document.hidden) {
      wasHidden = true
      return
    }
    if (stopSession && (!wakeLock || wakeLock.released)) keepScreenOn()
    if (wasHidden) trip?.onResume()
    wasHidden = false
  }
  document.addEventListener('visibilitychange', onVisibility)

  function teardownSession() {
    compassMap?.destroy()
    compassMap = null
    trip?.stop()
    trip = null
    if (stopSession) {
      stopSession()
      stopSession = null
    }
    wakeLock?.release?.().catch(() => {})
    wakeLock = null
  }

  offAction = onAction(root, actions)
  begin()

  return () => {
    disposed = true
    fieldTest?.destroy()
    document.removeEventListener('visibilitychange', onVisibility)
    teardownSession()
    offAction()
    delete root.dataset.arState
  }
}
