// Location step: waits for the permission answers, then until GPS is accurate enough, then
// opens the camera. The permissions were requested in the tap that chose the destination.
// States: waiting (live accuracy) -> found -> (camera screen)
//         or error (denied, location off, timeout, unsupported), each with what to do next.
//         tap: after a reload the iPhone has forgotten motion, so one small button asks again.
import {
  createFixGate,
  locationPermissionState,
  saveTripFix,
  watchLocation,
} from '../../geo/location.js'
import {deviceIssue, parseUserAgent} from '../../ar/device.js'
import {
  permissionsAllowed,
  settlePermissions,
  startPermissionRequests,
  takePendingPermissions,
} from '../../ar/permissions.js'
import {errorCopy} from './ar-errors.js'
import {locationErrorCopy} from './locate-errors.js'
import {googleMapsWalkingUrl, planRoute, saveTripRoute} from '../../route/route.js'
import {getStart, isManual, startLabel} from '../../route/start-point.js'
import {formatDistance} from '../../ar/pin.js'
import {findDestination} from '../../map/destinations.js'
import {showToast} from '../components/toast.js'
import {focusScreen, haptic, html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'
import {GPS, START} from '../../config.js'
import {GUIDE_LINES, markSeen, seen} from '../first-use.js'

const CONTINUE_DELAY_MS = 900

export function locateScreen(root, {navigate, params}) {
  const destination = findDestination(params.to)
  if (!destination) {
    // Not known here (a room link on a new device): the map looks it up and opens its card.
    queueMicrotask(() => navigate(params.to ? `/?to=${encodeURIComponent(params.to)}` : '/', {replace: true}))
    return
  }
  const device = parseUserAgent(navigator.userAgent, {maxTouchPoints: navigator.maxTouchPoints})
  const nextQuery = new URLSearchParams({to: destination.id})
  if (params.force === '1') nextQuery.set('force', '1')
  if (params.debug === '1') nextQuery.set('debug', '1')
  if (params.fieldtest === '1' || new URLSearchParams(window.location.search).get('fieldtest') === '1') nextQuery.set('fieldtest', '1')

  let stopWatch = null
  let tapWatch = null
  let gate = null
  let tick = null
  let continueTimer = null
  let disposed = false
  const startPoint = getStart()
  const manualStart = isManual(startPoint)

  function setView(fragment, state) {
    root.dataset.locateState = state
    render(root, fragment)
    focusScreen(root)
  }

  const destinationCard = () => html`
    <div class="dest-card" data-destination>
      <span class="dsearch__badge" data-category="${destination.category}">
        ${icon(CATEGORY_ICON[destination.category] || 'pin', {size: 20})}
      </span>
      <span class="dest-card__text">
        <span class="dest-card__label">Directions to</span>
        <strong class="dest-card__name">${destination.name}</strong>
      </span>
    </div>
  `

  // ---------- tap to start: the first time, and after a reload ----------
  // The first time it is the guide: three lines, one per prompt, in the order the phone asks.
  function showTapToStart() {
    const first = !seen('guide')
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="locate-card">
            ${destinationCard()}
            <h1 class="locate-card__title" tabindex="-1">${first ? 'Before we start' : 'Ready when you are'}</h1>
            ${first
              ? html`<ul class="guide-lines" data-guide>
                  ${GUIDE_LINES.map((l) => html`<li>${icon(l.icon, {size: 20})}<span>${l.text}</span></li>`)}
                </ul>`
              : ''}
            <button class="btn btn--primary btn--block" type="button" data-action="tap" aria-label="Tap to start" data-autofocus>
              ${icon('camera')}<span>Tap to start</span>
            </button>
            <button class="btn btn--ghost" type="button" data-action="back" aria-label="Cancel">Cancel</button>
          </div>
        </div>
      `,
      'tap',
    )
  }

  // ---------- waiting / found ----------
  function showWaiting(title = 'Finding your location…', body = 'This usually takes a few seconds outdoors.') {
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="locate-card">
            ${destinationCard()}
            <h1 class="locate-card__title" tabindex="-1" data-title>${title}</h1>
            <p class="locate-card__body" data-body aria-live="polite">${body}</p>
            <div class="gps-meter" data-meter>
              <div class="gps-meter__row">
                <span>GPS accuracy</span>
                <strong data-accuracy>–</strong>
              </div>
              <div class="gps-meter__track" aria-hidden="true"><span class="gps-meter__fill" data-fill></span></div>
              <p class="gps-meter__hint">Needs ±${GPS.goodAccuracyM} m or better</p>
            </div>
            <div class="locate-card__indoors" data-choose-start hidden>
              <p>${icon('info', {size: 20})}<span><strong>We can't find you precisely.</strong> Choose your starting point instead.</span></p>
              <button class="btn btn--primary btn--block" type="button" data-action="choose-start">
                ${icon('pin')}<span>Choose starting point</span>
              </button>
            </div>
            <div class="locate-card__indoors" data-indoors hidden>
              <p>${icon('info', {size: 20})}<span><strong>You may be indoors.</strong> GPS needs a clear view of the sky. Step outside, or use the 2D map.</span></p>
              <button class="btn btn--secondary btn--block" type="button" data-action="map" aria-label="View 2D map instead">
                ${icon('map')}<span>View 2D map instead</span>
              </button>
            </div>
            <button class="btn btn--ghost" type="button" data-action="back" aria-label="Cancel">Cancel</button>
          </div>
        </div>
      `,
      'waiting',
    )
  }

  function paint(s) {
    const meter = root.querySelector('[data-meter]')
    if (!meter) return
    const title = root.querySelector('[data-title]')
    const body = root.querySelector('[data-body]')
    root.querySelector('[data-indoors]').hidden = !s.indoors
    root.querySelector('[data-choose-start]').hidden = !(s.indoors || (s.status === 'weak' && s.accuracy > START.weakGpsM))

    if (s.status === 'searching') return
    const acc = Math.round(s.accuracy)
    root.querySelector('[data-accuracy]').textContent = Number.isFinite(acc) ? `±${acc} m` : 'unknown'
    // Bar: full at ≤ 5 m, empty at ≥ 60 m.
    const fill = Math.max(0.04, Math.min(1, (60 - s.accuracy) / 55))
    root.querySelector('[data-fill]').style.transform = `scaleX(${fill})`
    meter.dataset.level = s.level

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
    if (s.status === 'ready' && !continueTimer && !planning) {
      haptic(18)
      saveTripFix(s.fix)
      planTrip(s.fix)
    } else if (s.status !== 'ready' && continueTimer) {
      // Accuracy dropped again before we left: keep waiting.
      clearTimeout(continueTimer)
      continueTimer = null
    }
  }

  // Plan the walking route as soon as GPS is good, then open the camera.
  let planning = false
  async function planTrip(fix) {
    planning = true
    const body = root.querySelector('[data-body]')
    if (body) body.textContent = 'Planning your walking route…'
    try {
      const route = await planRoute(fix, destination)
      if (disposed) return
      if (route.status === 'off-campus') {
        stop()
        return showOffCampus(route.distanceM)
      }
      saveTripRoute({...route, destinationId: destination.id, origin: fix, start: manualStart ? startPoint : null, plannedAt: Date.now()})
      if (body) body.textContent = `${formatDistance(route.lengthM)} walk, about ${route.minutes} min. Opening the camera…`
      continueTimer = setTimeout(() => {
        if (!disposed) navigate(`/ar?${nextQuery}`, {replace: true})
      }, CONTINUE_DELAY_MS)
    } catch (err) {
      console.error('[locate] route planning failed', err)
      if (!disposed) showError('no-route')
    } finally {
      planning = false
    }
  }

  function showOffCampus(metres) {
    setView(
      html`
        <div class="page page--narrow page--center error-state">
          <span class="error-state__icon" data-tone="warn">${icon('map', {size: 32})}</span>
          <h1 class="page__title" tabindex="-1">You're outside Stirling</h1>
          <p class="page__lede">
            You are about ${formatDistance(metres)} from the University. AR directions start once you are in Stirling.
          </p>
          <div class="error-state__actions">
            <a class="btn btn--primary btn--lg btn--block" aria-label="Walking directions in Google Maps" href="${googleMapsWalkingUrl(destination)}" target="_blank" rel="noopener">
              ${icon('external')}<span>Walking directions in Google Maps</span>
            </a>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="View 2D map instead">
              ${icon('map')}<span>View 2D map instead</span>
            </button>
          </div>
        </div>
      `,
      'off-campus',
    )
  }

  function start(title, body) {
    if (manualStart) {
      stop()
      tapWatch?.stop()
      tapWatch = null
      showWaiting('Planning your walking route…', `From ${startLabel(startPoint)}.`)
      root.querySelector('[data-meter]').hidden = true
      planTrip(startPoint)
      return
    }
    stop()
    showWaiting(title, body)
    gate = createFixGate()
    if (tapWatch) {
      // The watch started in the tap carries on, with any fix it already has.
      stopWatch = tapWatch.stop
      const watch = tapWatch
      tapWatch = null
      watch.listen({onFix, onError: showError})
    } else {
      stopWatch = watchLocation({onFix, onError: showError})
    }
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

  /** Wait for the answers to the requests made in the tap, then look for a good fix. */
  async function awaitPermissions(pending) {
    tapWatch = pending.gps
    showWaiting('Tap Allow when your phone asks', 'Your phone asks about the camera, your location and motion.')
    const answer = await settlePermissions(pending)
    if (disposed) return
    if (answer.camera === 'denied') return showErrorCopy(errorCopy('camera-denied', device))
    if (answer.motion === 'denied') return showErrorCopy(errorCopy('motion-denied', device))
    start()
  }

  // ---------- errors ----------
  function showError(code) {
    showErrorCopy(locationErrorCopy(code, device))
  }

  function showErrorCopy(copy) {
    if (disposed) return
    stop()
    tapWatch?.stop()
    tapWatch = null
    setView(
      html`
        <div class="page page--narrow page--center error-state">
          <span class="error-state__icon" data-tone="${copy.tone}">${icon(copy.icon, {size: 32})}</span>
          <h1 class="page__title" tabindex="-1">${copy.title}</h1>
          <p class="page__lede">${copy.body}</p>
          ${copy.steps ? html`<ol class="steps-list">${copy.steps.map((s) => html`<li>${s}</li>`)}</ol>` : ''}
          <div class="error-state__actions">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="${copy.primary.action}" aria-label="${copy.primary.label}">
              ${icon('refresh')}<span>${copy.primary.label}</span>
            </button>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="choose-start">
              ${icon('pin')}<span>Choose starting point</span>
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

  /** A laptop or an in-app browser cannot run AR: say so, and offer a way on. */
  function showUnsupported(issue) {
    setView(
      html`
        <div class="page page--narrow page--center error-state">
          <span class="error-state__icon" data-tone="warn">${icon('alert', {size: 32})}</span>
          <h1 class="page__title" tabindex="-1">${issue.title}</h1>
          <p class="page__lede">${issue.body}</p>
          <div class="error-state__actions">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="map" aria-label="View 2D map instead">
              ${icon('map')}<span>View 2D map instead</span>
            </button>
            ${['desktop', 'in-app-browser'].includes(issue.code)
              ? html`<button class="btn btn--secondary btn--lg btn--block" type="button" data-action="copy" aria-label="Copy link">
                  ${icon('copy')}<span>Copy link</span>
                </button>`
              : ''}
          </div>
        </div>
      `,
      'unsupported',
    )
  }

  const off = onAction(root, {
    back: () => navigate(`/?to=${encodeURIComponent(destination.id)}`),
    tap: () => {
      markSeen('guide')
      awaitPermissions(startPermissionRequests({gps: !manualStart}))
    },
    retry: () => start(),
    reload: () => window.location.reload(),
    map: () => navigate(`/?to=${encodeURIComponent(destination.id)}`),
    'choose-start': () => navigate(`/?${new URLSearchParams({...Object.fromEntries(nextQuery), start: 'pick'})}`),
    copy: async () => {
      const url = window.location.href.split('#')[0]
      try {
        await navigator.clipboard.writeText(url)
        showToast('Link copied')
      } catch {
        showToast(url, {duration: 6000})
      }
    },
  })

  const issue = deviceIssue(params.force === '1')
  const pending = takePendingPermissions()
  if (issue) {
    pending?.gps?.stop()
    showUnsupported(issue)
  } else if (pending) {
    // The usual way in: the tap on a destination has already asked.
    awaitPermissions(pending)
  } else {
    // A reload or a direct link. Explain a block first; otherwise ask for a tap only if needed.
    locationPermissionState().then((state) => {
      if (disposed) return
      if (state === 'denied' && !manualStart) showError('denied')
      else if (permissionsAllowed() && seen('guide')) start()
      else showTapToStart()
    })
  }

  return () => {
    disposed = true
    stop()
    tapWatch?.stop()
    off()
    delete root.dataset.locateState
  }
}
