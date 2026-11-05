// One AR trip: the user stands on the path and taps Start, then the route keeps being corrected.
//
// Phases (reported through onPhase):
//   'await-start'  the camera is running: the user taps Start
//   'facing'       facing more than 60° off the route: turn until within 30°, then guidance starts
//   'ready'        route placed: guidance running
//
// The compass decides the direction, not which way the user happens to face. A compass can be
// 20-90° out near glass buildings, so with a poor one (or none) nothing is drawn on the ground
// until 6 m of walking has shown the direction. Map matching then corrects whatever is left.
//
// Once 'ready', a silent collector keeps averaging the compass while the phone is upright and
// steady. Each completed 3 s window eases the route round if it has drifted by more than 5°.
// While walking, map matching (route-matcher.js) lays the walked track onto the route, and hit
// tests (ground.js) lay the route onto the real ground.
import {angleDiff, circularMean, createCalibrator, isPoorAccuracy, startCompass} from './compass.js'
import {fromLocal, pointAt, polylineSlice, toLocal} from '../geo/geo.js'
import {DESTINATIONS} from '../nav/destinations.js'
import {arrowTarget, arrowYawDeg, COMPASS_GUIDE, createRouteTracker, turnPrompt, walkingCorrection} from '../nav/compass-guide.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {acceptHit, createGroundTracker, GROUND, HIT_TYPES, SCREEN_POINTS} from './ground.js'
import {createRouteMatcher} from './route-matcher.js'
import {GPS, watchLocation} from '../geo/location.js'
import {createArrivalDetector, createGuidance, createOffRouteMonitor, landmarksFrom} from '../nav/guidance.js'
import {planRoute, SNAP_TO_PATH_M} from '../nav/route.js'

const UPRIGHT_MAX_TILT = 0.55 // |forward.y|: about 33° up or down from level
const FIRST_HEADING_WINDOW_MS = 500 // the Start tap averages this much compass history
const MIN_HORIZONTAL_LOOK = 0.2 // below this the camera looks almost straight up or down: no yaw
const STEADY_MAX_DRIFT_DEG = 6 // the camera must stay this close to where the window started
const REALIGN_MIN_DEG = 5 // smaller differences are compass noise: leave the route alone
const REALIGN_MIN_MATCHED_DEG = 15 // with a confident map match, walking beats the compass
const MATCH_EVERY_S = 2
const TRACKING_HINT_AFTER_S = 4 // show "Move your phone slowly" after this long without NORMAL
const COMPASS_PILL_AFTER_MS = 10_000 // show the figure-8 pill after this long unsteady
const DESKTOP_START_DELAY_S = 2 // a webcam on a desk never reports NORMAL tracking
const REROUTE_FIX_M = 25 // only trust GPS this good to plan a new route from
const INSTRUCTION_EVERY_S = 0.5
const POINTS_PER_SAMPLE = 3

/** Compass-style bearing of a direction: degrees clockwise from north (or from SLAM -Z). */
function bearing(east, north) {
  return (((Math.atan2(east, north) * 180) / Math.PI) % 360 + 360) % 360
}

const toCoord = (p) => [p.lng, p.lat]

