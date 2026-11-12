// One AR trip: the user stands on the path and taps Start, then the route keeps being corrected.
//
// Phases (reported through onPhase):
//   'await-start'  the camera is running: the user taps Start
//   'facing'       facing more than 60° off the route: turn until within 30°, then guidance starts
//   'ready'        route placed: guidance running
//
// A chosen start (a door or a pin) is where the user stands: motion tracking runs from there, GPS is
// ignored until the user switches to it, and a door's stored heading replaces the compass.
//
// The compass decides the direction, not which way the user happens to face. A compass can be
// 20-90° out near glass buildings, so with a poor one (or none) nothing is drawn on the ground
// until 6 m of walking has shown the direction. Map matching then corrects whatever is left.
//
// Once 'ready', a silent collector keeps averaging the compass while the phone is upright and
// steady. Each completed 3 s window eases the route round if it has drifted by more than 5°.
// While walking, map matching (route-matcher.js) lays the walked track onto the route, and hit
// tests (ground.js) lay the route onto the real ground.
import {circularMean, createCalibrator, isPoorAccuracy, startCompass} from './compass.js'
import {angleDiff, distanceM, fromLocal, pointAt, polylineSlice, toDeg, toLocal, wrap360} from '../geo/geo.js'
import {DESTINATIONS} from '../map/destinations.js'
import {getRoomCentre} from '../map/room-centres.js'
import {arrowTarget, arrowYawDeg, createRouteTracker, turnPrompt, walkingCorrection} from '../route/compass-guide.js'
import {arrowDirection, routeFromPoints} from '../route/arrow-direction.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {acceptHit, createGroundTracker, HIT_TYPES, SCREEN_POINTS} from './ground.js'
import {createRouteMatcher} from './route-matcher.js'
import {locationPermissionState, watchLocation} from '../geo/location.js'
import {isManual} from '../route/start-point.js'
import {createGuidance, landmarksFrom} from '../route/guidance.js'
import {createArrivalDetector, createConfidenceMonitor, createOffRouteMonitor} from '../route/trip-monitors.js'
import {entranceOf, isOnCampus, planRoute} from '../route/route.js'
import {COMPASS_GUIDE, GPS, GROUND, PIN, ROUTING, START, TRIP} from '../config.js'

