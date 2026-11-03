// Location step: ask for GPS, wait until it is accurate enough, then open the camera.
// States: primer -> waiting (live accuracy) -> found -> (camera screen)
//         or error (denied, location off, timeout, unsupported), each with what to do next.
import {
  GPS,
  createFixGate,
  locationPermissionState,
  saveTripFix,
  watchLocation,
} from '../../geo/location.js'
import {parseUserAgent} from '../../ar/device.js'
import {findDestination} from '../../nav/destinations.js'
import {haptic, html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'

const CONTINUE_DELAY_MS = 900

export function locateScreen(root, {navigate, params}) {
  const destination = findDestination(params.to)
  if (!destination) {
    queueMicrotask(() => navigate('/search', {replace: true}))
    return
  }
  const device = parseUserAgent(navigator.userAgent, {maxTouchPoints: navigator.maxTouchPoints})
  const nextQuery = new URLSearchParams({to: destination.id})
  if (params.force === '1') nextQuery.set('force', '1')

  let stopWatch = null
  let gate = null
  let tick = null
  let continueTimer = null
  let disposed = false

  function setView(fragment, state) {
    root.dataset.locateState = state
    render(root, fragment)
  }

  // ---------- primer ----------
  function showPrimer() {
    setView(
      html`
        <div class="page page--narrow primer">
          <header class="page__bar">
            <button class="icon-btn" type="button" data-action="back" aria-label="Back">${icon('arrowLeft')}</button>
          </header>
          <main class="primer__body">
            <div class="primer__art" aria-hidden="true">
              <span class="primer__ring"></span>
              <span class="primer__ring primer__ring--2"></span>
              <span class="primer__icon">${icon('pin', {size: 40})}</span>
            </div>
            <p class="eyebrow">Step 2 of 3</p>
            <h1 class="page__title" tabindex="-1">Allow your location</h1>
            <p class="page__lede">
              We use GPS to plan the walk from where you are standing to the entrance of the ${destination.name}.
            </p>
            <ul class="primer__points">
              <li>${icon('lock', {size: 18})}<span>Your location stays on your phone. It is never stored or shared.</span></li>
              <li>${icon('sun', {size: 18})}<span>Works best outside, with a clear view of the sky.</span></li>
            </ul>
          </main>
          <footer class="page__footer">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="allow" data-autofocus>
              ${icon('pin')}<span>Allow location</span>
            </button>
          </footer>
        </div>
      `,
      'primer',
    )
  }

  // ---------- waiting / found ----------
  function showWaiting() {
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="gps-dial" data-dial data-level="searching" aria-hidden="true">
            <span class="gps-dial__pulse"></span>
            <span class="gps-dial__pulse gps-dial__pulse--2"></span>
            <span class="gps-dial__core">${icon('pin', {size: 30})}</span>
          </div>
          <h1 class="page__title" tabindex="-1" data-title>Finding your location…</h1>
          <p class="page__lede" data-body aria-live="polite">This usually takes a few seconds outdoors.</p>
          <div class="gps-meter" data-meter hidden>
            <div class="gps-meter__row">
              <span>GPS accuracy</span>
              <strong data-accuracy>–</strong>
            </div>
            <div class="gps-meter__track" aria-hidden="true"><span class="gps-meter__fill" data-fill></span></div>
            <p class="gps-meter__hint">Needs ±${GPS.goodAccuracyM} m or better</p>
          </div>
          <div class="note-card" data-indoors hidden>
            ${icon('info', {size: 20})}
            <p><strong>You may be indoors.</strong> GPS needs a clear view of the sky. Step outside, or use the 2D map.</p>
          </div>
          <div class="locate__actions">
            <button class="btn btn--secondary btn--block" type="button" data-action="map">
              ${icon('map')}<span>View 2D map instead</span>
            </button>
            <button class="btn btn--ghost" type="button" data-action="back">Cancel</button>
          </div>
        </div>
      `,
      'waiting',
    )
  }

  function paint(s) {
    const dial = root.querySelector('[data-dial]')
    if (!dial) return
    const title = root.querySelector('[data-title]')
    const body = root.querySelector('[data-body]')
    const meter = root.querySelector('[data-meter]')
    root.querySelector('[data-indoors]').hidden = !s.indoors

    if (s.status === 'searching') return
    meter.hidden = false
    const acc = Math.round(s.accuracy)
    root.querySelector('[data-accuracy]').textContent = Number.isFinite(acc) ? `±${acc} m` : 'unknown'
    // Bar: full at ≤ 5 m, empty at ≥ 60 m.
    const fill = Math.max(0.04, Math.min(1, (60 - s.accuracy) / 55))
    root.querySelector('[data-fill]').style.transform = `scaleX(${fill})`
    meter.dataset.level = s.level
    dial.dataset.level = s.status === 'ready' ? 'ready' : 'weak'

    if (s.status === 'weak') {
      title.textContent = 'Weak GPS – move into the open'
      body.textContent = 'Step away from tall buildings and trees. We will carry on as soon as the signal is good.'
    } else if (s.status === 'ready') {
      title.textContent = 'Location found'
      body.textContent = `Accurate to about ${acc} m. Opening the camera…`
    }
  }

  function onFix(position) {
    if (disposed || !gate) return
    const s = gate.update(position)
    paint(s)
    if (s.status === 'ready' && !continueTimer) {
      haptic(18)
      saveTripFix(s.fix)
      continueTimer = setTimeout(() => {
        if (!disposed) navigate(`/ar?${nextQuery}`, {replace: true})
      }, CONTINUE_DELAY_MS)
    } else if (s.status !== 'ready' && continueTimer) {
      // Accuracy dropped again before we left: keep waiting.
      clearTimeout(continueTimer)
      continueTimer = null
    }
  }

  function start() {
    stop()
    showWaiting()
    gate = createFixGate()
    stopWatch = watchLocation({onFix, onError: showError})
    // Re-check once a second so the "indoors" hint appears even when no fixes arrive.
    tick = setInterval(() => gate && paint(gate.check()), 1000)
  }

  function stop() {
    stopWatch?.()
    stopWatch = null
    clearInterval(tick)
    clearTimeout(continueTimer)
    continueTimer = null
  }

  // ---------- errors ----------
  function showError(code) {
    if (disposed) return
    stop()
    const copy = locationErrorCopy(code, device)
    setView(
      html`
        <div class="page page--narrow page--center error-state">
          <span class="error-state__icon" data-tone="${copy.tone}">${icon(copy.icon, {size: 32})}</span>
          <h1 class="page__title" tabindex="-1">${copy.title}</h1>
          <p class="page__lede">${copy.body}</p>
          ${copy.steps ? html`<ol class="steps-list">${copy.steps.map((s) => html`<li>${s}</li>`)}</ol>` : ''}
          <div class="error-state__actions">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="${copy.primary.action}">
              ${icon('refresh')}<span>${copy.primary.label}</span>
            </button>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map">
              ${icon('map')}<span>View 2D map instead</span>
            </button>
          </div>
        </div>
      `,
      'error',
    )
  }

  const off = onAction(root, {
    back: () => navigate('/search'),
    allow: () => start(),
    retry: () => start(),
    reload: () => window.location.reload(),
    map: () => navigate(`/map?to=${encodeURIComponent(destination.id)}`),
  })

  // Skip the explanation if the user already allowed location; explain first otherwise.
  locationPermissionState().then((state) => {
    if (disposed) return
    if (state === 'granted') start()
    else if (state === 'denied') showError('denied')
    else showPrimer()
  })

  return () => {
    disposed = true
    stop()
    off()
    delete root.dataset.locateState
  }
}

/** Plain words for each failure, with steps for iPhone or Android. */
export function locationErrorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  switch (code) {
    case 'denied':
      return {
        icon: 'pin',
        tone: 'warn',
        title: 'Location access is off',
        body: 'Directions need your location to know where you are starting from.',
        steps: ios
          ? [
              'Tap “aA” in the Safari address bar, then Website Settings.',
              'Set Location to Allow.',
              'Still blocked? Open Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.',
            ]
          : ['Tap the icon left of the address bar.', 'Tap Permissions.', 'Turn on Location.'],
        primary: {action: 'reload', label: 'Try again'},
      }
    case 'unavailable':
      return {
        icon: 'pin',
        tone: 'warn',
        title: 'Your location is turned off',
        body: 'Your phone could not find its position. Location may be switched off.',
        steps: ios
          ? ['Open Settings → Privacy & Security.', 'Turn on Location Services.', 'Come back and tap Try again.']
          : ['Swipe down from the top of the screen.', 'Turn on Location.', 'Come back and tap Try again.'],
        primary: {action: 'retry', label: 'Try again'},
      }
    case 'timeout':
      return {
        icon: 'sun',
        tone: 'warn',
        title: 'We could not find you',
        body: 'GPS took too long. Step outside, away from tall buildings, and try again.',
        primary: {action: 'retry', label: 'Try again'},
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'Location is not available',
        body: 'This browser cannot share your location. Try Safari on iPhone or Chrome on Android.',
        primary: {action: 'retry', label: 'Try again'},
      }
  }
}