export function createArTrip({
  route: firstRoute,
  origin,
  destination,
  allowDesktop = false,
  debug = false,
  arriveLabel = 'Destination',
  plan = planRoute,
  landmarks = landmarksFrom(DESTINATIONS, origin, destination.id),
  onPhase,
  onStats,
  onArrived,
  onTurnClose,
  onTurnNow,
  onTurnPassed,
}) {
  let route = firstRoute
  let phase = null
  let nav = null
  let camera = null
  let THREE = null
  let tracking = 'LIMITED'
  let startedAt = null
  let lastNormalAt = null
  let heading = null
  let headingAccuracy = null
  let compassSource = null
  let beta = null
  let compassBias = null // compass minus the placement: steady error, not drift
  let directionKnown = false // false: placed provisionally, waiting for a compass or 6 m of walking
  let tracker = null
  let startS = 0
  let fedFix = null
  let facingYaw = null
  let ringFill = 0
  let routeVersion = 0
  let legCache = null
  let lastTime = null
  let recent = []
  let steadyAnchorDeg = null
  let unsteadySince = null
  let lastFix = null
  let fps = null
  let statsTimer = 0
  let matcher = null
  let lastMatchAt = -Infinity
  let arrived = false
  const arrival = createArrivalDetector()
  const offRoute = createOffRouteMonitor()
  let guidance = null
  let instruction = null
  let instructionAt = -Infinity
  let rerouting = false
  let compassOff = false
  let stopped = false
  let xr = null
  let lastGroundAt = -Infinity
  let nextPoint = 0
  let groundNow = {height: null, slope: 0, source: 'eye'}
  const ground = createGroundTracker()
  const calibrator = createCalibrator()

  function setPhase(next, detail = {}) {
    if (phase === next) return
    phase = next
    onPhase?.(next, detail)
  }

  // ---------- sensors ----------
  const stopCompass = startCompass({
    onReading: ({heading: h, accuracy, source, beta: tilt}) => {
      const now = Date.now()
      heading = h
      headingAccuracy = accuracy
      compassSource = source
      beta = tilt ?? null
      recent.push({heading: h, at: now})
      recent = recent.filter((r) => now - r.at <= FIRST_HEADING_WINDOW_MS)
      const result = phase === 'ready' ? collect(h, accuracy, now) : null
      noteCompassQuality(result, accuracy, now)
    },
    onUnavailable: () => {
      if (heading != null) return
      compassSource = 'none' // not a problem: walking the first few metres sets the direction
    },
  })

  const stopGps = watchLocation({
    onFix: (pos) => {
      lastFix = {lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy}
    },
    onError: () => {}, // the location step already handled permissions; keep the last fix
  })

  function lookDirection() {
    return camera.getWorldDirection(new THREE.Vector3())
  }

  /** Average heading of the last ~0.5 s, or the last reading if the compass paused. */
  function recentHeading() {
    const now = Date.now()
    const fresh = recent.filter((r) => now - r.at <= FIRST_HEADING_WINDOW_MS)
    return fresh.length ? circularMean(fresh.map((r) => r.heading)) : heading
  }

  /**
   * Silent background calibration. Returns the compass state seen by this sample:
   * 'unsteady', 'ok', or null when the phone is tilted or turning and the sample was skipped.
   */
  function collect(h, accuracy, now) {
    const f = lookDirection()
    const lookDeg = (Math.atan2(f.x, f.z) * 180) / Math.PI
    const held =
      Math.abs(f.y) <= UPRIGHT_MAX_TILT &&
      (steadyAnchorDeg == null || Math.abs(angleDiff(steadyAnchorDeg, lookDeg)) <= STEADY_MAX_DRIFT_DEG)
    if (!held) {
      restartWindow()
      return null
    }
    steadyAnchorDeg ??= lookDeg
    const r = calibrator.add(h, accuracy, now)
    if (r.status === 'done') {
      restartWindow()
      realignFromCompass(r.heading)
    }
    return r.status === 'unsteady' ? 'unsteady' : 'ok'
  }

  function realignFromCompass(h) {
    // Once walking has shown the compass is badly wrong, it could only turn the route back.
    if (!directionKnown || matcher.flipped || compassOff) return
    // A compass that only woke up after Start: remember its error, do not act on it.
    if (compassBias == null) {
      compassBias = angleDiff(cameraBearing() + matcher.totalYawDeg, h)
      return
    }
    // Compare with the steady error at the start and the turn walking has applied: a compass
    // that is steadily out must not undo them every 3 s. Only new drift counts.
    nav.realign(h - compassBias - matcher.totalYawDeg, matcher.confident ? REALIGN_MIN_MATCHED_DEG : REALIGN_MIN_DEG)
  }

  /** Which way the camera faces in the route frame, degrees clockwise from north. */
  function cameraBearing() {
    const here = camera.position
    const f = lookDirection()
    const user = nav.worldToRoute({x: here.x, z: here.z})
    const ahead = nav.worldToRoute({x: here.x + f.x, z: here.z + f.z})
    return bearing(ahead.x - user.x, ahead.y - user.y)
  }

  function restartWindow() {
    calibrator.reset()
    steadyAnchorDeg = null
  }

  function noteCompassQuality(result, accuracy, now) {
    if (result === 'unsteady' || isPoorAccuracy(accuracy)) unsteadySince ??= now
    // A skipped sample says nothing about noise, but iPhones also report accuracy directly.
    else if (result === 'ok' || phase !== 'ready' || Number.isFinite(accuracy)) unsteadySince = null
  }

  /** The freshest good GPS fix for "where am I standing"; else the trip start. */
  function bestFix() {
    return lastFix && lastFix.accuracy <= GPS.goodAccuracyM ? lastFix : origin
  }

  function trackingReady() {
    return tracking === 'NORMAL' || (allowDesktop && lastTime != null && lastTime - startedAt > DESKTOP_START_DELAY_S)
  }

  function compassUsable() {
    return heading != null && !isPoorAccuracy(headingAccuracy, COMPASS_GUIDE.poorAccuracyDeg)
  }

  /** Which way the user faces for the arrow and the map: walking has the last word once it has spoken. */
  function guideHeading() {
    if (directionKnown && (compassOff || matcher.locked)) return cameraBearing()
    if (heading != null) return recentHeading()
    return directionKnown ? cameraBearing() : null
  }

  /** Place the route and start guiding. headingDeg: the compass; null: find out by walking. */
  function beginGuidance(headingDeg) {
    const fix = bestFix()
    const info = nav.startInfo(fix)
    nav.setGround(ground.fallback(camera.position.y), 0)
    nav.align(headingDeg ?? info.bearingDeg, fix)
    // A webcam in test mode has no compass and cannot walk.
    directionKnown = headingDeg != null || allowDesktop
    nav.setVisible(directionKnown)
    compassBias = headingDeg == null ? null : 0
    tracker = createRouteTracker(nav.route, info.s)
    startS = info.s
    restartWindow()
    facingYaw = null
    setPhase('ready', {heading: headingDeg})
  }

  /**
   * The Start tap, with the user on the path. Returns 'ok', 'facing' (turn first), 'tracking' (world
   * tracking not ready), 'look' (phone pointing up or down) or 'path' (too far from the path).
   */
  function start() {
    if (!nav) return 'tracking'
    if (phase === 'ready') return 'ok'
    if (phase === 'facing') return 'facing'
    if (!trackingReady()) return 'tracking'
    const f = lookDirection()
    // A webcam in test mode reports no direction, so only a real phone can be asked to look up.
    if (!allowDesktop && Math.hypot(f.x, f.z) < MIN_HORIZONTAL_LOOK) return 'look'
    const fix = bestFix()
    const startInfo = nav.startInfo(fix)
    if (startInfo.offset > SNAP_TO_PATH_M) return 'path'
    if (!compassUsable()) {
      beginGuidance(null)
      return 'ok'
    }
    const h = recentHeading()
    facingYaw = arrowYawDeg(startInfo.bearingDeg, h)
    if (turnPrompt(facingYaw)) {
      setPhase('facing')
      return 'facing'
    }
    beginGuidance(h)
    return 'ok'
  }

  /** Waiting for the user to turn towards the route. A compass that goes poor stops the wait. */
  function watchFacing() {
    if (!compassUsable()) return beginGuidance(null)
    const h = recentHeading()
    facingYaw = arrowYawDeg(nav.startInfo(bestFix()).bearingDeg, h)
    if (Math.abs(facingYaw) <= COMPASS_GUIDE.facingOkDeg) beginGuidance(h)
  }

  /** The direction came from walking or a compass that recovered: now the ground can be drawn. */
  function directionFound() {
    directionKnown = true
    nav.setVisible(true)
  }

  /** Keep the route on the path the user is really walking. Never while tracking is unsure. */
  function runMatching(time) {
    if (tracking !== 'NORMAL') return
    matcher.addSample(camera.position.x, camera.position.z, time)
    if (!directionKnown) {
      if (nav.easing) return
      const track = matcher.samples.map((p) => nav.worldToRoute(p))
      const correction = walkingCorrection(track, nav.route, tracker.s, matcher.walkedM)
      if (correction) {
        nav.applyCorrection(correction)
        compassOff = true
        directionFound()
      }
      return
    }
    if (time - lastMatchAt < MATCH_EVERY_S || !matcher.moving(time) || nav.easing) return
    lastMatchAt = time
    const correction = matcher.update(nav.worldToRoute)
    if (correction) nav.applyCorrection(correction)
    // Until the flip that walk counted as going backwards. It was going forwards all along.
    if (correction?.flipped) tracker.set(startS + matcher.everWalkedM)
  }

  /** Plan again from where GPS says the user is, keeping the current placement. */
  async function reroute() {
    if (!lastFix || lastFix.accuracy > REROUTE_FIX_M) return
    rerouting = true
    try {
      const next = await plan(lastFix, destination)
      if (stopped || arrived || !nav || next.status !== 'ok') return
      route = next
      nav.setRoute(next)
      routeVersion += 1
      legCache = null
      tracker = createRouteTracker(nav.route, nav.startInfo(lastFix).s)
      // The walk so far no longer has a route to fit, so matching starts afresh. Its turn stays in
      // the placement, so the compass has to keep allowing for it.
      compassOff ||= matcher.flipped
      if (compassBias != null) compassBias += matcher.totalYawDeg
      matcher = createRouteMatcher(nav.route)
      guidance = createGuidance(nav.route, {arriveLabel, landmarks})
      instructionAt = -Infinity
    } catch (err) {
      console.warn('[trip] reroute failed', err)
    } finally {
      rerouting = false
    }
  }

  /** Look for the real ground at a few spots in the lower half of the screen. */
  function sampleGround(time) {
    if (tracking !== 'NORMAL' || !xr?.XrController?.hitTest || time - lastGroundAt < GROUND.sampleEveryS) return
    lastGroundAt = time
    for (let i = 0; i < POINTS_PER_SAMPLE; i++) {
      const [x, y] = SCREEN_POINTS[nextPoint]
      nextPoint = (nextPoint + 1) % SCREEN_POINTS.length
      let hits
      try {
        hits = xr.XrController.hitTest(x, y, HIT_TYPES) || []
      } catch (err) {
        console.warn('[ground] hit test failed', err)
        return
      }
      for (const {position} of hits) {
        if (!position) continue
        const along = nav.routePosition(position)
        if (acceptHit(position, camera.position, along.offset)) ground.addHit(along.s, position.y, camera.position.y, time)
      }
    }
  }

  /** Live numbers and the route-frame picture for the ?debug=1 overlay. */
  function debugData() {
    const here = camera.position
    const f = lookDirection()
    const user = nav.worldToRoute({x: here.x, z: here.z})
    const ahead = nav.worldToRoute({x: here.x + f.x, z: here.z + f.z})
    const [a, b] = nav.route
    return {
      beta,
      cameraYawDeg: bearing(f.x, -f.z),
      firstSegmentDeg: bearing(b.x - a.x, b.y - a.y),
      lookDeg: bearing(ahead.x - user.x, ahead.y - user.y),
      user,
      route: nav.route,
      track: matcher.samples.map((p) => nav.worldToRoute(p)),
    }
  }

  function minimapData() {
    const fix = bestFix()
    const start = nav.startInfo(fix)
    const user = nav.aligned ? nav.userRoutePoint() : nav.routePointForFix(fix)
    return {
      route: nav.route,
      user,
      headingDeg: heading ?? start.bearingDeg,
      nextTurn: nav.nextTurnAt(nav.aligned ? undefined : start.s),
    }
  }

  /** The heading-up map: where to draw everything, in lat/lng. Null until the scene is ready. */
  function mapState() {
    if (!nav) return null
    const s = tracker ? tracker.shownS : nav.startInfo(bestFix()).s
    const next = guidance.getNextManoeuvre(tracker ? tracker.s : s)
    const key = `${Math.round(s)}:${next.s}`
    if (legCache?.key !== key) {
      legCache = {key, coords: polylineSlice(nav.route, s, next.s).map((p) => toCoord(fromLocal(origin, p)))}
    }
    const at = pointAt(nav.route, next.s)
    return {
      headingDeg: guideHeading(),
      user: fromLocal(origin, pointAt(nav.route, s)),
      leg: legCache.coords,
      routeCoords: route.points.map(toCoord),
      routeVersion,
      approximate: route.source === 'direct',
      entrance: route.entrance || route.points.at(-1),
      turn: next.type === 'arrive' ? null : {number: guidance.manoeuvres.indexOf(next) + 1, at: fromLocal(origin, at)},
    }
  }

  /** The big arrow: the way to walk, measured from the way the user faces. */
  function updateArrow(dt, s) {
    if (arrived) return nav.updateGuide(dt, null)
    if (phase === 'facing') return nav.updateGuide(dt, facingYaw)
    if (phase !== 'ready') return nav.updateGuide(dt, null)
    const h = guideHeading()
    const target = arrowTarget(nav.route, guidance.manoeuvres, guidance.getNextManoeuvre(s), s)
    ringFill = target.ringFill
    nav.updateGuide(dt, h == null ? null : arrowYawDeg(target.bearingDeg, h), ringFill)
  }

  function compassPoor() {
    return heading != null && isPoorAccuracy(headingAccuracy, COMPASS_GUIDE.poorAccuracyDeg)
  }

  /** Walking has proved the placement, so a poor compass no longer matters for the ground arrows. */
  function placementTrusted() {
    return matcher.locked || compassOff || !compassPoor()
  }

  // ---------- engine hooks ----------
  function onSceneReady({scene, camera: cam, XR8}) {
    THREE = window.THREE
    camera = cam
    xr = XR8
    nav = createNavScene({THREE, scene, camera, route, origin, name: destination.name})
    matcher = createRouteMatcher(nav.route)
    guidance = createGuidance(nav.route, {arriveLabel, landmarks})
    setPhase('await-start')
  }

  function onTracking({status}) {
    tracking = status
  }

  function onTick({dt, time}) {
    if (!nav) return
    startedAt ??= time
    lastTime = time
    if (tracking === 'NORMAL' || lastNormalAt == null) lastNormalAt = time
    if (phase === 'facing') watchFacing()
    if (phase === 'ready' && !arrived) {
      // A compass that recovers before walking has shown the way: use it, from where the user is.
      if (!directionKnown && compassUsable()) {
        nav.align(recentHeading(), fromLocal(origin, pointAt(nav.route, tracker.s)))
        compassBias = 0
        directionFound()
      }
      runMatching(time)
      sampleGround(time)
    }
    const s = nav.update(dt, time)
    if (phase === 'ready') {
      groundNow = ground.update(dt, s.s, camera.position.y, time)
      nav.setGround(groundNow.height, groundNow.slope, s.s)
      nav.setChevronOpacity(placementTrusted() ? 1 : 0)
      if (tracking === 'NORMAL') tracker.walk(camera.position, directionKnown ? nav.worldToRoute : null)
      if (lastFix && lastFix !== fedFix) {
        fedFix = lastFix
        tracker.fix(toLocal(origin, lastFix), lastFix.accuracy)
      }
      tracker.tick(dt)
    }
    const routeS = tracker ? tracker.s : 0
    const remainingM = tracker ? Math.max(0, tracker.totalM - routeS) : route.lengthM
    if (phase === 'ready' && !arrived) {
      if (arrival.update(dt, remainingM, directionKnown ? s.toPinM : null)) {
        arrived = true
        instruction = null
        nav.finish()
        onArrived?.()
      } else {
        if (time - instructionAt >= INSTRUCTION_EVERY_S) {
          instructionAt = time
          instruction = guidance.instruction(routeS)
        }
        if (guidance.turnPassed(routeS)) onTurnPassed?.()
        if (guidance.turnIsClose(routeS)) onTurnClose?.()
        if (guidance.turnIsNow(routeS)) onTurnNow?.()
        // Only while SLAM knows where the user is, and not while already planning.
        if (directionKnown && tracking === 'NORMAL' && !rerouting && offRoute.update(s.offset, time)) reroute()
      }
    }
    updateArrow(dt, routeS)
    statsTimer += dt
    if (statsTimer >= 0.25) {
      statsTimer = 0
      onStats?.({
        phase,
        tracking,
        trackingStalled: time - lastNormalAt >= TRACKING_HINT_AFTER_S,
        compassUnsteady: unsteadySince != null && Date.now() - unsteadySince > COMPASS_PILL_AFTER_MS,
        compassPoor: compassPoor() && !placementTrusted(),
        directionKnown,
        turnPrompt: phase === 'facing' ? turnPrompt(facingYaw, 0) : null,
        step: phase === 'ready' && !arrived ? guidance.step(routeS) : null,
        steps: phase === 'ready' ? guidance.steps(routeS) : null,
        ringFill,
        heading,
        headingAccuracy,
        compassSource,
        gpsAccuracy: lastFix?.accuracy ?? null,
        gpsToEntranceM: gpsDistanceToEntrance(lastFix, route),
         startGapM: nav.startInfo(bestFix()).offset,
         pathBearingDeg: nav.startInfo(bestFix()).pathBearingDeg,
        remainingM: nav.aligned ? remainingM : route.lengthM,
        toPinM: s.toPinM ?? null,
        offRouteM: nav.aligned ? s.offset : null,
        arrows: nav.aligned ? s.arrows : 0,
        arrowTotal: nav.arrowCount,
        cameraHeight: camera.position.y,
        groundHeight: groundNow.height,
        groundSlope: groundNow.slope,
        groundSource: groundNow.source,
        groundHits: ground.hitCount,
        yawDeg: nav.yawDeg,
        matchOffsetM: matcher.totalOffsetM,
        matchYawDeg: matcher.totalYawDeg,
        matchResidualM: matcher.residualM,
        matchFlipped: matcher.flipped,
        locked: matcher.locked,
        instruction,
        rerouting,
        nextManoeuvre: nav.aligned ? guidance.getNextManoeuvre(routeS) : null,
        userS: nav.aligned ? routeS : null,
        routePoints: route.points.length,
         turns: nav.turns,
         minimap: minimapData(),
        canStart: trackingReady(),
        routeBearingDeg: phase === 'ready' ? null : nav.startInfo(bestFix()).bearingDeg,
        debug: debug ? debugData() : null,
        nextTurnM: nav.aligned ? (s.nextTurnM ?? null) : null,
        nextTurnDir: nav.aligned ? (s.nextTurnDir ?? null) : null,
        source: route.source,
        fps,
      })
    }
  }

  return {
    onSceneReady,
    onTracking,
    onTick,
    mapState,
    setFps: (value) => (fps = value),
    /** Debug panel: correct the route now from the latest readings, however small the error. */
    recalibrate() {
      if (phase !== 'ready' || heading == null) return
      restartWindow()
      compassBias = 0
      nav.realign(recentHeading())
    },
    start,
    stop() {
      stopped = true
      stopCompass()
      stopGps()
      nav?.dispose()
      nav = null
    },
  }
}
