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
import {googleMapsWalkingUrl, planRoute, saveTripRoute, tripLengthM, walkingMinutes} from '../../route/route.js'
import {getStart, isManual, startLabel} from '../../route/start-point.js'
import {formatDistance} from '../../ar/pin.js'
import {findDestination} from '../../map/destinations.js'
import {showToast} from '../components/toast.js'
import {handoffUrl, hydrateHandoff, needsHandoff, phoneHandoff} from '../components/phone-handoff.js'
import {arErrorKind, locationErrorKind, reportError} from '../../stats/errors.js'
import {focusScreen, haptic, html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'
import {GPS} from '../../config.js'
import {minutes, t} from '../../i18n/i18n.js'
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
        <span class="dest-card__label">${t('locate.directionsTo')}</span>
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
            <h1 class="locate-card__title" tabindex="-1">${t(first ? 'locate.before' : 'locate.ready')}</h1>
            ${first
              ? html`<ul class="guide-lines" data-guide>
                  ${GUIDE_LINES.map((l) => html`<li>${icon(l.icon, {size: 20})}<span>${l.text}</span></li>`)}
                </ul>`
              : ''}
            <button class="btn btn--primary btn--block" type="button" data-action="tap" aria-label="${t('locate.tap')}" data-autofocus>
              ${icon('camera')}<span>${t('locate.tap')}</span>
            </button>
            <button class="btn btn--ghost" type="button" data-action="back" aria-label="${t('common.cancel')}">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      'tap',
    )
  }

  // ---------- waiting / found ----------
  function showWaiting(title = t('locate.finding'), body = t('locate.findingBody')) {
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="locate-card">
            ${destinationCard()}
            <h1 class="locate-card__title" tabindex="-1" data-title>${title}</h1>
            <p class="locate-card__body" data-body aria-live="polite">${body}</p>
            <div class="gps-meter" data-meter>
              <div class="gps-meter__row">
                <span>${t('locate.gpsAccuracy')}</span>
                <strong data-accuracy>–</strong>
              </div>
              <div class="gps-meter__track" aria-hidden="true"><span class="gps-meter__fill" data-fill></span></div>
              <p class="gps-meter__hint">${t('locate.needs', {m: GPS.goodAccuracyM})}</p>
            </div>
            <div class="locate-card__indoors" data-choose-start hidden>
              <p>${icon('info', {size: 20})}<span><strong>${t('locate.cantFind')}</strong> ${t('locate.cantFindBody')}</span></p>
              <button class="btn btn--primary btn--block" type="button" data-action="choose-start">
                ${icon('pin')}<span>${t('locate.chooseStart')}</span>
              </button>
            </div>
            <div class="locate-card__indoors" data-indoors hidden>
              <p>${icon('info', {size: 20})}<span><strong>${t('locate.indoors')}</strong> ${t('locate.indoorsBody')}</span></p>
              <button class="btn btn--secondary btn--block" type="button" data-action="map" aria-label="${t('common.map2d')}">
                ${icon('map')}<span>${t('common.map2d')}</span>
              </button>
            </div>
            <button class="btn btn--ghost" type="button" data-action="back" aria-label="${t('common.cancel')}">${t('common.cancel')}</button>
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
    root.querySelector('[data-choose-start]').hidden = !(s.indoors || s.askStart)

    if (s.status === 'searching') return
    const acc = Math.round(s.accuracy)
    root.querySelector('[data-accuracy]').textContent = Number.isFinite(acc) ? `±${acc} m` : t('locate.unknown')
    // Bar: full at ≤ 5 m, empty at ≥ 60 m.
    const fill = Math.max(0.04, Math.min(1, (60 - s.accuracy) / 55))
    root.querySelector('[data-fill]').style.transform = `scaleX(${fill})`
    meter.dataset.level = s.level

    if (s.status === 'weak') {
      title.textContent = t('locate.weak')
      body.textContent = t('locate.weakBody')
    } else if (s.status === 'ready') {
      title.textContent = t('locate.found')
      body.textContent = t('locate.foundBody', {m: acc})
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
    if (body) body.textContent = t('locate.planning')
    try {
      const route = await planRoute(fix, destination)
      if (disposed) return
      if (route.status === 'off-campus') {
        stop()
        return showOffCampus(route.distanceM)
      }
      saveTripRoute({...route, destinationId: destination.id, origin: fix, start: manualStart ? startPoint : null, plannedAt: Date.now()})
      if (body) body.textContent = t('locate.walk', {distance: formatDistance(tripLengthM(route)), min: minutes(walkingMinutes(tripLengthM(route)))})
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
          <h1 class="page__title" tabindex="-1">${t('locate.outside')}</h1>
          <p class="page__lede">${t('locate.outsideBody', {distance: formatDistance(metres)})}</p>
          <div class="error-state__actions">
            <a class="btn btn--primary btn--lg btn--block" aria-label="${t('locate.google')}" href="${googleMapsWalkingUrl(destination)}" target="_blank" rel="noopener">
              ${icon('external')}<span>${t('locate.google')}</span>
            </a>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="${t('common.map2d')}">
              ${icon('map')}<span>${t('common.map2d')}</span>
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
      showWaiting(t('locate.planning'), t('locate.from', {start: startLabel(startPoint)}))
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
    showWaiting(t('locate.allow'), t('locate.allowBody'))
    const answer = await settlePermissions(pending)
    if (disposed) return
    for (const code of ['camera-denied', 'motion-denied']) {
      if (answer[code.split('-')[0]] !== 'denied') continue
      reportError(arErrorKind(code)) // 'camera' or 'motion' only
      return showErrorCopy(errorCopy(code, device))
    }
    start()
  }

  // ---------- errors ----------
  function showError(code) {
    reportError(locationErrorKind(code)) // 'location' only: no position, place or id
    // No geolocation in this browser: also offer the phone, where AR works.
    const extra = needsHandoff({hasGeolocation: code !== 'unsupported'}) ? phoneHandoff(handoffUrl(destination?.id)) : ''
    showErrorCopy(locationErrorCopy(code, device), extra)
    if (extra) hydrateHandoff(root)
  }

  function showErrorCopy(copy, extra = '') {
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
              ${icon('pin')}<span>${t('locate.chooseStart')}</span>
            </button>
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="${t('common.map2d')}">
              ${icon('map')}<span>${t('common.map2d')}</span>
            </button>
          </div>
          ${extra}
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
            <button class="btn btn--primary btn--lg btn--block" type="button" data-action="map" aria-label="${t('common.map2d')}">
              ${icon('map')}<span>${t('common.map2d')}</span>
            </button>
            ${['desktop', 'in-app-browser'].includes(issue.code)
              ? html`<button class="btn btn--secondary btn--lg btn--block" type="button" data-action="copy" aria-label="${t('common.copyLink')}">
                  ${icon('copy')}<span>${t('common.copyLink')}</span>
                </button>`
              : ''}
          </div>
          ${needsHandoff({issueCode: issue.code}) ? phoneHandoff(handoffUrl(destination?.id)) : ''}
        </div>
      `,
      'unsupported',
    )
    hydrateHandoff(root) // the QR code, and the AR demo beside it on wide screens
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
        showToast(t('common.linkCopied'))
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
