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
import {googleMapsWalkingUrl, leavesAfterEntering, planRoute, saveTripRoute, tripLengthM, walkingMinutes} from '../../route/route.js'
import {getStart, isManual, startLabel} from '../../route/start-point.js'
import {gpsStartDecision} from '../../route/ar-start.js'
import {doorStartPoint, doorwaySides, leavesSameBuilding, mapHeadingStart, pickDoorRoute, rankDoors, resolveDoorHeading} from '../../route/door-start.js'
import {fromLocal, toLocal} from '../../geo/geo.js'
import {whereSheet} from '../components/where-sheet.js'
import {formatDistance} from '../../ar/pin.js'
import {findDestination} from '../../map/destinations.js'
import {showToast} from '../components/toast.js'
import {focusScreen, haptic, html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'
import {AR_START} from '../../config.js'
import {guideLines, markSeen} from '../first-use.js'

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
  if (params.fieldlog === '1' || new URLSearchParams(window.location.search).get('fieldlog') === '1') nextQuery.set('fieldlog', '1')

  let stopWatch = null
  let tapWatch = null
  let gate = null
  let tick = null
  let continueTimer = null
  let disposed = false
  const startPoint = getStart()
  const manualStart = isManual(startPoint)
  // Alignment Phase 1: GPS starts AR only when good and outdoors; else "Where are you?".
  let doorData = null // door-data.js, loaded on first use (it pulls in the floor tile reader)
  let shapes // MazeMap building outlines: undefined while loading, null if unavailable
  let gpsStartedAt = 0
  let rankFix = null // the best fix so far, however rough: it only ranks the doors
  let where = null // {reason, doors}: the picker is showing
  const loadDoorData = () => (doorData ??= import('../../map/door-data.js'))

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

  // ---------- tap to start: only after a reload or a direct link ----------
  // "Go" on the map is the tap the phone needs, so the usual way in never shows this. A reload has
  // no tap to use, so one button asks; the lines say what each prompt is for (a chosen start does
  // not use the location: its line says where the walk starts).
  function showTapToStart() {
    const lines = guideLines(manualStart ? startLabel(startPoint) : null)
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="locate-card">
            ${destinationCard()}
            <h1 class="locate-card__title" tabindex="-1">Ready when you are</h1>
            <ul class="guide-lines" data-guide>
              ${lines.map((l) => html`<li>${icon(l.icon, {size: 20})}<span>${l.text}</span></li>`)}
            </ul>
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
              <p class="gps-meter__hint">Needs ±${AR_START.gpsMaxM} m or better</p>
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
    root.querySelector('[data-choose-start]').hidden = !(s.indoors || s.askStart)

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
    noteRankFix(s.fix)
    if (where) return
    paint(s)
    if (s.status !== 'ready' && continueTimer) {
      // Accuracy dropped again before we left: keep waiting.
      clearTimeout(continueTimer)
      continueTimer = null
      return
    }
    decide(s)
  }

  /** Any fix ranks the doors in "Where are you?"; a rough one says which are near, no more. */
  function noteRankFix(fix) {
    if (!fix || !(fix.accuracy <= AR_START.rankFixMaxM)) return
    const first = !rankFix
    if (first || fix.accuracy < rankFix.accuracy) rankFix = fix
    if (first && where && where.doors && !where.doors.length) loadDoors() // the picker had no position yet
  }

  /** Step 1: start from this GPS fix, keep waiting, or ask "Where are you?". */
  function decide(s) {
    if (disposed || planning || continueTimer || where || !gate) return
    const fix = s.fix
    const good = fix && fix.accuracy <= AR_START.gpsMaxM
    // A good fix waits for the outlines (one request, cached): it must not start AR from indoors.
    if (good && shapes === undefined) return
    const inside = fix && shapes ? insideBuilding(fix) : null
    const d = gpsStartDecision({fix, inside, waitedMs: Date.now() - gpsStartedAt})
    if (d.action === 'gps') {
      if (d.reason === 'outline-unknown') console.warn('[locate] building outlines unavailable: starting from GPS without the indoor check')
      haptic(18)
      saveTripFix(fix)
      planTrip(fix)
    } else if (d.action === 'pick') showWhere(d.reason)
  }

  let insideBuilding = () => false
  function loadShapes() {
    if (shapes !== undefined) return
    loadDoorData()
      .then(async (mod) => {
        const list = await mod.loadBuildingShapes()
        if (disposed) return
        shapes = list
        insideBuilding = (fix) => Boolean(list && mod.buildingAt(fix, list))
        if (gate) decide(gate.check())
      })
      .catch(() => {
        shapes = null
        if (gate) decide(gate.check())
      })
  }

  // ---------- "Where are you?" (steps 2-3) ----------
  function showWhere(reason) {
    if (where || disposed) return
    clearInterval(tick) // GPS keeps listening, only to rank the doors better
    where = {reason, doors: null}
    paintWhere()
    loadDoors()
  }

  function paintWhere() {
    setView(
      html`
        <div class="page page--narrow page--center locate">
          <div class="locate-card">
            ${destinationCard()}
            ${whereSheet({reason: where.reason, doors: where.doors})}
            <button class="btn btn--ghost" type="button" data-action="back" aria-label="Cancel">Cancel</button>
          </div>
        </div>
      `,
      'where',
    )
  }

  async function loadDoors() {
    const here = rankFix
    if (!here) {
      where.doors = []
      return paintWhere()
    }
    try {
      const mod = await loadDoorData()
      const found = await mod.doorsNear(here)
      if (disposed || !where) return
      where.doors = rankDoors(found, {x: 0, y: 0})
    } catch (err) {
      console.warn('[locate] doors unavailable', err?.message)
      if (where) where.doors = []
    }
    if (where && !planning) paintWhere()
  }

  /**
   * Plan from the doorway (just inside it and just outside it; the shorter walk wins) and start
   * with the wall's heading, facing in or out as the route goes (step 3). label: what the user chose.
   */
  async function planDoorTrip(door, label = null) {
    stop()
    where = null
    planning = true
    showWaiting('Planning your walking route…', 'From the door you chose.')
    root.querySelector('[data-meter]').hidden = true
    const centre = {lat: door.lat, lng: door.lng}
    const wall = Number.isFinite(door.inwardDeg)
    const sides = wall ? doorwaySides({x: 0, y: 0, inwardDeg: door.inwardDeg}) : null
    const level = Number.isFinite(door.level) ? {floor: door.level, z: door.level} : {}
    const candidates = wall
      ? [
          {side: 'inside', at: {...fromLocal(centre, sides.inside), ...level}},
          {side: 'outside', at: fromLocal(centre, sides.outside)},
        ]
      : [{side: 'outside', at: centre}]
    try {
      const planned = await Promise.all(candidates.map((c) => planRoute(c.at, destination).then((route) => ({...c, route}), () => ({...c, route: {status: 'error'}}))))
      if (disposed) return
      // Phase 5: a destination in the door's own building is reached without going back outside.
      const sameBuilding = await sameBuildingAs(door)
      const best = pickDoorRoute(planned, {sameBuilding, lengthOf: tripLengthM, leaves: (r) => leavesAfterEntering([...r.points, ...(r.indoorPoints ?? []).slice(1)])})
      console.info('[locate] door routes', planned.map((p) => ({side: p.side, status: p.route.status, m: p.route.status === 'ok' ? Math.round(tripLengthM(p.route)) : null, leaves: p.route.status === 'ok' ? leavesAfterEntering([...p.route.points, ...(p.route.indoorPoints ?? []).slice(1)]) : null})))
      if (disposed) return
      if (!best) {
        const route = planned.find((p) => p.route.reason === 'floor-data-unavailable')?.route ?? planned[0].route
        if (route.reason === 'floor-data-unavailable') return showError('indoor-map-failed')
        return showError(route.status === 'no-indoor-route' ? 'no-indoor-route' : 'no-route')
      }
      const points = [...best.route.points, ...(best.route.indoorPoints ?? []).slice(1)]
      const local = points.map((p) => toLocal(best.at, p))
      // From outside, the walk goes in if the route's indoor part starts at this doorway.
      const entry = best.route.indoorPoints?.[0] ? toLocal(best.at, best.route.indoorPoints[0]) : null
      const goesIn = best.side === 'inside' ? null : Boolean(entry && Math.hypot(entry.x, entry.y) <= 8)
      const heading = resolveDoorHeading(door, local, {goesIn})
      const names = label ? {name: label.name, entranceName: label.entranceName} : {}
      // No heading at all (a route too short to read): a plain chosen point, as before Phase 1.
      const start = heading
        ? {...doorStartPoint(door, best.at, heading, {indoor: best.side === 'inside'}), headingSource: heading.source, ...names}
        : {type: 'map', name: label?.name ?? door.buildingName ?? 'Door', entranceName: null, lat: best.at.lat, lng: best.at.lng, headingDeg: null, facing: null}
      const origin = {lat: best.at.lat, lng: best.at.lng, ...(start.floor != null ? {floor: start.floor, z: start.floor} : {})}
      saveTripRoute({...best.route, destinationId: destination.id, origin, start, plannedAt: Date.now()})
      console.info('[locate] door start', {facing: start.doorFacing, headingDeg: start.headingDeg, source: heading?.source, side: best.side, sameBuilding})
      const body = root.querySelector('[data-body]')
      if (body) body.textContent = `${formatDistance(tripLengthM(best.route))} walk, about ${walkingMinutes(tripLengthM(best.route))} min. Opening the camera…`
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

  /** Item 6: does the planned walk leave the building the start and the destination are both in? */
  async function leavesOwnBuilding(route) {
    try {
      const mod = await loadDoorData()
      const list = (await mod.loadBuildingShapes()) ?? []
      const verdict = leavesSameBuilding({
        startBuildingId: mod.buildingAt(startPoint, list)?.id ?? null,
        destinationBuildingId: mod.buildingAt({lat: destination.lat, lng: destination.lng}, list)?.id ?? null,
        leaves: leavesAfterEntering([...route.points, ...(route.indoorPoints ?? []).slice(1)]),
      })
      if (verdict) console.warn('[locate] the walk leaves the building the start and destination are in')
      return verdict
    } catch {
      return false
    }
  }

  /** Is the destination inside the door's building (MazeMap outlines)? False when unknown. */
  async function sameBuildingAs(door) {
    if (door.buildingId == null) return false
    try {
      const mod = await loadDoorData()
      const list = await mod.loadBuildingShapes()
      const at = mod.buildingAt({lat: destination.lat, lng: destination.lng}, list ?? [])
      console.info('[locate] destination building', {door: door.buildingId, destination: at?.id ?? null})
      return Boolean(list) && at?.id === door.buildingId
    } catch (err) {
      console.warn('[locate] same-building check failed', err?.message)
      return false
    }
  }

  /**
   * A start chosen on the map at one of our entrances: plan it as that doorway, so the heading is
   * the wall's, not the compass's or the building centre's. No door data: as before.
   */
  async function planChosenStart() {
    const entrance = startPoint.type === 'place' && !Number.isFinite(startPoint.floor)
    if (entrance) {
      try {
        const mod = await loadDoorData()
        const doors = await mod.doorsNear(startPoint, {radiusM: AR_START.namedDoorM * 3})
        const door = rankDoors(doors, {x: 0, y: 0}, 1)[0]
        if (!disposed && door && door.d <= AR_START.namedDoorM) return planDoorTrip(door, {name: startPoint.name, entranceName: startPoint.entranceName})
      } catch (err) {
        console.warn('[locate] no door data for the chosen entrance', err?.message)
      }
    }
    // A pin by an outside door is that door: the same start as "Where are you?" gives.
    if (startPoint.type === 'map') {
      try {
        const mod = await loadDoorData()
        const door = rankDoors(await mod.doorsNear(startPoint, {radiusM: AR_START.pinDoorM * 3}), {x: 0, y: 0}, 1)[0]
        if (!disposed && door && door.d <= AR_START.pinDoorM) return planDoorTrip(door)
      } catch (err) {
        console.warn('[locate] no door data near the pin', err?.message)
      }
    }
    // A room or a pin: the heading from the map too (the room's door, or the route's first metres).
    const room = startPoint.type === 'place' && Number.isFinite(startPoint.floor)
    if (!disposed) planTrip(startPoint, room || startPoint.type === 'map' ? {decorate: mapHeadingFor} : {})
  }

  /**
   * Item 20: a room or pin start gets the map's heading (door-start.js mapHeadingStart). A room: the
   * door the route leaves it by (MazeMap's door lines on its floor); a pin: the route's first metres.
   * Returns {origin, start} to save with the route, or null to keep the plain start.
   */
  async function mapHeadingFor(route) {
    const points = [...route.points, ...(route.indoorPoints ?? []).slice(1)]
    const local = points.map((p) => toLocal(startPoint, p))
    let doors = []
    if (Number.isFinite(startPoint.floor)) {
      try {
        const [{boxAround, fetchFloor}, {floorToLocal}] = await Promise.all([import('../../ar/mazemap-floor.js'), import('../../ar/building-shell.js')])
        doors = floorToLocal(await fetchFloor(startPoint.floor, boxAround(startPoint, AR_START.roomDoorM + 10)), startPoint).doors
      } catch (err) {
        console.warn('[locate] no doors for the room start', err?.message)
      }
    }
    const h = mapHeadingStart(local, doors)
    if (!h) return null
    const at = fromLocal(startPoint, h.at)
    const floor = Number.isFinite(startPoint.floor) ? {floor: startPoint.floor, z: startPoint.floor} : {}
    const start = {
      ...startPoint,
      lat: at.lat,
      lng: at.lng,
      headingDeg: Math.round(h.headingDeg * 10) / 10,
      headingSource: h.source,
      ...(h.source === 'wall' ? {doorFacing: 'out of the room'} : {faceRoute: true}),
    }
    console.info('[locate] map heading for the start', {type: startPoint.type, source: h.source, headingDeg: start.headingDeg})
    return {origin: {lat: at.lat, lng: at.lng, ...floor}, start}
  }

  // Plan the walking route as soon as GPS is good, then open the camera.
  let planning = false
  async function planTrip(fix, {decorate = null} = {}) {
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
      if (route.status !== 'ok') {
        stop()
        if (route.reason === 'floor-data-unavailable') return showError('indoor-map-failed')
        return showError(route.status === 'no-indoor-route' ? 'no-indoor-route' : 'no-route')
      }
      const decorated = decorate ? await decorate(route) : null
      if (disposed) return
      // A room or pin in the destination's own building, on a way that goes outside and back in.
      if (manualStart && (await leavesOwnBuilding(route))) {
        route.leavesBuilding = true
        showToast('This way goes outside and back in: the map has no way through inside.', {tone: 'warning', duration: 6000})
      }
      if (disposed) return
      saveTripRoute({...route, destinationId: destination.id, origin: decorated?.origin ?? fix, start: decorated?.start ?? (manualStart ? startPoint : null), plannedAt: Date.now()})
      if (body) body.textContent = `${formatDistance(tripLengthM(route))} walk, about ${walkingMinutes(tripLengthM(route))} min. Opening the camera…`
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
      planChosenStart()
      return
    }
    stop()
    where = null
    showWaiting(title, body)
    gpsStartedAt = Date.now()
    gate = createFixGate({goodAccuracyM: AR_START.gpsMaxM, askStartAfterMs: AR_START.waitForGpsMs})
    loadShapes()
    if (tapWatch) {
      // The watch started in the tap carries on, with any fix it already has.
      stopWatch = tapWatch.stop
      const watch = tapWatch
      tapWatch = null
      watch.listen({onFix, onError: showError})
    } else {
      stopWatch = watchLocation({onFix, onError: showError})
    }
    // Re-check once a second: the "indoors" hint, and "Where are you?" when no good fix came.
    tick = setInterval(() => {
      if (!gate || where) return
      const s = gate.check()
      paint(s)
      decide(s)
    }, 1000)
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
    showWaiting(
      'Tap Allow when your phone asks',
      manualStart ? `Starting from ${startLabel(startPoint)}. Your phone asks about the camera and motion.` : 'Your phone asks about the camera, your location and motion.',
    )
    const answer = await settlePermissions(pending)
    if (disposed) return
    if (answer.camera === 'denied') return showErrorCopy(errorCopy('camera-denied', device))
    if (answer.motion === 'denied') return showErrorCopy(errorCopy('motion-denied', device))
    start()
  }

  // ---------- errors ----------
  function showError(code) {
    if (where) return // "Where are you?" is open: a GPS error there changes nothing
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
            ${copy.noStartChoice
              ? ''
              : html`<button class="btn btn--secondary btn--lg btn--block" type="button" data-action="choose-start">
                  ${icon('pin')}<span>Choose starting point</span>
                </button>`}
            <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="${copy.mapLabel ?? 'View 2D map instead'}">
              ${icon('map')}<span>${copy.mapLabel ?? 'View 2D map instead'}</span>
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
    'choose-start': () => {
      if (manualStart) return navigate(`/?${new URLSearchParams({...Object.fromEntries(nextQuery), start: 'pick'})}`)
      where = null
      showWhere(gate?.check().fix ? 'weak' : 'no-fix')
    },
    'pick-door': (_, target) => {
      const door = where?.doors?.[Number(target.dataset.door)]
      if (door && !planning) planDoorTrip(door)
    },
    'pick-on-map': () => navigate(`/?${new URLSearchParams({...Object.fromEntries(nextQuery), start: 'map'})}`),
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
      else if (permissionsAllowed()) start()
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
