// AR screen. States, in order:
//   primer   explain the camera and motion prompts, one tap to continue
//   loading  download the AR engine with a real progress bar
//   live     camera feed + world tracking, with a live system check card
//   error    camera denied, motion denied, offline, timeout or engine crash; each says what to do
import {requestMotionPermission} from '../../ar/permissions.js'
import {parseUserAgent} from '../../ar/device.js'
import {haptic, html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'

const TRACKING_HINTS = {
  INITIALIZING: 'Move your phone slowly from side to side',
  TOO_MUCH_MOTION: 'Slow down a little',
  NOT_ENOUGH_TEXTURE: 'Point at the floor or a wall with some detail',
  UNSPECIFIED: 'Hold steady for a moment',
}

export function arScreen(root, {navigate, params}) {
  const allowDesktop = params.force === '1'
  const device = parseUserAgent(navigator.userAgent, {maxTouchPoints: navigator.maxTouchPoints})
  let stopSession = null
  let wakeLock = null
  let disposed = false
  let offAction = () => {}

  const actions = {
    exit: () => navigate('/'),
    map: () => navigate('/map'),
    start: () => begin(),
    retry: () => begin(),
    reload: () => window.location.reload(),
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
            <p class="eyebrow">One quick step</p>
            <h1 class="page__title" tabindex="-1">Allow camera and motion</h1>
            <p class="page__lede">
              The camera finds the floor and the Welcome AR signs. Motion sensors keep the arrows in place as you walk.
            </p>
            <ul class="primer__points">
              <li>${icon('lock', {size: 18})}<span>Video is processed on your phone and never uploaded.</span></li>
              <li>${icon('info', {size: 18})}<span>Your phone will ask for permission. Tap <strong>Allow</strong>.</span></li>
            </ul>
          </main>
          <footer class="page__footer">
            <button class="btn btn--primary btn--lg btn--block" data-action="start" data-autofocus>
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
          <button class="btn btn--ghost" data-action="exit">Cancel</button>
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
          <p class="ar__hint" data-hint>${TRACKING_HINTS.INITIALIZING}</p>
          <section class="ar__sheet" aria-label="System check">
            <h1 class="ar__sheet-title" tabindex="-1">System check</h1>
            <dl class="stats">
              <div class="stats__row"><dt>Camera</dt><dd data-stat="camera">Starting…</dd></div>
              <div class="stats__row"><dt>World tracking</dt><dd data-stat="tracking">Starting…</dd></div>
              <div class="stats__row"><dt>Frame rate</dt><dd data-stat="fps">–</dd></div>
            </dl>
          </section>
        </div>
      `,
      'live',
    )
  }

  function setStat(name, text, tone) {
    const el = root.querySelector(`[data-stat="${name}"]`)
    if (!el) return
    el.textContent = text
    if (tone) el.dataset.tone = tone
  }

  function onTracking({status, reason}) {
    const chip = root.querySelector('[data-tracking-chip]')
    const label = root.querySelector('[data-tracking-label]')
    const hint = root.querySelector('[data-hint]')
    if (!chip) return
    if (status === 'NORMAL') {
      if (chip.dataset.tone !== 'ok') haptic(18)
      chip.dataset.tone = 'ok'
      label.textContent = 'Tracking'
      hint.hidden = true
      setStat('tracking', 'Ready', 'ok')
    } else {
      chip.dataset.tone = 'warn'
      label.textContent = reason === 'INITIALIZING' ? 'Starting tracking' : 'Tracking limited'
      hint.hidden = false
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
            <button class="btn btn--primary btn--lg btn--block" data-action="${copy.primary.action}">
              ${icon(copy.primary.icon)}<span>${copy.primary.label}</span>
            </button>
            <button class="btn btn--secondary btn--lg btn--block" data-action="map">
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
    stopSession = startSession(
      XR8,
      canvas,
      {
        onCamera,
        onTracking,
        onFrame: (fps) => setStat('fps', `${fps} fps`, fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad'),
        onError: (err) => showError(err.code),
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
        body: 'AR needs the camera to see the floor and the signs. Turn it on, then try again.',
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
