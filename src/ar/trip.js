// One AR trip: place the route as soon as possible, then keep correcting it in the background.
//
// Phases (reported through onPhase):
//   'starting'    waiting for world tracking NORMAL and a first compass reading
//   'ready'       route placed: arrows and pin visible
//   'no-compass'  this phone gives no compass readings
//
// Once 'ready', a silent collector keeps averaging the compass while the phone is upright and
// steady. Each completed 3 s window eases the route round if it has drifted by more than 5°.
// While walking, map matching (route-matcher.js) lays the walked track onto the route.
import {angleDiff, circularMean, createCalibrator, isPoorAccuracy, startCompass} from './compass.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {createRouteMatcher} from './route-matcher.js'
import {GPS, watchLocation} from '../geo/location.js'

const UPRIGHT_MAX_TILT = 0.55 // |forward.y|: about 33° up or down from level
const FIRST_HEADING_WINDOW_MS = 500 // the first alignment averages this much compass history
const MIN_HORIZONTAL_LOOK = 0.2 // below this the camera looks almost straight up or down: no yaw
const STEADY_MAX_DRIFT_DEG = 6 // the camera must stay this close to where the window started
const REALIGN_MIN_DEG = 5 // smaller differences are compass noise: leave the route alone
const REALIGN_MIN_MATCHED_DEG = 10 // with a confident map match, trust the walked track over the compass
const MATCH_EVERY_S = 2
const TRACKING_HINT_AFTER_S = 4 // show "Move your phone slowly" after this long without NORMAL
const COMPASS_PILL_AFTER_MS = 10_000 // show the figure-8 pill after this long unsteady
const DESKTOP_START_DELAY_S = 2 // a webcam on a desk never reports NORMAL tracking

export function createArTrip({route, origin, destination, allowDesktop = false, onPhase, onStats}) {
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
  let recent = []
  let steadyAnchorDeg = null
  let unsteadySince = null
  let lastFix = null
  let fps = null
  let statsTimer = 0
  let matcher = null
  let lastMatchAt = -Infinity
  const calibrator = createCalibrator()

  function setPhase(next, detail = {}) {
    if (phase === next) return
    phase = next
    onPhase?.(next, detail)
  }

  // ---------- sensors ----------
  const stopCompass = startCompass({
    onReading: ({heading: h, accuracy, source}) => {
      const now = Date.now()
      heading = h
      headingAccuracy = accuracy
      compassSource = source
      recent.push({heading: h, at: now})
      recent = recent.filter((r) => now - r.at <= FIRST_HEADING_WINDOW_MS)
      // A compass that woke up late clears the "no compass" card.
      if (phase === 'no-compass') setPhase('starting')
      const result = phase === 'ready' ? collect(h, accuracy, now) : null
      noteCompassQuality(result, accuracy, now)
    },
    onUnavailable: () => {
      if (heading != null) return
      compassSource = 'none'
      // Laptops have no compass: in desktop test mode, pretend we face north so the scene renders.
      if (!allowDesktop) setPhase('no-compass')
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
      nav.realign(r.heading, matcher.confident ? REALIGN_MIN_MATCHED_DEG : REALIGN_MIN_DEG)
    }
    return r.status === 'unsteady' ? 'unsteady' : 'ok'
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

  function place(h) {
    // Use the freshest good GPS fix for "where am I standing"; else the trip start.
    const fix = lastFix && lastFix.accuracy <= GPS.goodAccuracyM ? lastFix : origin
    nav.align(h, fix)
    restartWindow()
    setPhase('ready', {heading: h})
  }

  /** The first alignment: needs tracking and a heading, nothing from the user. */
  function tryToPlace(time) {
    const trackingOk = tracking === 'NORMAL' || (allowDesktop && time - startedAt > DESKTOP_START_DELAY_S)
    if (!trackingOk) return
    if (heading == null) {
      if (allowDesktop && compassSource === 'none') place(0)
      return
    }
    const f = lookDirection()
    if (Math.hypot(f.x, f.z) >= MIN_HORIZONTAL_LOOK) place(recentHeading())
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

  // ---------- engine hooks ----------
  function onSceneReady({scene, camera: cam}) {
    THREE = window.THREE
    camera = cam
    nav = createNavScene({THREE, scene, camera, route, origin, name: destination.name})
    matcher = createRouteMatcher(nav.route)
    if (phase !== 'no-compass') setPhase('starting')
  }

  function onTracking({status}) {
    tracking = status
  }

  function onTick({dt, time}) {
    if (!nav) return
    startedAt ??= time
    if (tracking === 'NORMAL' || lastNormalAt == null) lastNormalAt = time
    if (phase !== 'ready') tryToPlace(time)
    if (phase === 'ready') runMatching(time)
    const s = nav.update(dt, time)
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
        yawDeg: nav.yawDeg,
        matchOffsetM: matcher.totalOffsetM,
        matchYawDeg: matcher.totalYawDeg,
        matchResidualM: matcher.residualM,
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
      nav.realign(recentHeading())
    },
    stop() {
      stopCompass()
      stopGps()
      nav?.dispose()
      nav = null
    },
  }
}
