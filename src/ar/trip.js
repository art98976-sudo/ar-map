// One AR trip: the user stands on the path and taps Start, then the route keeps being corrected.
//
// Phases (reported through onPhase):
//   'await-start'  the camera is running: the user faces the way they will walk and taps Start
//   'ready'        route placed: arrows and pin visible
//
// A compass can be 20-90° out near glass buildings, so the person facing the path decides the
// direction at the start. The compass only refines that if the two agree within 30°.
//
// Once 'ready', a silent collector keeps averaging the compass while the phone is upright and
// steady. Each completed 3 s window eases the route round if it has drifted by more than 5°.
// While walking, map matching (route-matcher.js) lays the walked track onto the route, and hit
// tests (ground.js) lay the route onto the real ground.
import {angleDiff, circularMean, createCalibrator, isPoorAccuracy, startCompass} from './compass.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {acceptHit, createGroundTracker, GROUND, HIT_TYPES, SCREEN_POINTS} from './ground.js'
import {createRouteMatcher} from './route-matcher.js'
import {GPS, watchLocation} from '../geo/location.js'
import {createArrivalDetector, createGuidance, createOffRouteMonitor} from '../nav/guidance.js'
import {planRoute} from '../nav/route.js'

const UPRIGHT_MAX_TILT = 0.55 // |forward.y|: about 33° up or down from level
const FIRST_HEADING_WINDOW_MS = 500 // the Start tap averages this much compass history
const START_COMPASS_AGREE_DEG = 30 // further apart than this, trust the user facing the path
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

/**
 * The bearing the camera is taken to face at the Start tap: along the route, averaged with the
 * compass only if they agree. routeDeg and compassDeg in degrees; compassDeg may be null.
 */
export function chooseStartHeading(routeDeg, compassDeg) {
  if (compassDeg == null || Math.abs(angleDiff(routeDeg, compassDeg)) > START_COMPASS_AGREE_DEG) return routeDeg
  return circularMean([routeDeg, compassDeg])
}

export function createArTrip({
  route: firstRoute,
  origin,
  destination,
  allowDesktop = false,
  debug = false,
  arriveLabel = 'Destination',
  plan = planRoute,
  onPhase,
  onStats,
  onArrived,
  onTurnClose,
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
  let compassBias = null // compass minus the placement at the start: steady error, not drift
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
      compassSource = 'none' // not a problem: the user facing the path sets the direction
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
    if (matcher.flipped || compassOff) return
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

  /**
   * The Start tap: the user is on the path, facing the way they will walk.
   * Returns 'ok', 'tracking' (world tracking not ready) or 'look' (phone pointing up or down).
   */
  function start() {
    if (!nav) return 'tracking'
    if (phase === 'ready') return 'ok'
    if (!trackingReady()) return 'tracking'
    const f = lookDirection()
    // A webcam in test mode reports no direction, so only a real phone can be asked to look up.
    if (!allowDesktop && Math.hypot(f.x, f.z) < MIN_HORIZONTAL_LOOK) return 'look'
    const fix = bestFix()
    const compass = heading == null ? null : recentHeading()
    const h = chooseStartHeading(nav.startInfo(fix).bearingDeg, compass)
    compassBias = compass == null ? null : angleDiff(h, compass)
    nav.setGround(ground.fallback(camera.position.y), 0)
    nav.align(h, fix)
    restartWindow()
    setPhase('ready', {heading: h})
    return 'ok'
  }

  /** Keep the route on the path the user is really walking. Never while tracking is unsure. */
  function runMatching(time) {
    if (tracking !== 'NORMAL') return
    matcher.addSample(camera.position.x, camera.position.z, time)
    if (time - lastMatchAt < MATCH_EVERY_S || !matcher.moving(time) || nav.easing) return
    lastMatchAt = time
    const correction = matcher.update(nav.worldToRoute)
    if (correction) nav.applyCorrection(correction)
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
      // The walk so far no longer has a route to fit, so matching starts afresh. Its turn stays in
      // the placement, so the compass has to keep allowing for it.
      compassOff ||= matcher.flipped
      if (compassBias != null) compassBias += matcher.totalYawDeg
      matcher = createRouteMatcher(nav.route)
      guidance = createGuidance(nav.route, {arriveLabel})
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

  // ---------- engine hooks ----------
  function onSceneReady({scene, camera: cam, XR8}) {
    THREE = window.THREE
    camera = cam
    xr = XR8
    nav = createNavScene({THREE, scene, camera, route, origin, name: destination.name})
    matcher = createRouteMatcher(nav.route)
    guidance = createGuidance(nav.route, {arriveLabel})
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
    if (phase === 'ready' && !arrived) {
      runMatching(time)
      sampleGround(time)
    }
    const s = nav.update(dt, time)
    if (phase === 'ready') {
      groundNow = ground.update(dt, s.s, camera.position.y, time)
      nav.setGround(groundNow.height, groundNow.slope, s.s)
    }
    if (phase === 'ready' && !arrived) {
      if (arrival.update(dt, s.remainingM, s.toPinM)) {
        arrived = true
        instruction = null
        nav.finish()
        onArrived?.()
      } else {
        if (time - instructionAt >= INSTRUCTION_EVERY_S) {
          instructionAt = time
          instruction = guidance.instruction(s.s)
        }
        if (guidance.turnIsClose(s.s)) onTurnClose?.()
        // Only while SLAM knows where the user is, and not while already planning.
        if (tracking === 'NORMAL' && !rerouting && offRoute.update(s.offset, time)) reroute()
      }
    }
    statsTimer += dt
    if (statsTimer >= 0.25) {
      statsTimer = 0
      onStats?.({
        phase,
        tracking,
        trackingStalled: time - lastNormalAt >= TRACKING_HINT_AFTER_S,
        compassUnsteady: unsteadySince != null && Date.now() - unsteadySince > COMPASS_PILL_AFTER_MS,
        heading,
        headingAccuracy,
        compassSource,
        gpsAccuracy: lastFix?.accuracy ?? null,
        gpsToEntranceM: gpsDistanceToEntrance(lastFix, route),
        remainingM: nav.aligned ? s.remainingM : route.lengthM,
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
        nextManoeuvre: nav.aligned ? guidance.getNextManoeuvre(s.s) : null,
        userS: nav.aligned ? s.s : null,
        routePoints: route.points.length,
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
