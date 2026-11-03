// AR screen. States, in order:
//   primer   explain the camera and motion prompts, one tap to continue
//   loading  download the AR engine with a real progress bar
//   live     camera feed + world tracking, with a live system check card
//   error    camera denied, motion denied, offline, timeout or engine crash; each says what to do
import {requestMotionPermission} from '../../ar/permissions.js'
import {parseUserAgent} from '../../ar/device.js'
import {findDestination} from '../../nav/destinations.js'
import {readTripRoute} from '../../nav/route.js'
import {readTripFix} from '../../geo/location.js'
import {formatDistance} from '../../arrows/pin.js'
import {showToast} from '../components/toast.js'
import {describeDestination} from '../../nav/search.js'
import {haptic, html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'

const TRACKING_HINTS = {
  INITIALIZING: 'Move your phone slowly from side to side',
  TOO_MUCH_MOTION: 'Slow down a little',
  NOT_ENOUGH_TEXTURE: 'Point at the floor or a wall with some detail',
  UNSPECIFIED: 'Hold steady for a moment',
}

export function arScreen(root, {navigate, params}) {
  const allowDesktop = params.force === '1'
  // Every trip starts with a destination. Without one, go and pick it first.
  const destination = findDestination(params.to)
  if (!destination) {
    // Defer, so the router finishes mounting this screen before it switches again.
    queueMicrotask(() => navigate(`/search${allowDesktop ? '?force=1' : ''}`, {replace: true}))
    return
  }
  // The walking route is planned on the location screen. Without one, go back there.
  const route = readTripRoute()
  const origin = readTripFix() || route?.origin
  if (!route || route.destinationId !== destination.id || !origin) {
    queueMicrotask(() => navigate(`/locate?to=${encodeURIComponent(destination.id)}${allowDesktop ? '&force=1' : ''}`, {replace: true}))
    return
  }
  const device = parseUserAgent(navigator.userAgent, {maxTouchPoints: navigator.maxTouchPoints})
  let trip = null
  let stopSession = null
  let wakeLock = null
  let disposed = false
  let offAction = () => {}

  const actions = {
    exit: () => navigate('/'),
    change: () => navigate(`/search${allowDesktop ? '?force=1' : ''}`),
    map: () => navigate(`/map?to=${encodeURIComponent(destination.id)}`),
    start: () => begin(),
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

  // ---------- primer ----------
  function showPrimer() {
    setView(
      html`
        <div class="page page--narrow primer">
          <header class="page__bar">
            <button class="icon-btn" data-action="exit" aria-label="Back">${icon('arrowLeft')}</button>
          </header>
          <main class="primer__body">
            <div class="primer__art" aria-hidden="true">
              <span class="primer__ring"></span>
              <span class="primer__ring primer__ring--2"></span>
              <span class="primer__icon">${icon('camera', {size: 40})}</span>
            </div>
            <div class="dest-card" data-destination>
              <span class="dsearch__badge" data-category="${destination.category}">
                ${icon(CATEGORY_ICON[destination.category] || 'pin', {size: 20})}
              </span>
              <span class="dest-card__text">
                <span class="dest-card__label">Directions to</span>
                <strong class="dest-card__name">${destination.name}</strong>
                ${describeDestination(destination) ? html`<span class="dest-card__meta">${describeDestination(destination)}</span>` : ''}
              </span>
              <button class="dest-card__change" type="button" data-action="change" aria-label="Change destination">Change</button>
            </div>
            <p class="eyebrow">Step 3 of 3</p>
            <h1 class="page__title" tabindex="-1">Allow camera and motion</h1>
            <p class="page__lede" id="primer-lede">
              The camera finds the ground so the arrows can be drawn on it. Motion sensors and the compass keep them
              pointing the right way as you walk.
            </p>
            <p class="route-summary" data-route-summary>
              ${icon('footsteps', {size: 18})}<span>${formatDistance(route.lengthM)} walk · about ${route.minutes} min</span>
            </p>
            <ul class="primer__points">
              <li>${icon('lock', {size: 18})}<span>Video is processed on your phone and never uploaded.</span></li>
              <li>${icon('info', {size: 18})}<span>Your phone will ask for permission. Tap <strong>Allow</strong>.</span></li>
            </ul>
          </main>
          <footer class="page__footer">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="start" aria-label="Allow and start" aria-describedby="primer-lede" data-autofocus>
              ${icon('camera')}<span>Allow and start</span>
            </button>
          </footer>
        </div>
      `,
      'primer',
    )
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
            <div class="chip chip--glass" data-tracking-chip data-tone="pending" aria-live="polite">
              <span class="chip__dot"></span><span data-tracking-label>Starting tracking</span>
            </div>
          </header>
          <p class="ar__dest chip chip--glass" data-ar-destination>
            ${icon('pin', {size: 16})}<span>To <strong>${destination.name}</strong></span>
          </p>
          <button class="debug-toggle chip chip--glass" type="button" data-action="debug" aria-label="Show debug panel" aria-expanded="false" aria-controls="ar-debug">
            ${icon('info', {size: 16})}<span>Debug</span>
          </button>
          <p class="ar__hint" data-hint>${TRACKING_HINTS.INITIALIZING}</p>

          <section class="ar-guide" data-guide aria-live="polite" hidden>
            <span class="ar-guide__icon" data-guide-icon></span>
            <h1 class="ar-guide__title" tabindex="-1" data-guide-title></h1>
            <p class="ar-guide__text" data-guide-text></p>
            <div class="ar-guide__bar" data-guide-bar hidden><span data-guide-fill></span></div>
            <button class="btn btn--secondary btn--block" type="button" data-guide-map data-action="map" aria-label="View 2D map instead" hidden>
              ${icon('map')}<span>View 2D map instead</span>
            </button>
          </section>

          <section class="trip-card" data-trip-card aria-label="Trip">
            <span class="dsearch__badge" data-category="${destination.category}">
              ${icon(CATEGORY_ICON[destination.category] || 'pin', {size: 20})}
            </span>
            <div class="trip-card__text">
              <strong>${destination.name}</strong>
              <span data-trip-remaining>${formatDistance(route.lengthM)} · about ${route.minutes} min</span>
            </div>
          </section>

          <section class="ar-debug" id="ar-debug" data-debug hidden aria-label="Debug panel">
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
              <div class="stats__row"><dt>Arrows drawn</dt><dd data-stat="arrows">–</dd></div>
              <div class="stats__row"><dt>Camera height</dt><dd data-stat="height">–</dd></div>
              <div class="stats__row"><dt>Route source</dt><dd data-stat="source">${route.source}</dd></div>
              <div class="stats__row"><dt>Frame rate</dt><dd data-stat="fps">–</dd></div>
            </dl>
            <button class="btn btn--secondary btn--block" type="button" data-action="recalibrate" aria-label="Recalibrate compass">
              ${icon('compass')}<span>Recalibrate compass</span>
            </button>
          </section>
        </div>
      `,
      'live',
    )
  }

  // ---------- guide card (ground -> compass -> ready) ----------
  const GUIDE = {
    ground: {
      icon: 'scan',
      title: 'Find the ground',
      text: 'Point your phone at the ground a few steps ahead and move it slowly from side to side.',
    },
    compass: {icon: 'compass', title: 'Hold your phone upright', text: 'Stand still for 3 seconds while we find north.'},
    unsteady: {icon: 'compass', title: 'Move your phone in a figure-8 to calibrate', text: 'Then hold it upright and still again.'},
    tilt: {icon: 'phone', title: 'Hold your phone upright', text: 'Point the camera straight ahead, not at the ground.'},
    'no-compass': {
      icon: 'alert',
      title: 'No compass found',
      text: 'This phone does not share its compass with the browser, so the arrows cannot point the right way.',
    },
  }

  let currentPhase = null
  function onPhase(phase, detail = {}) {
    const card = root.querySelector('[data-guide]')
    if (!card) return
    currentPhase = phase
    setStat('phase', phase)
    // Tracking tips ("move slowly…") only matter while finding the ground.
    if (phase !== 'ground') root.querySelector('[data-hint]').hidden = true
    if (phase === 'ready') {
      card.hidden = true
      haptic([20, 60, 20])
      showToast(`Follow the arrows to the ${destination.name}`, {tone: 'success'})
      return
    }
    const key = phase === 'compass' && detail.issue ? detail.issue : phase
    const copy = GUIDE[key] || GUIDE.ground
    card.hidden = false
    card.dataset.kind = key
    root.querySelector('[data-guide-icon]').innerHTML = icon(copy.icon, {size: 28}).value
    root.querySelector('[data-guide-title]').textContent = copy.title
    root.querySelector('[data-guide-text]').textContent = copy.text
    const bar = root.querySelector('[data-guide-bar]')
    bar.hidden = key !== 'compass'
    root.querySelector('[data-guide-fill]').style.transform = `scaleX(${detail.progress || 0})`
    root.querySelector('[data-guide-map]').hidden = phase !== 'no-compass'
  }

  function onStats(s) {
    const fmt = (m) => (m == null ? '–' : formatDistance(m))
    setStat('gps', s.gpsAccuracy == null ? 'waiting…' : `±${Math.round(s.gpsAccuracy)} m`, s.gpsAccuracy != null && s.gpsAccuracy <= 20 ? 'ok' : 'warn')
    setStat(
      'heading',
      s.heading == null ? (s.compassSource === 'none' ? 'no compass' : 'waiting…') : `${Math.round(s.heading)}° (${s.compassSource})`,
    )
    setStat('remaining', fmt(s.remainingM))
    setStat('gpsdist', fmt(s.gpsToEntranceM))
    setStat('offroute', s.offRouteM == null ? '–' : `${s.offRouteM.toFixed(1)} m`)
    setStat('arrows', `${s.arrows} of ${s.arrowTotal}`)
    setStat('height', `${s.cameraHeight.toFixed(2)} m`)
    const remaining = root.querySelector('[data-trip-remaining]')
    if (remaining && s.phase === 'ready') {
      const minutes = Math.max(1, Math.round(s.remainingM / 1.3 / 60))
      remaining.textContent = `${formatDistance(s.remainingM)} · about ${minutes} min`
    }
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
    const hint = root.querySelector('[data-hint]')
    if (!chip) return
    const showHints = currentPhase === null || currentPhase === 'ground'
    if (status === 'NORMAL') {
      if (chip.dataset.tone !== 'ok') haptic(18)
      chip.dataset.tone = 'ok'
      label.textContent = 'Tracking'
      hint.hidden = true
      setStat('tracking', 'Ready', 'ok')
    } else {
      chip.dataset.tone = 'warn'
      label.textContent = reason === 'INITIALIZING' ? 'Starting tracking' : 'Tracking limited'
      hint.hidden = !showHints
      hint.textContent = TRACKING_HINTS[reason] || TRACKING_HINTS.UNSPECIFIED
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
    // Must run first, inside the tap, or iPhone will not show the motion prompt.
    const motion = requestMotionPermission()
    showLoading()
    if ((await motion) === 'denied') return showError('motion-denied')
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
    trip = createArTrip({route, origin, destination, allowDesktop, onPhase, onStats})
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
  showPrimer()

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
