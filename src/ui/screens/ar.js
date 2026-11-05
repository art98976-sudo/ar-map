// AR screen. States, in order:
//   loading  download the AR engine with a real progress bar
//   live     camera feed + world tracking: the exit button, the arrows and one pill.
//            Everything else on this screen appears only with ?debug=1.
//   error    camera denied, motion denied, offline, timeout or engine crash; each says what to do
import {permissionsAllowed} from '../../ar/permissions.js'
import {parseUserAgent} from '../../ar/device.js'
import {findDestination} from '../../nav/destinations.js'
import {readTripRoute} from '../../nav/route.js'
import {readTripFix} from '../../geo/location.js'
import {formatDistance} from '../../arrows/pin.js'
import {showArrival} from '../components/arrival.js'
import {drawMinimap} from '../components/ar-minimap.js'
import {haptic, html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'

const WALK_MPS = 1.3
const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** "north-east" for a bearing in degrees. */
export function compassPoint(deg) {
  return COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/** How the pill names the end of the walk: "Pathfoot entrance", but not "Bus Hub entrance". */
export function arriveLabel({name, category}) {
  const short = name.replace(/ Building$/, '')
  return category === 'bus' || category === 'landmark' ? short : `${short} entrance`
}

/** The one line on the AR screen: "Pathfoot · 120 m · 2 min". */
export function tripPillText(name, metres) {
  const minutes = Math.max(1, Math.round(metres / WALK_MPS / 60))
  return `${name.replace(/ Building$/, '')} · ${formatDistance(metres)} · ${minutes} min`
}

export function arScreen(root, {navigate, params}) {
  const allowDesktop = params.force === '1'
  const showDebug = params.debug === '1' || new URLSearchParams(window.location.search).get('debug') === '1'
  // Every trip starts with a destination. Without one, go and pick it first.
  const destination = findDestination(params.to)
  if (!destination) {
    // Defer, so the router finishes mounting this screen before it switches again.
    queueMicrotask(() => navigate('/', {replace: true}))
    return
  }
  // The walking route and the one permission tap happen on the location screen. Without them, go back.
  const route = readTripRoute()
  const origin = readTripFix() || route?.origin
  if (!route || route.destinationId !== destination.id || !origin || !permissionsAllowed()) {
    const debugQuery = params.debug === '1' ? '&debug=1' : ''
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

  const actions = {
    exit: () => navigate('/'),
    done: () => navigate('/'),
    'start-walk': () => {
      const result = trip?.start()
      const note = root.querySelector('[data-start-note]')
      if (note) note.hidden = result !== 'look'
    },
    map: () => navigate(`/?to=${encodeURIComponent(destination.id)}`),
    retry: () => begin(),
    reload: () => window.location.reload(),
    debug: () => toggleDebug(),
    recalibrate: () => {
      trip?.recalibrate()
      toggleDebug(false)
    },
  }

  function setView(fragment, state) {
    root.dataset.arState = state
    render(root, fragment)
  }

  // ---------- loading ----------
  function showLoading() {
    setView(
      html`
        <div class="page page--narrow page--center loading">
          <div class="progress-ring" style="--p: 0" data-progress role="progressbar" aria-label="Loading AR" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="progress-ring__track" cx="60" cy="60" r="52" />
              <circle class="progress-ring__bar" cx="60" cy="60" r="52" pathLength="100" />
            </svg>
            <span class="progress-ring__value" data-progress-text>0%</span>
          </div>
          <h1 class="page__title" tabindex="-1">Preparing AR</h1>
          <p class="page__lede" data-loading-text>Downloading the AR engine. This happens once.</p>
          <button class="btn btn--ghost" type="button" data-action="exit" aria-label="Cancel">Cancel</button>
        </div>
      `,
      'loading',
    )
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
    setView(
      html`
        <div class="ar">
          <canvas class="ar__canvas" data-canvas aria-label="Camera view"></canvas>
          <div class="ar__veil" data-veil>
            <span class="spinner" aria-hidden="true"></span>
            <p data-veil-text>Waiting for the camera…</p>
          </div>
          <header class="ar__top">
            <button class="icon-btn icon-btn--glass" data-action="exit" aria-label="Exit AR">${icon('close')}</button>
            ${showDebug
              ? html`<div class="chip chip--glass" data-tracking-chip data-tone="pending" aria-live="polite">
                  <span class="chip__dot"></span><span data-tracking-label>Starting tracking</span>
                </div>`
              : ''}
          </header>
          ${showDebug
            ? html`<button class="debug-toggle chip chip--glass" type="button" data-action="debug" aria-label="Show debug panel" aria-expanded="false" aria-controls="ar-debug">
                ${icon('info', {size: 16})}<span>Debug</span>
              </button>`
            : ''}
          <div class="ar__hints">
          <p class="ar__hint" data-compass-pill role="status" hidden>Wave your phone in a figure-8</p>
          <p class="ar__hint" data-hint role="status" hidden>Move your phone slowly</p>
          <p class="ar__hint" data-lock-hint role="status" hidden>Walk a few steps to lock the arrows</p>
          <p class="ar__hint" data-reroute-hint role="status" hidden>Off route - finding a new route</p>
          <p class="ar__hint" data-approx-hint role="status" ${route.source === 'direct' ? '' : 'hidden'}>Approximate route - check the 2D map</p>
          <p class="ar__hint ar__hint--guide" data-guidance hidden></p>
          </div>

          <section class="ar-guide" data-start aria-labelledby="start-title" hidden>
            <span class="ar-guide__icon" data-start-arrow hidden>${icon('arrowUp', {size: 28})}</span>
            <h1 class="ar-guide__title" id="start-title" tabindex="-1">Stand on the path and face the way you'll walk</h1>
            <p class="ar-guide__text" data-start-direction></p>
            <p class="ar-guide__text" data-start-note role="status" hidden>Hold your phone up, looking ahead.</p>
            <button class="btn btn--primary btn--block" type="button" data-action="start-walk" aria-label="Start" disabled>Start</button>
          </section>

          <p class="ar-pill" data-trip-pill>${tripPillText(destination.name, route.lengthM)}</p>

          <div class="arrival" data-arrival hidden></div>

          ${showDebug
            ? html`<section class="ar-live" data-live-debug aria-label="Live alignment">
                <canvas class="ar-live__map" data-minimap width="280" height="280" aria-label="Minimap of the route, the walked track and the camera direction"></canvas>
                <dl class="ar-live__rows">
                  <div><dt>Compass</dt><dd data-live="compass">–</dd></div>
                  <div><dt>Source</dt><dd data-live="source">–</dd></div>
                  <div><dt>Tilt (beta)</dt><dd data-live="beta">–</dd></div>
                  <div><dt>SLAM yaw</dt><dd data-live="camera">–</dd></div>
                  <div><dt>Align yaw</dt><dd data-live="align">–</dd></div>
                  <div><dt>1st segment</dt><dd data-live="segment">–</dd></div>
                  <div><dt>Look (route)</dt><dd data-live="look">–</dd></div>
                </dl>
              </section>`
            : ''}

          ${showDebug
            ? html`<section class="ar-debug" id="ar-debug" data-debug hidden aria-label="Debug panel">
            <h2 class="ar__sheet-title">Debug</h2>
            <dl class="stats">
              <div class="stats__row"><dt>Camera</dt><dd data-stat="camera">Starting…</dd></div>
              <div class="stats__row"><dt>World tracking</dt><dd data-stat="tracking">Starting…</dd></div>
              <div class="stats__row"><dt>Phase</dt><dd data-stat="phase">–</dd></div>
              <div class="stats__row"><dt>GPS accuracy</dt><dd data-stat="gps">–</dd></div>
              <div class="stats__row"><dt>Compass heading</dt><dd data-stat="heading">–</dd></div>
              <div class="stats__row"><dt>To entrance (route)</dt><dd data-stat="remaining">–</dd></div>
              <div class="stats__row"><dt>To entrance (GPS)</dt><dd data-stat="gpsdist">–</dd></div>
              <div class="stats__row"><dt>Off route</dt><dd data-stat="offroute">–</dd></div>
              <div class="stats__row"><dt>Route match</dt><dd data-stat="match">–</dd></div>
              <div class="stats__row"><dt>Match quality</dt><dd data-stat="quality">–</dd></div>
              <div class="stats__row"><dt>Next manoeuvre</dt><dd data-stat="turn">–</dd></div>
              <div class="stats__row"><dt>Arrows drawn</dt><dd data-stat="arrows">–</dd></div>
              <div class="stats__row"><dt>Camera height</dt><dd data-stat="height">–</dd></div>
              <div class="stats__row"><dt>Ground</dt><dd data-stat="ground">–</dd></div>
              <div class="stats__row"><dt>Route source</dt><dd data-stat="source">${route.source}</dd></div>
              <div class="stats__row"><dt>Frame rate</dt><dd data-stat="fps">–</dd></div>
            </dl>
            <button class="btn btn--secondary btn--block" type="button" data-action="recalibrate" aria-label="Recalibrate compass">
              ${icon('compass')}<span>Recalibrate compass</span>
            </button>
          </section>`
            : ''}
        </div>
      `,
      'live',
    )
  }

  function onPhase(phase) {
    const card = root.querySelector('[data-start]')
    if (!card) return
    setStat('phase', phase)
    card.hidden = phase !== 'await-start'
    if (phase === 'ready') haptic([20, 60, 20])
  }

  function onArrived() {
    const host = root.querySelector('[data-arrival]')
    if (host) showArrival(host, {name: destination.name})
  }

  function onStats(s) {
    const hint = root.querySelector('[data-hint]')
    if (hint) hint.hidden = !s.trackingStalled
    const pill = root.querySelector('[data-compass-pill]')
    if (pill) pill.hidden = !s.compassUnsteady
    const lock = root.querySelector('[data-lock-hint]')
    if (lock) lock.hidden = s.phase !== 'ready' || s.locked
    if (s.locked && !wasLocked) haptic(18)
    wasLocked = s.locked
    paintStartCard(s)
    if (s.debug) paintLiveDebug(s)
    const guidance = root.querySelector('[data-guidance]')
    if (guidance) {
      guidance.hidden = !s.instruction
      if (s.instruction && guidance.textContent !== s.instruction) guidance.textContent = s.instruction
    }
    const rerouteHint = root.querySelector('[data-reroute-hint]')
    if (rerouteHint) rerouteHint.hidden = !s.rerouting
    const approx = root.querySelector('[data-approx-hint]')
    if (approx) approx.hidden = s.source !== 'direct'
    const fmt = (m) => (m == null ? '–' : formatDistance(m))
    setStat('gps', s.gpsAccuracy == null ? 'waiting…' : `±${Math.round(s.gpsAccuracy)} m`, s.gpsAccuracy != null && s.gpsAccuracy <= 20 ? 'ok' : 'warn')
    setStat(
      'heading',
      s.heading == null ? (s.compassSource === 'none' ? 'no compass' : 'waiting…') : `${Math.round(s.heading)}° (${s.compassSource})`,
    )
    setStat('remaining', fmt(s.remainingM))
    setStat('gpsdist', fmt(s.gpsToEntranceM))
    setStat('offroute', s.offRouteM == null ? '–' : `${s.offRouteM.toFixed(1)} m`)
    setStat('match', `${s.matchOffsetM.toFixed(1)} m, ${s.matchYawDeg.toFixed(1)}°${s.matchFlipped ? ', flipped' : ''}`)
    setStat('quality', s.matchResidualM == null ? 'walk 8 m first' : `${s.matchResidualM.toFixed(2)} m`, s.matchResidualM != null && s.matchResidualM < 1 ? 'ok' : 'warn')
    setStat('turn', s.nextManoeuvre ? `${s.nextManoeuvre.type}, ${formatDistance(Math.max(0, s.nextManoeuvre.s - s.userS))}` : '–')
    setStat('source', `${s.source}, ${s.routePoints} points`, s.source === 'direct' ? 'warn' : 'ok')
    setStat('arrows', `${s.arrows} of ${s.arrowTotal}`)
    setStat('height', `${s.cameraHeight.toFixed(2)} m`)
    if (s.groundHeight != null) {
      setStat('ground', `${s.groundHeight.toFixed(2)} m, ${(s.groundSlope * 100).toFixed(0)}%, ${s.groundHits} hits (${s.groundSource})`, s.groundSource === 'hits' ? 'ok' : 'warn')
    }
    const pillText = root.querySelector('[data-trip-pill]')
    if (pillText && s.phase === 'ready') pillText.textContent = tripPillText(destination.name, s.remainingM)
  }

  /** Which way the route goes from here: the arrow needs a compass, the words do not. */
  function paintStartCard(s) {
    const card = root.querySelector('[data-start]')
    if (!card || card.hidden) return
    card.querySelector('[data-action="start-walk"]').disabled = !s.canStart
    if (s.routeBearingDeg == null) return
    card.querySelector('[data-start-direction]').textContent = `The route heads ${compassPoint(s.routeBearingDeg)} from here.`
    const arrow = card.querySelector('[data-start-arrow]')
    arrow.hidden = s.heading == null
    if (s.heading != null) arrow.style.transform = `rotate(${Math.round(s.routeBearingDeg - s.heading)}deg)`
  }

  function paintLiveDebug(s) {
    const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`)
    const live = {
      compass: deg(s.heading),
      source: s.compassSource ?? '–',
      beta: deg(s.debug.beta),
      camera: deg(s.debug.cameraYawDeg),
      align: deg(s.yawDeg),
      segment: deg(s.debug.firstSegmentDeg),
      look: deg(s.debug.lookDeg),
    }
    for (const [name, text] of Object.entries(live)) {
      const el = root.querySelector(`[data-live="${name}"]`)
      if (el) el.textContent = text
    }
    drawMinimap(root.querySelector('[data-minimap]'), s.debug)
  }

  function toggleDebug(force) {
    const panel = root.querySelector('[data-debug]')
    const btn = root.querySelector('[data-action="debug"]')
    if (!panel) return
    const show = force ?? panel.hidden
    panel.hidden = !show
    btn?.setAttribute('aria-expanded', String(show))
    btn?.setAttribute('aria-label', show ? 'Hide debug panel' : 'Show debug panel')
  }

  function setStat(name, text, tone) {
    const el = root.querySelector(`[data-stat="${name}"]`)
    if (!el) return
    el.textContent = text
    if (tone) el.dataset.tone = tone
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
    const copy = errorCopy(code, device)
    setView(
      html`
        <div class="page page--narrow page--center error-state">
          <span class="error-state__icon" data-tone="${copy.tone}">${icon(copy.icon, {size: 32})}</span>
          <h1 class="page__title" tabindex="-1">${copy.title}</h1>
          <p class="page__lede">${copy.body}</p>
          ${copy.steps
            ? html`<ol class="steps-list">
                ${copy.steps.map((s) => html`<li>${s}</li>`)}
              </ol>`
            : ''}
          <div class="error-state__actions">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="${copy.primary.action}" aria-label="${copy.primary.label}">
              ${icon(copy.primary.icon)}<span>${copy.primary.label}</span>
            </button>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="View 2D map instead">
              ${icon('map')}<span>View 2D map instead</span>
            </button>
          </div>
        </div>
      `,
      'error',
    )
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
    trip = createArTrip({route, origin, destination, allowDesktop, debug: showDebug, arriveLabel: arriveLabel(destination), onPhase, onStats, onArrived, onTurnClose: () => haptic(30)})
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
  const onVisibility = () => {
    if (!document.hidden && stopSession && (!wakeLock || wakeLock.released)) keepScreenOn()
  }
  document.addEventListener('visibilitychange', onVisibility)

  function teardownSession() {
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
    document.removeEventListener('visibilitychange', onVisibility)
    teardownSession()
    offAction()
    delete root.dataset.arState
  }
}

/** What to tell the user for each failure. Plain words, and always a next step. */
export function errorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  switch (code) {
    case 'camera-denied':
      return {
        icon: 'camera',
        tone: 'warn',
        title: 'Camera access is off',
        body: 'AR needs the camera to see the ground and draw the arrows. Turn it on, then try again.',
        steps: ios
          ? ['Tap “aA” in the Safari address bar.', 'Tap Website Settings.', 'Set Camera to Allow.']
          : ['Tap the icon left of the address bar.', 'Tap Permissions.', 'Turn on Camera.'],
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'motion-denied':
      return {
        icon: 'compass',
        tone: 'warn',
        title: 'Motion access is off',
        body: 'Motion sensors keep the arrows fixed to the floor while you walk.',
        steps: ios
          ? ['Close this tab.', 'Open the Welcome AR link again.', 'Tap Allow when Safari asks about motion.']
          : ['Reload the page and allow motion sensors.'],
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'offline':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: 'You are offline',
        body: 'Connect to Wi-Fi (eduroam works) or mobile data to download AR the first time.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
    case 'timeout':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: 'This is taking too long',
        body: 'The connection looks slow. Move closer to Wi-Fi and try again.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
    case 'camera-missing':
      return {
        icon: 'camera',
        tone: 'bad',
        title: 'No rear camera found',
        body: 'AR needs the camera on the back of your phone. Try a different phone, or use the 2D map.',
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'camera-failed':
      return {
        icon: 'camera',
        tone: 'bad',
        title: 'The camera did not start',
        body: 'Another app may be using it. Close other camera apps, then try again.',
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'runtime':
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'AR stopped',
        body: 'Something went wrong on this device. Reloading usually fixes it.',
        primary: {action: 'reload', label: 'Reload', icon: 'refresh'},
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'AR could not load',
        body: 'Check your connection and try again.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
  }
}