/** Compass-style bearing of a direction: degrees clockwise from north (or from SLAM -Z). */
function bearing(east, north) {
  return wrap360(toDeg(Math.atan2(east, north)))
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
  startPoint = null,
  autoStart = false,
  reducedMotion = false,
  onPhase,
  onStats,
  onArrived,
  onTurnClose,
  onTurnNow,
  onTurnPassed,
  onEnterCampus,
}) {
  let route = firstRoute
  let phase = null
  let nav = null
  let camera = null
  let THREE = null
  let tracking = 'LIMITED'
  let startedAt = null
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
  let manual = isManual(startPoint)
  let liveFixes = 0
  let repickUntil = -Infinity
  let startBlocked = false
  let autoStartAt = -Infinity
  let campusCheckAt = -Infinity
  let guideDeg = null // the way to walk from where the phone faces, > 0 to the right
  let arrowLine = null // {from: the trip route it was built from, line: the route for arrow-direction.js}
  let arrowAlong = null // the arrow's last distance along the route, so it cannot slide back
  let arrowBearingDeg = null // where the arrow points, degrees from north (for ?fieldtest=1)
  let cameFromOutside = !isOnCampus(origin)
  let fixesOnCampus = 0
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
  // Is the position good enough to draw the arrow? Unreliable: arrows hidden, the 2D map instead.
  const confidence = createConfidenceMonitor()
  let positionOk = true
  let confidenceNow = {reliable: true, reason: null, gpsBad: false, swingDeg: 0}
  let arrowProgress = null // {distanceAlong, distanceFromRoute, segmentIndex} from arrow-direction.js
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
      recent = recent.filter((r) => now - r.at <= TRIP.firstHeadingWindowMs)
      const result = phase === 'ready' ? collect(h, accuracy, now) : null
      noteCompassQuality(result, accuracy, now)
    },
    onUnavailable: () => {
      if (heading != null) return
      compassSource = 'none' // not a problem: walking the first few metres sets the direction
    },
  })

  let stopGps = () => {}
  const startGps = () => {
    stopGps = watchLocation({
      onFix: (pos) => {
        lastFix = {lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy}
        liveFixes = lastFix.accuracy <= START.liveGpsM ? liveFixes + 1 : 0
      },
      onError: () => {}, // the location step already handled permissions; keep the last fix
    })
  }
  // A chosen start never asks for location. If the phone already allows it, GPS may be offered later.
  if (!manual) startGps()
  else {
    locationPermissionState().then((state) => {
      if (state === 'granted' && !stopped) startGps()
    })
  }

  function lookDirection() {
    return camera.getWorldDirection(new THREE.Vector3())
  }

  /** Average heading of the last ~0.5 s, or the last reading if the compass paused. */
  function recentHeading() {
    const now = Date.now()
    const fresh = recent.filter((r) => now - r.at <= TRIP.firstHeadingWindowMs)
    return fresh.length ? circularMean(fresh.map((r) => r.heading)) : heading
  }

  /**
   * Silent background calibration. Returns the compass state seen by this sample:
   * 'unsteady', 'ok', or null when the phone is tilted or turning and the sample was skipped.
   */
  function collect(h, accuracy, now) {
    const f = lookDirection()
    const lookDeg = toDeg(Math.atan2(f.x, f.z))
    const held =
      Math.abs(f.y) <= TRIP.uprightMaxTilt &&
      (steadyAnchorDeg == null || Math.abs(angleDiff(steadyAnchorDeg, lookDeg)) <= TRIP.steadyMaxDriftDeg)
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
    nav.realign(h - compassBias - matcher.totalYawDeg, matcher.confident ? TRIP.realignMinMatchedDeg : TRIP.realignMinDeg)
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
    if (manual) return origin
    return lastFix && lastFix.accuracy <= GPS.goodAccuracyM ? lastFix : origin
  }

  function trackingReady() {
    return tracking === 'NORMAL' || (allowDesktop && lastTime != null && lastTime - startedAt > TRIP.desktopStartDelayS)
  }

  function compassUsable() {
    return heading != null && !isPoorAccuracy(headingAccuracy, COMPASS_GUIDE.poorAccuracyDeg)
  }

  function compassStale() {
    const newest = recent.at(-1)
    return !newest || Date.now() - newest.at > TRIP.compassStaleMs
  }

  /** Which way the user faces for the arrow and the map: walking has the last word once it has spoken. */
  function guideHeading() {
    if (directionKnown && (compassOff || matcher.locked || compassStale())) return cameraBearing()
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
    confidence.reset()
    positionOk = true
    nav.setVisible(directionKnown)
    compassBias = headingDeg == null ? null : 0
    tracker = createRouteTracker(nav.route, info.s)
    startS = info.s
    restartWindow()
    facingYaw = null
    arrowAlong = info.s // from here the arrow follows motion tracking, from where the walk starts
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
    if (!allowDesktop && Math.hypot(f.x, f.z) < TRIP.minHorizontalLook) return 'look'
    const fix = bestFix()
    const startInfo = nav.startInfo(fix)
    if (startInfo.offset > ROUTING.snapToPathM) return 'path'
    // Standing at a door with it behind you: the stored heading beats a compass beside a building.
    if (manual && Number.isFinite(startPoint.headingDeg)) {
      compassOff = true
      beginGuidance(startPoint.headingDeg)
      return 'ok'
    }
    if (!compassUsable()) {
      beginGuidance(null)
      return 'ok'
    }
    const h = recentHeading()
    facingYaw = arrowYawDeg(arrowBearingFrom(placedAt(startInfo)) ?? startInfo.bearingDeg, h)
    if (turnPrompt(facingYaw)) {
      setPhase('facing')
      return 'facing'
    }
    beginGuidance(h)
    return 'ok'
  }

  /** Waiting for the user to turn towards the route. A compass that goes poor stops the wait. */
  function watchFacing() {
    if (!compassUsable() || compassStale()) return beginGuidance(null)
    const h = recentHeading()
    const info = nav.startInfo(bestFix())
    facingYaw = arrowYawDeg(arrowBearingFrom(placedAt(info)) ?? info.bearingDeg, h)
    if (Math.abs(facingYaw) <= COMPASS_GUIDE.facingOkDeg) beginGuidance(h)
  }

  /** Where the route will put the user once placed: the GPS fix snapped on to it (nav.align). */
  function placedAt(info) {
    return fromLocal(origin, pointAt(nav.route, info.s))
  }

  /** The direction came from walking or a compass that recovered: now the ground can be drawn. */
  function directionFound() {
    directionKnown = true
    nav.setVisible(positionOk)
  }

  /**
   * The confidence check, once a frame while guiding. GPS counts only while the trip follows GPS
   * (not from a chosen door or pin), and the compass only while it sets the direction.
   */
  function checkConfidence(time) {
    const f = lookDirection()
    const level = Math.hypot(f.x, f.z) >= TRIP.minHorizontalLook // looking straight down has no yaw
    confidenceNow = confidence.update({
      time,
      gpsAccuracy: lastFix?.accuracy ?? null,
      // Judged from the first reading here on: the trip starts from Locate's good fix.
      useGps: !manual && lastFix != null,
      heading: compassStale() ? null : heading,
      useCompass: compassSteers(),
      cameraYawDeg: level ? toDeg(Math.atan2(f.x, -f.z)) : null, // the phone's own turn, clockwise
    })
    if (confidenceNow.reliable === positionOk) return
    positionOk = confidenceNow.reliable
    nav.setVisible(directionKnown && positionOk)
  }

  /** Does the compass set the arrow's direction now? (Not a door's heading, not proven walking.) */
  function compassSteers() {
    return heading != null && !compassStale() && !(directionKnown && (compassOff || matcher?.locked))
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
    if (time - lastMatchAt < TRIP.matchEveryS || !matcher.moving(time) || nav.easing) return
    lastMatchAt = time
    const correction = matcher.update(nav.worldToRoute)
    if (correction) nav.applyCorrection(correction)
    // Until the flip that walk counted as going backwards. It was going forwards all along.
    if (correction?.flipped) tracker.set(startS + matcher.everWalkedM)
  }

  /** Where motion tracking says the user is, as a GPS point. */
  function trackedPosition() {
    return fromLocal(origin, nav.worldToRoute({x: camera.position.x, z: camera.position.z}))
  }

  /** Where motion tracking puts the user, once the route is placed (for ?fieldtest=1). */
  function trackedLatLng() {
    if (!nav?.aligned) return {trackedLat: null, trackedLng: null}
    const p = trackedPosition()
    return {trackedLat: p.lat, trackedLng: p.lng}
  }

  /** Plan again from where the user is, keeping the current placement. */
  async function reroute() {
    const from = manual ? trackedPosition() : lastFix
    if (!from || (!manual && from.accuracy > TRIP.rerouteFixM)) return
    rerouting = true
    try {
      const next = await plan(from, destination)
      if (stopped || arrived || !nav || next.status !== 'ok') return
      route = next
      nav.setRoute(next)
      routeVersion += 1
      legCache = null
      startS = nav.startInfo(from).s
      tracker = createRouteTracker(nav.route, startS)
      arrowAlong = startS // the new route starts where the user is
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

  /** Crossing on to campus: say welcome, and let the campus route take over for a campus destination. */
  function noteCampus(fix) {
    if (!cameFromOutside || fix.accuracy > TRIP.rerouteFixM) return
    fixesOnCampus = isOnCampus(fix) ? fixesOnCampus + 1 : 0
    if (fixesOnCampus < TRIP.campusFixes) return
    cameFromOutside = false
    onEnterCampus?.()
    if (!rerouting && !arrived && isOnCampus(entranceOf(destination))) reroute()
  }

  /** Look for the real ground at a few spots in the lower half of the screen. */
  function sampleGround(time) {
    if (tracking !== 'NORMAL' || !xr?.XrController?.hitTest || time - lastGroundAt < GROUND.sampleEveryS) return
    lastGroundAt = time
    for (let i = 0; i < TRIP.pointsPerSample; i++) {
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

  /** Which way to walk from where the phone faces (> 0 to the right), for the arrows over the camera. */
  function updateArrow(s) {
    guideDeg = null
    if (arrived) return
    if (phase === 'facing') {
      guideDeg = facingYaw
      return
    }
    if (phase !== 'ready') return
    const h = guideHeading()
    ringFill = arrowTarget(nav.route, guidance.manoeuvres, guidance.getNextManoeuvre(s), s).ringFill
    // Where motion tracking puts the user (smooth, and kept on the route by GPS and walking).
    const target = arrowBearingFrom(trackedPosition())
    arrowBearingDeg = target
    if (!positionOk) return // not sure where the user is: no arrow, the 2D map leads
    if (h != null && target != null) guideDeg = arrowYawDeg(target, h)
  }

  /**
   * Compass bearing from the user to the point 9 m further along the route (arrow-direction.js).
   * Never straight at the destination: the arrow turns at corners and leads back on to the path.
   */
  function arrowBearingFrom(user) {
    if (arrowLine?.from !== route) arrowLine = {from: route, line: routeFromPoints(route.points)}
    const dir = arrowDirection(arrowLine.line, user, arrowAlong)
    if (!dir) return null
    arrowAlong = dir.progress.distanceAlong
    arrowProgress = dir.progress
    return dir.bearingDeg
  }


  function compassPoor() {
    return heading != null && isPoorAccuracy(headingAccuracy, COMPASS_GUIDE.poorAccuracyDeg)
  }

  /** Walking has proved the placement, so a poor compass no longer matters for the ground arrows. */
  function placementTrusted() {
    return matcher.locked || compassOff || !compassPoor()
  }

  /**
   * A room from MazeMap: stand the pin over the room itself, from the 3D campus model. Only the pin
   * moves; the route and arrival stay at the entrance. A room far from the entrance is a data slip.
   */
  function placePinInRoom() {
    if (!destination.mazemapPoi) return
    getRoomCentre(destination.mazemapPoi).then((centre) => {
      const entrance = route.entrance || route.points.at(-1)
      if (!centre || !nav || distanceM(centre, entrance) > PIN.roomMaxM) return
      nav.setMarker(centre)
    })
  }

  // ---------- engine hooks ----------
  function onSceneReady({scene, camera: cam, XR8}) {
    THREE = window.THREE
    camera = cam
    xr = XR8
    nav = createNavScene({THREE, scene, camera, route, origin, name: destination.name, reducedMotion})
    placePinInRoom()
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
    // A trip from GPS starts by itself: there is nothing to line up, and nothing to tap.
    if (autoStart && !manual && phase === 'await-start' && time - startedAt >= TRIP.autoStartS && time >= autoStartAt) {
      autoStartAt = time + TRIP.autoStartEveryS
      startBlocked = start() === 'path'
    }
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
    if (phase === 'ready' && !arrived) checkConfidence(time)
    if (phase === 'ready') {
      groundNow = ground.update(dt, s.s, camera.position.y, time)
      nav.setGround(groundNow.height, groundNow.slope, s.s)
      if (tracking === 'NORMAL') tracker.walk(camera.position, directionKnown ? nav.worldToRoute : null)
      if (manual) {
        if (directionKnown && time >= campusCheckAt) {
          campusCheckAt = time + TRIP.campusCheckEveryS
          noteCampus({...trackedPosition(), accuracy: 0})
        }
      } else if (lastFix && lastFix !== fedFix) {
        fedFix = lastFix
        tracker.fix(toLocal(origin, lastFix), lastFix.accuracy)
        noteCampus(lastFix)
      }
      tracker.tick(dt)
    }
    const routeS = tracker ? tracker.s : 0
    const remainingM = tracker ? Math.max(0, tracker.totalM - routeS) : route.lengthM
    if (phase === 'ready' && !arrived) {
      if (arrival.update(dt, remainingM, directionKnown ? s.toPinM : null)) {
        arrived = true
        instruction = null
        onArrived?.()
      } else {
        if (time - instructionAt >= TRIP.instructionEveryS) {
          instructionAt = time
          instruction = guidance.instruction(routeS)
        }
        if (guidance.turnPassed(routeS)) onTurnPassed?.()
        if (guidance.turnIsClose(routeS)) onTurnClose?.()
        if (guidance.turnIsNow(routeS)) onTurnNow?.()
        // Only while SLAM knows where the user is, and not while already planning.
        // Measured as the arrow does (arrow-direction.js), and only from a position we trust.
        const fromRoute = positionOk ? (arrowProgress?.distanceFromRoute ?? null) : null
        if (directionKnown && tracking === 'NORMAL' && !rerouting && offRoute.update(fromRoute, time)) {
          if (manual) repickUntil = time + TRIP.repickForS
          reroute()
        }
      }
    }
    updateArrow(routeS)
    statsTimer += dt
    if (statsTimer >= 0.25) {
      statsTimer = 0
      onStats?.({
        phase,
        tracking,
        compassUnsteady: unsteadySince != null && Date.now() - unsteadySince > TRIP.compassPillAfterMs,
        compassPoor: compassPoor() && !placementTrusted(),
        directionKnown,
        manual,
        startBlocked,
        repick: manual && !arrived && time < repickUntil,
        liveAvailable: manual && !arrived && phase === 'ready' && liveFixes >= TRIP.liveFixes,
        turnPrompt: phase === 'facing' ? turnPrompt(facingYaw, 0) : null,
        step: phase === 'ready' && !arrived ? guidance.step(routeS) : null,
        steps: phase === 'ready' ? guidance.steps(routeS) : null,
        ringFill,
        heading,
        headingAccuracy,
        compassSource,
        gpsAccuracy: lastFix?.accuracy ?? null,
        gpsLat: lastFix?.lat ?? null,
        gpsLng: lastFix?.lng ?? null,
        ...trackedLatLng(),
        arrowBearingDeg: phase === 'ready' && !arrived ? arrowBearingDeg : null,
        positionUncertain: phase === 'ready' && !arrived && !positionOk,
        positionReason: confidenceNow.reason,
        headingSwingDeg: confidenceNow.swingDeg,
        distanceFromRouteM: phase === 'ready' ? (arrowProgress?.distanceFromRoute ?? null) : null,
        offRouteForS: offRoute.offForS(time),
        rerouteWaitS: offRoute.waitS(time),
        gpsToEntranceM: gpsDistanceToEntrance(lastFix, route),
         startGapM: nav.startInfo(bestFix()).offset,
         pathBearingDeg: nav.startInfo(bestFix()).pathBearingDeg,
        remainingM: nav.aligned ? remainingM : route.lengthM,
        toPinM: s.toPinM ?? null,
        offRouteM: nav.aligned ? s.offset : null,
        cameraHeight: camera.position.y,
        groundHeight: groundNow.height,
        groundSlope: groundNow.slope,
        groundSource: groundNow.source,
        groundHits: ground.hitCount,
        floorEyeM: ground.eyeM,
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
    /** The way to walk from where the phone faces, > 0 to the right; null when unknown. Read every frame. */
    get guideDeg() {
      return guideDeg
    },
    /** Debug: show the tracked floor as a faint grid. */
    setFloorGrid(show) {
      nav?.setFloorGrid(show)
    },
    /** Debug: move the assumed floor up or down by deltaM. Returns the new height below the phone. */
    nudgeFloor(deltaM) {
      ground.setEyeM(ground.eyeM + deltaM)
      return ground.eyeM
    },
    recalibrate() {
      if (phase !== 'ready' || heading == null) return
      restartWindow()
      compassBias = 0
      nav.realign(recentHeading())
    },
    start,
    /** A chosen start, and GPS has become good: follow GPS from here on. */
    switchToLive() {
      if (!manual || !lastFix) return
      manual = false
      liveFixes = 0
      repickUntil = -Infinity
      fedFix = null
      if (phase === 'ready' && !rerouting) reroute()
    },
    stop() {
      stopped = true
      stopCompass()
      stopGps()
      nav?.dispose()
      nav = null
    },
  }
}
