// One AR trip: the user stands on the path and taps Start, then the route keeps being corrected.
//
// Phases (reported through onPhase):
//   'await-start'  the camera is running: the user taps Start
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
import {angleDiff, distanceM, fromLocal, pointAt, polylineLength, projectOntoPolyline, toDeg, toLocal, toRad, wrap360} from '../geo/geo.js'
import {DESTINATIONS} from '../map/destinations.js'
import {getRoomCentre} from '../map/room-centres.js'
import {arrowTarget, arrowYawDeg, createRouteTracker, walkingCorrection} from '../route/compass-guide.js'
import {createNavPose, levelAt, levelsAlong, steeredBearing} from '../route/nav-pose.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {acceptHit, createFloorFinder, createGroundTracker, FLOOR_GRID, HIT_TYPES} from './ground.js'
import {anchorsNear, floorToLocal} from './building-shell.js'
import {boxAround, fetchFloor} from './mazemap-floor.js'
import {createRouteMatcher} from './route-matcher.js'
import {locationPermissionState, watchLocation} from '../geo/location.js'
import {isManual} from '../route/start-point.js'
import {createGuidance, landmarksFrom} from '../route/guidance.js'
import {createArrivalDetector, createConfidenceMonitor, createOffRouteMonitor} from '../route/trip-monitors.js'
import {entranceOf, isOnCampus, planRoute} from '../route/route.js'
import {markerName} from '../route/card-text.js'
import {COMPASS_GUIDE, GPS, GROUND, GROUND_ARROWS, INDOOR, LINE_UP, MATCH, PIN, ROUTING, SAFETY, SCENE_FLOOR, SHELL, START, TRIP} from '../config.js'
import {createHeightProfile} from '../scene/route-height.js'
import {createTripLog} from './trip-log.js'
import {createHeadingHold, createIndoorGpsGate, entranceIndex, planEntranceAnchor} from './entrance-anchor.js'
import {networkEnabled} from '../config.js'

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
  // Indoor AR on: the arrows carry on through the door, along MazeMap's indoor route to the room.
  // Every route the trip uses (the first one and every reroute) goes through here: a reroute that
  // dropped the indoor part would send the arrows only to the door, outdoors.
  const withIndoor = (r) => (INDOOR.indoorAR && r.indoorPoints?.length >= 2 ? {...r, points: [...r.points, ...r.indoorPoints.slice(1)], entrance: r.indoorPoints.at(-1)} : r)
  let route = withIndoor(firstRoute)
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
  let ringFill = 0
  let routeVersion = 0
  let lineCache = null // the route polyline as map coordinates, per route version
  let manual = isManual(startPoint)
  let liveFixes = 0
  let repickUntil = -Infinity
  let startBlocked = false
  let autoStartAt = -Infinity
  let campusCheckAt = -Infinity
  let guideDeg = null // the way to walk from where the phone faces, > 0 to the right
  let arrowBearingDeg = null // where the arrow points, degrees from north (for ?fieldtest=1)
  // The one pose the map dot, map rotation, arrow, instructions, distance left and off-route all read.
  const navPose = createNavPose()
  // Fix 3: the door the route goes in by (MazeMap's first point on a floor). Reaching it re-anchors
  // the path there; after it SLAM carries the position and GPS only says "back outside".
  const doorIndex = INDOOR.indoorAR && firstRoute.indoorPoints?.length >= 2 ? firstRoute.points.length - 1 : entranceIndex(route.points)
  let doorS = null // the door's distance along nav.route, once the scene is ready
  let entranceAnchored = false
  let entranceAt = -Infinity
  let walkTrack = [] // the user's recent walk in the route frame (SLAM), every ~0.25 m
  const gpsGate = createIndoorGpsGate()
  const headingHold = createHeadingHold()
  let heldHeading = null
  let gpsIgnored = false
  let backOutside = false
  let routeLevels = levelsAlong(route.points, origin) // floor level along the route (0 outdoors)
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
  let lineUp = false // the line-up step is open: drag to turn the route, then "Looks right"
  let lineUpTouched = false // the user has dragged: the compass no longer turns the route
  let compassLocked = false // confirmed by the user, or locked on by walking: never the compass again
  let trackingLostAt = null // when world tracking last stopped being NORMAL
  let arrowsShown = false
  const arrival = createArrivalDetector()
  const offRoute = createOffRouteMonitor()
  // Is the position good enough to draw the arrow? Unreliable: arrows hidden, the 2D map instead.
  const confidence = createConfidenceMonitor()
  let positionOk = true
  let confidenceNow = {reliable: true, reason: null, gpsBad: false, swingDeg: 0}
  let guidance = null
  let instruction = null
  let instructionAt = -Infinity
  let rerouting = false
  let compassOff = false
  let stopped = false
  let xr = null
  let blockIndex = 0 // the next chevron to test for being behind something
  let nextPoint = 0
  let groundNow = {height: null, slope: 0, source: 'eye'}
  let heightAt = () => 0 // the scene's floor height along the route (Step 3)
  let sceneBase = null // where the scene's height 0 is, in the camera's world
  let sceneBaseStart = null
  let sceneBaseFromCamera = false // the camera has found the floor once (else: eye height minus 1.4 m)
  const ground = createGroundTracker() // the slope along the route
  const floor = createFloorFinder() // the floor height under the user
  let floorNow = floor.current
  const calibrator = createCalibrator()
  // ?debug=1 only: one row a second of what the trip believed, for "Download trip log".
  const tripLog = debug ? createTripLog() : null
  // ?network=1 with a network route only: the map-constrained pose (Part C). Loaded in the background;
  // until it is ready (and always without the flag) the trip works exactly as before.
  let netTrip = null
  let netTripPending = null // begin() arguments that arrived before the network finished loading
  let netArrows = null // this frame's network arrows (network-arrows.js planArrows)
  if (networkEnabled() && firstRoute.source === 'network') {
    Promise.all([import('./network-trip.js'), import('../route/network-router.js')])
      .then(([{createNetworkTrip}, {loadNetwork}]) => loadNetwork().then((net) => createNetworkTrip({route: firstRoute, origin, net})))
      .then((t) => {
        if (stopped) return
        netTrip = t
        if (netTripPending) netTrip.begin(netTripPending)
      })
      .catch((err) => console.warn('[trip] network pose unavailable', err?.message))
  }
  const beginNetworkPose = (info) => {
    const args = {
      at: manual ? fromLocal(origin, pointAt(nav.route, info.s)) : (lastFix ?? fromLocal(origin, pointAt(nav.route, info.s))),
      manual,
      accuracyM: manual ? 0 : (lastFix?.accuracy ?? Infinity),
      z: startFloorOf(),
      onRoute: fromLocal(origin, pointAt(nav.route, info.s)),
    }
    if (netTrip) netTrip.begin(args)
    else netTripPending = args
  }
  const startFloorOf = () => {
    for (const v of [startPoint?.floor, startPoint?.z, origin?.floor, origin?.z, route.points[0]?.z]) if (Number.isFinite(v)) return v
    return null
  }
  tripLog?.setMeta({
    destination: destination?.id ?? null,
    routeSource: route.source ?? null,
    startFloor: startFloorOf(),
    manualStart: Boolean(manual),
    tripOrigin: origin ? {lat: origin.lat, lng: origin.lng} : null,
    routeLengthM: route.lengthM ?? null,
  })

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

  /**
   * The compass is only the first guess: once the user has lined the arrows up by hand (or started
   * to), or walking has locked the route on, it never turns the route again.
   */
  function compassMayTurn() {
    if (lineUpTouched || compassLocked) return false
    if (matcher?.locked) {
      compassLocked = true
      return false
    }
    return true
  }

  function realignFromCompass(h) {
    // Once walking has shown the compass is badly wrong, it could only turn the route back.
    if (!directionKnown || matcher.flipped || compassOff || !compassMayTurn()) return
    // Fix 3: a compass swinging near steel or concrete never turns the arrows.
    if (headingHold.holding) return
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
  /** The tracked heading (the camera in the placed route) and its gap to the compass. */
  function trackedHeading() {
    if (!nav?.aligned || !camera) return {trackedHeadingDeg: null, headingGapDeg: null}
    const tracked = cameraBearing()
    return {trackedHeadingDeg: tracked, headingGapDeg: heading == null ? null : angleDiff(heading, tracked)}
  }

  function guideHeading() {
    if (directionKnown && (compassOff || matcher.locked || compassStale())) return cameraBearing()
    // Fix 3: while the compass swings, the last good heading.
    if (heading != null) return headingHold.holding && heldHeading != null ? heldHeading : recentHeading()
    return directionKnown ? cameraBearing() : null
  }

  // ---------- Fix 3: the entrance, indoor GPS, and where position and heading come from ----------
  /** Is the user inside by route progress (re-anchored at the door, or on a floor)? */
  function indoorsNow() {
    return entranceAnchored || levelAt(routeLevels, tracker?.s ?? 0) !== 0
  }

  function positionSourceNow(time) {
    if (phase !== 'ready') return manual ? 'manual' : 'gps'
    if (entranceAnchored && time - entranceAt < TRIP.entranceLabelS) return 'entrance anchor'
    if (indoorsNow() && !backOutside) return 'SLAM'
    return manual ? 'manual' : 'GPS'
  }

  function headingSourceNow() {
    if (phase !== 'ready' || !directionKnown) return 'none yet'
    if (entranceAnchored) return 'entrance (SLAM)'
    if (lineUpTouched || compassLocked || matcher?.locked) return 'walking (SLAM)'
    if (compassOff) return manual && Number.isFinite(startPoint?.headingDeg) ? 'door' : 'walking (SLAM)'
    if (headingHold.holding) return 'compass (held, swinging)'
    return heading != null ? 'compass' : 'SLAM'
  }

  /** The user's walk in the route frame, a point every 0.25 m: the direction for the door anchor. */
  function recordWalk() {
    const p = nav.worldToRoute({x: camera.position.x, z: camera.position.z})
    const last = walkTrack.at(-1)
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.25) return
    walkTrack.push(p)
    if (walkTrack.length > 40) walkTrack.shift()
  }

  /**
   * At the door (route progress within a couple of metres of it), once: put the user on the door
   * and turn the path so its direction through the door is the way they walked in. From then on
   * the heading and position are SLAM's, not the compass's or GPS's.
   */
  function anchorAtEntrance(time) {
    if (entranceAnchored || doorS == null || !directionKnown || tracking !== 'NORMAL' || nav.easing) return
    if (netTrip && route.source === 'network') return // ?network=1 has its own door anchors
    const plan = planEntranceAnchor({route: nav.route, doorS, s: tracker.s, track: walkTrack})
    if (!plan) return
    if (plan.turnDeg) nav.rotateAboutUser(-toRad(plan.turnDeg)) // clockwise: rotateAboutUser takes anticlockwise
    reanchorAtLocal(plan.at)
    entranceAnchored = true
    entranceAt = time
    compassOff = true
    compassLocked = true
    walkTrack = []
    console.info('[trip] re-anchored at the entrance', {turnDeg: Math.round(plan.turnDeg * 10) / 10, walkedM: Math.round(plan.walkedM * 10) / 10})
  }

  /** Place the route and start guiding. headingDeg: the compass; null: find out by walking. */
  function beginGuidance(headingDeg, {facingKnown = false} = {}) {
    const fix = bestFix()
    const info = nav.startInfo(fix)
    // Step 3: the floor's height comes from the scene. Where the scene is at height 0 is set once
    // here, from the camera (a floor it found, or eye height); after that the camera only refines it.
    sceneBaseStart = (floorNow.found ? floorNow.height : ground.fallback(camera.position.y)) - heightAt(info.s)
    sceneBase = sceneBaseStart
    nav.setGround(sceneBase + heightAt(info.s), 0)
    nav.align(headingDeg ?? info.bearingDeg, fix)
    // A webcam in test mode has no compass and cannot walk.
    directionKnown = headingDeg != null || allowDesktop
    confidence.reset()
    positionOk = true
    nav.setVisible(directionKnown)
    compassBias = headingDeg == null ? null : 0
    tracker = createRouteTracker(nav.route, info.s)
    navPose.reset()
    startS = info.s
    if (networkEnabled() && route.source === 'network') beginNetworkPose(info)
    restartWindow()
    // Group B: no line-up step. The arrows show at once (dimmed) and the walk lines them up;
    // "Re-align" opens the drag step on demand. facingKnown is kept for the record.
    void facingKnown
    lineUp = false
    lineUpTouched = false
    setPhase('ready', {heading: headingDeg})
  }

  /**
   * The Start tap, with the user on the path. Returns 'ok', 'tracking' (world
   * tracking not ready), 'look' (phone pointing up or down) or 'path' (too far from the path).
   */
  function start() {
    if (!nav) return 'tracking'
    if (phase === 'ready') return 'ok'
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
      beginGuidance(startPoint.headingDeg, {facingKnown: true})
      return 'ok'
    }
    if (!compassUsable()) {
      beginGuidance(null)
      return 'ok'
    }
    // No "turn around" prompt: the arrows on the floor bend towards the route whichever way the user faces.
    beginGuidance(recentHeading())
    return 'ok'
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
    // GPS is useful for placing and correcting the outdoor leg, but it becomes unreliable inside
    // buildings. Once the tracked route reaches a MazeMap floor, let SLAM and the compass carry
    // the position confidence instead of hiding the arrows because an indoor GPS fix wandered.
    const onIndoorFloor = levelAt(routeLevels, tracker?.s ?? 0) !== 0
    confidenceNow = confidence.update({
      time,
      gpsAccuracy: lastFix?.accuracy ?? null,
      // Judged from the first reading here on: the trip starts from Locate's good fix.
      useGps: !manual && !onIndoorFloor && lastFix != null,
      heading: compassStale() ? null : heading,
      useCompass: compassSteers(),
      cameraYawDeg: level ? toDeg(Math.atan2(f.x, -f.z)) : null, // the phone's own turn, clockwise
    })
    // Fix 3: a swing of more than ENTRANCE.holdSwingDeg keeps the last good heading.
    heldHeading = headingHold.update(heading != null && !compassStale() ? recentHeading() : null, confidenceNow.swingDeg)
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
    // Indoors (Fix 3) a GPS fix is noise: plan from where SLAM puts the user, on their floor.
    const inside = indoorsNow() && !backOutside
    const level = levelAt(routeLevels, tracker?.s ?? 0)
    const from = inside ? {...trackedPosition(), z: level, floor: level} : manual ? trackedPosition() : lastFix
    if (!from || (!manual && !inside && from.accuracy > TRIP.rerouteFixM)) return
    rerouting = true
    try {
      const planned = await plan(from, destination)
      if (stopped || arrived || !nav || planned.status !== 'ok') return
      const next = withIndoor(planned)
      route = next
      nav.setRoute(next)
      heightAt = createHeightProfile(next.points, nav.route, origin)
      routeVersion += 1
      lineCache = null
      routeLevels = levelsAlong(next.points, origin)
      if (!entranceAnchored) {
        const door = INDOOR.indoorAR && planned.indoorPoints?.length >= 2 ? planned.points.length - 1 : entranceIndex(next.points)
        doorS = door > 0 ? projectOntoPolyline(nav.route, toLocal(origin, next.points[door])).s : null
      }
      startS = nav.startInfo(from).s
      tracker = createRouteTracker(nav.route, startS)
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

  /** The engine's hit test at a screen point (0..1 from the top left), or [] if it cannot. */
  function hitTest(x, y) {
    if (!xr?.XrController?.hitTest) return []
    try {
      return xr.XrController.hitTest(x, y, HIT_TYPES) || []
    } catch (err) {
      console.warn('[ground] hit test failed', err)
      return []
    }
  }

  /**
   * Look for the floor across the lower half of the screen, from the moment tracking starts:
   * several tests a frame until the floor is found, fewer after. Hits also feed the slope along
   * the route once it is placed.
   */
  function sampleFloor(time) {
    if (tracking !== 'NORMAL' || !xr?.XrController?.hitTest) return
    const count = floor.found ? GROUND.floorTestsFound : GROUND.floorTestsSearching
    for (let i = 0; i < count; i++) {
      const [x, y] = FLOOR_GRID[nextPoint]
      nextPoint = (nextPoint + 1) % FLOOR_GRID.length
      for (const {position, type} of hitTest(x, y)) {
        if (!position) continue
        floor.addHit(position, type, camera.position, time)
        if (!nav.aligned) continue
        const along = nav.routePosition(position)
        if (acceptHit(position, camera.position, along.offset)) ground.addHit(along.s, position.y, camera.position.y, time)
      }
    }
  }

  /**
   * Hide chevrons behind things: a few chevrons a frame, in turn, hit test toward where each is
   * on screen. A surface more than blockMarginM nearer than the chevron blocks it.
   */
  function checkBlocked() {
    if (!arrowsShown || tracking !== 'NORMAL' || !xr?.XrController?.hitTest) return
    for (let k = 0; k < GROUND_ARROWS.blockChecksPerFrame; k++) {
      const i = blockIndex
      blockIndex = (blockIndex + 1) % GROUND_ARROWS.poolSize
      const spot = nav.arrowScreenSpot(i)
      if (!spot) continue
      let nearest = Infinity
      for (const {position} of hitTest(spot.x, spot.y)) {
        if (position) nearest = Math.min(nearest, Math.hypot(position.x - camera.position.x, position.y - camera.position.y, position.z - camera.position.z))
      }
      nav.setArrowBlocked(spot.s, nearest < spot.distance - GROUND_ARROWS.blockMarginM)
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
    const pose = navPose.current
    const user = pose.shownS != null ? pointAt(nav.route, pose.shownS) : nav.routePointForFix(fix)
    return {
      route: nav.route,
      user,
      headingDeg: pose.headingDeg ?? heading ?? start.bearingDeg,
    }
  }

  /** The heading-up map: where to draw everything, in lat/lng. Null until the scene is ready. */
  function mapState() {
    if (!nav) return null
    const pose = navPose.current
    const s = pose.shownS ?? nav.startInfo(bestFix()).s
    // The very polyline the ground arrows are built from, so the map and the floor show one line.
    if (lineCache?.version !== routeVersion) lineCache = {version: routeVersion, coords: nav.route.map((p) => toCoord(fromLocal(origin, p)))}
    return {
      headingDeg: pose.headingDeg ?? guideHeading(),
      user: fromLocal(origin, pointAt(nav.route, s)),
      floorLevel: levelAt(routeLevels, s),
      routeCoords: lineCache.coords,
      routeVersion,
      approximate: route.approximate ?? ['direct', 'footpaths'].includes(route.source),
    }
  }

  /** Which way to walk from where the phone faces (> 0 to the right), and the arrow's bearing for ?fieldtest=1. */
  function updateArrow() {
    guideDeg = null
    if (arrived) return
    if (phase !== 'ready') return
    const pose = navPose.current
    if (pose.routeS == null) return
    // The path's own direction 8 m ahead of the pose (blended through turns), leaning back towards
    // the route only once walking has proved the placement and the user is well off it.
    const path = arrowTarget(nav.route, guidance.manoeuvres, guidance.getNextManoeuvre(pose.routeS), pose.routeS)
    ringFill = path.ringFill
    const target = steeredBearing(path.bearingDeg, pose.lateralOffsetM, Boolean(matcher?.confident))
    arrowBearingDeg = target
    if (!positionOk) return // not sure where the user is: no arrow, the 2D map leads
    if (pose.headingDeg != null && target != null) guideDeg = arrowYawDeg(target, pose.headingDeg)
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
    // Indoor AR off: the walk ends at the door, so the marker stays there with the door's name.
    if (!destination.mazemapPoi || (destination.category === 'room' && !INDOOR.indoorAR)) return
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
    const name = markerName(destination, route.entrance ?? null, DESTINATIONS, INDOOR.indoorAR)
    nav = createNavScene({THREE, scene, camera, route, origin, name, reducedMotion})
    doorS = doorIndex > 0 ? projectOntoPolyline(nav.route, toLocal(origin, route.points[doorIndex])).s : null
    heightAt = createHeightProfile(route.points, nav.route, origin)
    placePinInRoom()
    matcher = createRouteMatcher(nav.route)
    guidance = createGuidance(nav.route, {arriveLabel, landmarks})
    setPhase('await-start')
  }

  function onTracking({status}) {
    if (status !== 'NORMAL' && tracking === 'NORMAL') trackingLostAt = lastTime
    if (status === 'NORMAL') {
      // Back after a real loss: the world may have moved, so the floor (and a tapped floor) is found again.
      if (trackingLostAt != null && lastTime - trackingLostAt > GROUND_ARROWS.trackingLostS) {
        floor.clear()
        sceneBaseFromCamera = false // the tracked world may have moved: take the next floor found
      }
      trackingLostAt = null
    }
    tracking = status
  }

  /**
   * The user tapped the camera view at (x, y), 0..1 from the top left: if that is the floor, its
   * height is the floor from now on (until tracking resets). Returns true if a floor was found.
   */
  function tapFloor(x, y) {
    if (!camera || tracking !== 'NORMAL') return false
    const below = hitTest(x, y)
      .map((h) => h.position)
      .filter((p) => p && camera.position.y - p.y >= GROUND.floorMinDropM * 0.6 && camera.position.y - p.y <= GROUND.floorMaxDropM + 0.3)
      .sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z))
    if (!below.length) return false
    floor.setTap(below[0].y)
    return true
  }

  /**
   * Are the ground arrows drawn? As soon as the route is placed; not while the position or heading
   * has been unreliable for 3 s (the map leads then, "Finding your position"), and not once tracking
   * has been lost for more than GROUND_ARROWS.trackingLostS (a webcam in test mode never tracks).
   */
  function arrowsWanted(time) {
    if (phase !== 'ready' || arrived || !nav?.aligned || !positionOk) return false
    if (allowDesktop || tracking === 'NORMAL') return true
    return trackingLostAt != null && time - trackingLostAt <= GROUND_ARROWS.trackingLostS
  }

  // ---------- the building shell: MazeMap's real walls and doors ----------
  let shellAt = null // {level, centre {lat,lng}} the loaded floor and where it was loaded around
  let shellLoading = false
  let shellFloor = null // the floor in route-frame metres
  let lowFpsSince = null
  let lowFps = false
  let wallLinesShown = false
  let wireOn = false

  /** The floor level the route is on here: its own level indoors, the level of its door outside. */
  function shellLevel() {
    const z = navPose.current.floorLevel
    if (Number.isFinite(z) && z !== 0) return z
    return Number.isFinite(route.entryLevel) ? route.entryLevel : SHELL.defaultLevel
  }

  // ---------- Step 4: the walls and doors come from the route's scene ----------
  let routeScene = null // the scene the route was fitted on (scene-data.js), once loaded
  let routeSceneLoading = false

  /** Load the scene for the route, once: the same floors the route was fitted to. */
  function loadRouteScene() {
    if (routeScene || routeSceneLoading || !route.points?.some((p) => Number.isFinite(p.z) && p.z !== 0)) return
    routeSceneLoading = true
    import('../scene/scene-load.js')
      .then(({loadScene}) => loadScene(route.points, origin))
      .then((scene) => {
        if (!stopped) routeScene = scene
      })
      .catch((err) => console.warn('[scene] could not load the floors', err?.message))
      .finally(() => {
        routeSceneLoading = false
      })
  }

  /** The scene's floor for the level the user is on, as the shell (occluder, doorways). */
  function sceneShell() {
    const level = shellLevel()
    if (!routeScene?.floors[level]) return false
    if (shellAt?.level === level && shellAt.scene) return true
    shellFloor = {...routeScene.floors[level], level}
    shellAt = {level, scene: true, centre: trackedPosition()}
    nav.setShellFloor(shellFloor, lowFps ? {near: {point: nav.worldToRoute({x: camera.position.x, z: camera.position.z}), metres: SHELL.lowFpsWallsM}} : {})
    nav.setWireframe(wireOn)
    wallLinesShown = false
    return true
  }

  /** Placeholder until Step 5: how sure we are the arrows sit where the scene says (0 to 1). */
  function alignQuality() {
    if (compassLocked || matcher?.locked) return 0.9
    if (matcher?.confident) return 0.75
    return 0.3
  }

  /** Keep the walls and doors around the user loaded, for the floor the route is on. */
  function updateShell(time) {
    if (phase !== 'ready' || !nav?.aligned) return
    loadRouteScene()
    if (sceneShell()) return // the route's own scene: nothing to fetch
    if (shellLoading) return
    const here = trackedPosition()
    if (!isOnCampus(here)) return
    const level = shellLevel()
    if (shellAt && shellAt.level === level && distanceM(shellAt.centre, here) < SHELL.reloadAfterM) return
    shellLoading = true
    const centre = {lat: here.lat, lng: here.lng}
    fetchFloor(level, boxAround(centre, SHELL.loadRadiusM))
      .then((floor) => {
        if (stopped || !nav) return
        shellFloor = floorToLocal(floor, origin)
        shellAt = {level, centre}
        nav.setShellFloor(shellFloor, lowFps ? {near: {point: toLocal(origin, centre), metres: SHELL.lowFpsWallsM}} : {})
        nav.setWireframe(wireOn)
        wallLinesShown = false
      })
      .catch((err) => console.warn('[shell] could not load the walls', err?.message))
      .finally(() => {
        shellLoading = false
      })
    void time
  }

  /** The occluder only once the route is confirmed; wall lines while lining up; doorway outlines. */
  function paintShell(routeS) {
    if (!nav?.shellLoaded) return
    // Step 4: walls hide arrows only when the alignment is good, so a bad one never hides them.
    nav.setOccluder(alignQuality() >= SHELL.occluderMinQuality && arrowsShown)
    const wantLines = phase === 'ready' && lineUp && !arrived
    if (wantLines !== wallLinesShown) {
      wallLinesShown = wantLines
      nav.showWallLines(wantLines, nav.worldToRoute({x: camera.position.x, z: camera.position.z}))
    }
    nav.updateDoorways(arrowsShown ? routeS : -Infinity)
  }

  // ---------- indoors: floor changes, and "I'm here" ----------
  let floorChange = null // {s, toLevel, up, point}: the stair or lift the route takes next, when near
  let poorSince = null
  let offerReanchor = false

  /** The next change of floor along the route after s: {s, toLevel, up}, or null. */
  function nextLevelChange(s) {
    for (let i = 1; i < routeLevels.length; i++) {
      const a = routeLevels[i - 1]
      const b = routeLevels[i]
      if (b.s <= s || b.z === a.z || a.z === 0 || b.z === 0) continue
      return {s: b.s, toLevel: b.z, up: b.z > a.z}
    }
    return null
  }

  // ---------- Group B: no line-up step ----------
  let unconfirmedSince = null
  let offerRealign = false

  /** The arrows are placed for sure: the walked track matches the route, or the user lined them up. */
  function arrowsConfirmed() {
    return Boolean(matcher?.confident || matcher?.locked || compassLocked)
  }

  /**
   * Still not matching LINE_UP.offerAfterS after walking far enough to tell: offer "Re-align".
   * Standing still is not "poor": nothing can be matched yet. And the floor prompt waits 3 s.
   */
  function watchLineUp(time) {
    const ready = phase === 'ready' && !arrived && nav?.aligned
    if (!ready || lineUp || arrowsConfirmed() || (matcher?.walkedM ?? 0) < MATCH.minWalkedM) {
      unconfirmedSince = null
      if (arrowsConfirmed()) offerRealign = false
    } else {
      unconfirmedSince ??= time
      if (time - unconfirmedSince >= LINE_UP.offerAfterS) offerRealign = true
    }
  }


  /** Once a frame indoors: is a stair or lift close? Has the walk stopped matching the route? */
  function checkIndoor(time) {
    if (phase !== 'ready' || arrived || !tracker) {
      floorChange = null
      return
    }
    const next = nextLevelChange(tracker.s)
    floorChange = next && next.s - tracker.s <= INDOOR.stairNearM ? next : null
    // A walk that keeps missing the route (indoors there is no GPS to put it right): offer "I'm here".
    const residual = matcher?.residualM
    if (Number.isFinite(residual) && residual > INDOOR.poorMatchM) {
      poorSince ??= time
      if (time - poorSince >= INDOOR.poorMatchForS) offerReanchor = true
    } else poorSince = null
  }

  // ---------- safety: "Look up while you walk" ----------
  let heldUpWalkS = 0
  let lookUpShown = false
  let lookUpUntil = -Infinity

  /** Walking for 10 s with the phone held up in front: remind the user to look up, once per trip. */
  function watchHeldUp(dt, time) {
    if (lookUpShown || phase !== 'ready' || arrived || tracking !== 'NORMAL' || !camera) return
    const held = -lookDirection().y <= SAFETY.raisedMaxY
    heldUpWalkS = held && matcher?.moving(time) ? heldUpWalkS + dt : 0
    if (heldUpWalkS >= SAFETY.lookUpAfterS) {
      lookUpShown = true
      lookUpUntil = time + SAFETY.lookUpForS
    }
  }

  /** Indoor AR: how far up or down a route point is from the user's floor, in metres. */
  /** The arrows ahead sit on the scene's floor: its height there, from the floor under the user. */
  function arrowLevelLift(userS) {
    const here = heightAt(userS)
    return (s) => heightAt(s) - here
  }

  /** Put the user at route-frame point p: the arrows and the dot move there; line up again. */
  function reanchorAtLocal(p) {
    if (!nav?.aligned || !tracker) return false
    nav.placeUserAt(p)
    tracker.set(projectOntoPolyline(nav.route, p).s)
    matcher = createRouteMatcher(nav.route)
    lastMatchAt = -Infinity
    offerReanchor = false
    poorSince = null
    lineUp = false
    lineUpTouched = false
    return true
  }

  /** Below SHELL.lowFps for SHELL.lowFpsForS: keep only the walls near the user. */
  function watchFps(time) {
    if (fps == null || lowFps) return
    if (fps < SHELL.lowFps) {
      lowFpsSince ??= time
      if (time - lowFpsSince >= SHELL.lowFpsForS) {
        lowFps = true
        if (shellFloor && shellAt) nav.setShellFloor(shellFloor, {near: {point: toLocal(origin, shellAt.centre), metres: SHELL.lowFpsWallsM}})
        nav.setLowPower?.(true)
      }
    } else lowFpsSince = null
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
    if (phase === 'ready' && !arrived) {
      // A compass that recovers before walking has shown the way: use it, from where the user is.
      if (!directionKnown && compassUsable() && compassMayTurn() && !headingHold.holding) {
        nav.align(recentHeading(), fromLocal(origin, pointAt(nav.route, tracker.s)))
        compassBias = 0
        directionFound()
      }
      runMatching(time)
    }
    // The floor: searched from the moment the camera tracks, before Start too.
    if (!arrived) sampleFloor(time)
    floorNow = floor.update(dt, camera.position, time)
    const s = nav.update(dt, time)
    if (phase === 'ready' && !arrived) checkConfidence(time)
    if (phase === 'ready') {
      // Step 3: the floor under the user is the scene's (its height along the route, from where
      // the scene sits). A floor the camera finds moves that silently, eased and capped.
      ground.update(dt, s.s, camera.position.y, time)
      const hUser = heightAt(s.s)
      sceneBase ??= (floorNow.found ? floorNow.height : ground.fallback(camera.position.y)) - hUser
      sceneBaseStart ??= sceneBase
      if (floorNow.found && Number.isFinite(floorNow.height)) {
        const want = floorNow.height - hUser
        if (!sceneBaseFromCamera || floorNow.source === 'tap') {
          // The first floor the camera finds (or a tap in ?debug=1) replaces the eye-height guess:
          // followed as the finder settles on it, then only refined.
          sceneBase = want
          sceneBaseStart = want
          if (!Number.isFinite(floorNow.target) || Math.abs(floorNow.height - floorNow.target) < SCENE_FLOOR.settledM) sceneBaseFromCamera = true
        } else {
          const step = SCENE_FLOOR.refineMps * dt
          sceneBase += Math.max(-step, Math.min(step, want - sceneBase))
          sceneBase = Math.max(sceneBaseStart - SCENE_FLOOR.maxRefineM, Math.min(sceneBaseStart + SCENE_FLOOR.maxRefineM, sceneBase))
        }
      }
      groundNow = {height: sceneBase + hUser, slope: 0, source: sceneBaseFromCamera ? 'scene+camera' : 'scene'}
      nav.setGround(groundNow.height, 0, s.s)
      nav.setPinLift(heightAt(Infinity) - hUser)
      if (tracking === 'NORMAL') tracker.walk(camera.position, directionKnown ? nav.worldToRoute : null)
      if (tracking === 'NORMAL' && directionKnown) recordWalk()
      anchorAtEntrance(time)
      if (manual) {
        if (directionKnown && time >= campusCheckAt) {
          campusCheckAt = time + TRIP.campusCheckEveryS
          noteCampus({...trackedPosition(), accuracy: 0})
        }
      } else if (lastFix && lastFix !== fedFix) {
        fedFix = lastFix
        // Fix 3: indoors a fix never moves the position; it only says the user went back outside.
        const gate = gpsGate.update(lastFix, indoorsNow())
        gpsIgnored = !gate.use
        backOutside = gate.outside
        if (gate.use) tracker.fix(toLocal(origin, lastFix), lastFix.accuracy)
        noteCampus(lastFix)
      }
      tracker.tick(dt)
      // ?network=1: the map-constrained pose places the user on the route (it owns s from here).
      if (netTrip?.current.started && route.source === 'network' && nav.aligned) {
        const np = netTrip.tick({camera: camera.position, worldToRoute: nav.worldToRoute, tracking, heading, fix: manual ? null : lastFix})
        tracker.set(np.s)
      }
      // The one pose for this frame. Everything below, and the map and arrow, read only this.
      navPose.update({
        route: nav.route,
        routeS: tracker.s,
        shownS: tracker.shownS,
        tracked: nav.aligned ? nav.worldToRoute({x: camera.position.x, z: camera.position.z}) : null,
        headingDeg: guideHeading(),
        floorLevel: levelAt(routeLevels, tracker.s),
        confident: positionOk && directionKnown && (tracking === 'NORMAL' || allowDesktop),
      })
    }
    const pose = navPose.current
    const routeS = pose.routeS ?? 0
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
        // The pose's sideways offset, and only from a position we trust.
        const fromRoute = pose.confident && pose.lateralOffsetM != null ? Math.abs(pose.lateralOffsetM) : null
        if (directionKnown && tracking === 'NORMAL' && !rerouting && offRoute.update(fromRoute, time)) {
          if (manual) repickUntil = time + TRIP.repickForS
          reroute()
        }
      }
    }
    updateArrow()
    // The chevrons on the floor: same pose s as the map dot, height from the ground estimate.
    arrowsShown = arrowsWanted(time)
    checkBlocked()
    // Half-transparent while the floor is still a guess; solid once it is found (or tapped).
    // 80% until the walked track matches the route, then full (Group B).
    watchLineUp(time)
    const floorOpacity = 1 // the scene knows the floor: no half-transparent "guess"
    const matchOpacity = arrowsConfirmed() ? 1 : LINE_UP.unconfirmedOpacity
    // ?network=1: the pose's confidence decides normal / faded / hidden, and the arrows stop at the
    // next turn, door or stair (or before a wall). Recomputed every frame, so after every anchor.
    netArrows = netTrip?.current.started && route.source === 'network' ? netTrip.arrows() : null
    nav.updateArrows({
      userS: routeS,
      slope: groundNow.slope,
      show: arrowsShown && netArrows?.mode !== 'hidden',
      opacity: floorOpacity * matchOpacity * (netArrows?.opacity ?? 1),
      dt,
      time,
      lift: arrowLevelLift(routeS),
      maxS: netArrows ? netArrows.untilS : null,
    })
    updateShell(time)
    checkIndoor(time)
    watchHeldUp(dt, time)
    paintShell(routeS)
    watchFps(time)
    tripLog?.sample(() => {
      const tracked = pose.tracked ?? null
      const where = tracked ? fromLocal(origin, tracked) : lastFix
      return {
        phase,
        routeSource: route.source ?? null,
        startFloor: startFloorOf(),
        floorLevel: pose.floorLevel ?? null,
        lat: where?.lat ?? null,
        lng: where?.lng ?? null,
        positionFrom: tracked ? 'tracking' : lastFix ? 'gps' : null,
        gpsLat: lastFix?.lat ?? null,
        gpsLng: lastFix?.lng ?? null,
        gpsAccuracyM: lastFix?.accuracy ?? null,
        // Route-local metres (x east, y north of the trip origin), as the pose holds them.
        x: tracked && Number.isFinite(tracked.x) ? Number(tracked.x.toFixed(2)) : null,
        y: tracked && Number.isFinite(tracked.y) ? Number(tracked.y.toFixed(2)) : null,
        headingDeg: pose.headingDeg ?? null,
        compassDeg: heading,
        compassSource,
        tracking,
        routeS: pose.routeS ?? null,
        snapDistanceM: pose.lateralOffsetM != null ? Number(Math.abs(pose.lateralOffsetM).toFixed(2)) : null,
        routeSnapStartM: route.snapStartM ?? null,
        confident: Boolean(pose.confident),
        positionReliable: confidenceNow.reliable,
        positionReason: confidenceNow.reason,
        matchResidualM: matcher?.residualM ?? null,
        // ?network=1: the map-constrained pose (Part C).
        ...(netTrip?.current.started ? (({x, y, z: nz, s: ns, confidence: nc, headingLocked, lastAnchor, sinceAnchorM, offRouteM}) => ({
          networkX: Number(x.toFixed(2)),
          networkY: Number(y.toFixed(2)),
          networkFloor: nz,
          networkS: Number(ns.toFixed(2)),
          networkConfidence: Number(nc.toFixed(3)),
          networkHeadingLocked: headingLocked,
          networkAnchor: lastAnchor?.kind ?? null,
          networkSinceAnchorM: Number(sinceAnchorM.toFixed(1)),
          networkOffRouteM: Number(offRouteM.toFixed(2)),
        }))(netTrip.current) : {}),
      }
    })
    statsTimer += dt
    if (statsTimer >= 0.25) {
      const poseTurn = nav.aligned ? nav.nextTurnAt(routeS) : null
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
        step: phase === 'ready' && !arrived ? guidance.step(routeS) : null,
        steps: phase === 'ready' ? guidance.steps(routeS) : null,
        ringFill,
        heading,
        headingAccuracy,
        compassSource,
        // 9.2: the camera's tracked heading beside the compass, and how far apart they are.
        ...trackedHeading(),
        gpsAccuracy: lastFix?.accuracy ?? null,
        // Fix 3, for the ?debug=1 overlay: where the position and heading come from right now.
        positionSource: positionSourceNow(time),
        headingSource: headingSourceNow(),
        gpsAccuracyM: lastFix?.accuracy ?? null,
        gpsIgnored,
        backOutside,
        entranceAnchored,
        gpsLat: lastFix?.lat ?? null,
        gpsLng: lastFix?.lng ?? null,
        ...trackedLatLng(),
        arrowBearingDeg: phase === 'ready' && !arrived ? arrowBearingDeg : null,
        positionUncertain: phase === 'ready' && !arrived && !positionOk,
        positionReason: confidenceNow.reason,
        headingSwingDeg: confidenceNow.swingDeg,
        distanceFromRouteM: phase === 'ready' && pose.lateralOffsetM != null ? Math.abs(pose.lateralOffsetM) : null,
        lateralOffsetM: phase === 'ready' ? pose.lateralOffsetM : null,
        poseConfident: pose.confident,
        lookUp: time < lookUpUntil,
        shellLoaded: Boolean(nav.shellLoaded),
        // Indoors: the stair or lift ahead ("Go to Level n"), and whether to offer "I'm here".
        floorChange: floorChange ? {toLevel: floorChange.toLevel, up: floorChange.up} : null,
        offerReanchor,
        canReanchor: phase === 'ready' && !arrived && Boolean(shellFloor),
        shellLevel: nav.shellLevel,
        lowFps,
        floorLevel: pose.floorLevel,
        lineUp: phase === 'ready' && lineUp && !arrived,
        canRealign: phase === 'ready' && !lineUp && !arrived && Boolean(nav.aligned),
        compassLocked,
        aligned: Boolean(nav.aligned),
        arrowsShown,
        arrowsCreated: nav.arrowsCreated,
        arrowsDrawn: nav.arrowsShown,
        arrowsInView: arrowsShown ? nav.arrowsInView() : 0,
        // None in view: which way they are, for one small chevron at the screen edge.
        edgeArrowDeg: arrowsShown ? (nav.arrowsOffscreen()?.angleDeg ?? null) : null,
        turnRings: arrowsShown ? nav.turnRingsShown : 0,
        // Step 3: never asked; the scene gives the floor and the camera refines it silently.
        pointAtFloor: false,
        offerRealign: phase === 'ready' && !arrived && offerRealign,
        arrowsConfirmed: arrowsConfirmed(),
        floorSource: floorNow.source,
        floorBelowM: floorNow.belowPhoneM,
        floorHits: floorNow.hits,
        arrowsVisible: arrowsShown ? nav.arrowsVisible : 0,
        arrowsBlocked: arrowsShown ? nav.arrowsBlocked : 0,
        offRouteForS: offRoute.offForS(time),
        rerouteWaitS: offRoute.waitS(time),
        gpsToEntranceM: gpsDistanceToEntrance(lastFix, route),
         startGapM: nav.startInfo(bestFix()).offset,
         pathBearingDeg: nav.startInfo(bestFix()).pathBearingDeg,
        remainingM: nav.aligned ? remainingM : route.lengthM,
        toPinM: s.toPinM ?? null,
        offRouteM: nav.aligned && pose.lateralOffsetM != null ? Math.abs(pose.lateralOffsetM) : null,
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
        nextTurnM: nav.aligned ? (poseTurn ? Math.max(0, poseTurn.s - routeS) : null) : null,
        nextTurnDir: nav.aligned && poseTurn ? (poseTurn.angle > 0 ? 'right' : 'left') : null,
        source: route.source,
        snapStartM: route.snapStartM ?? null,
        snapEndM: route.snapEndM ?? null,
        approximate: route.approximate ?? ['direct', 'footpaths'].includes(route.source),
        // ?network=1: the map-constrained pose's confidence (null without it).
        networkConfidence: netTrip?.current.started ? netTrip.current.confidence : null,
        networkFloor: netTrip?.current.started ? netTrip.current.z : null,
        networkArrows: netArrows ? {mode: netArrows.mode, minimap: netArrows.minimap, stop: netArrows.stopKind} : null,
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
    /** ?debug=1: the in-memory trip log (null for normal users). */
    get tripLog() {
      return tripLog
    },
    /** ?debug=1: show the building shell as a see-through wireframe. */
    setWireframe(on) {
      wireOn = Boolean(on)
      nav?.setWireframe(wireOn)
    },
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
      // The compass may not turn a route the user has lined up, or walking has locked on.
      if (phase !== 'ready' || heading == null || !compassMayTurn()) return
      restartWindow()
      compassBias = 0
      nav.realign(recentHeading())
    },
    start,
    tapFloor,
    /** Line-up drag: turn the route about the user by `deg` (> 0 clockwise, as the finger moves right). */
    rotateRoute(deg) {
      if (phase !== 'ready' || !nav?.aligned || !Number.isFinite(deg) || deg === 0) return false
      lineUpTouched = true // from the first drag, the compass no longer turns the route
      return nav.rotateAboutUser(-(deg * Math.PI) / 180)
    },
    /** "Looks right": the route stays as the user lined it up; walking may still correct it. */
    confirmLineUp() {
      if (!lineUp) return
      lineUp = false
      compassLocked = true
      compassOff = true // the arrow and the map follow the camera from here, not the compass
      directionFound()
    },
    /**
     * Back from the background (another app, a call, the screen off): the world the phone tracks
     * may have shifted. Start the floor search and the walked-track match afresh, and open the
     * line-up step so the user can lay the arrows on the path again.
     */
    /** "I'm here": the places near the user to choose from, as GPS points with what they are. */
    reanchorChoices() {
      if (!shellFloor || !nav?.aligned) return []
      const here = nav.worldToRoute({x: camera.position.x, z: camera.position.z})
      return anchorsNear(shellFloor, here, INDOOR.pickRadiusM)
        .slice(0, 12)
        .map((a) => ({...fromLocal(origin, a), kind: a.kind, d: a.d}))
    },
    /** "I'm here" at a chosen door, stair or lift ({lat, lng}). */
    reanchorAt(point) {
      return reanchorAtLocal(toLocal(origin, point))
    },
    /** "I'm on Level n": the user has taken the stair or lift; carry on from its other end. */
    confirmFloor() {
      if (!floorChange || !nav) return false
      const s = floorChange.s + 0.5
      const ok = reanchorAtLocal(pointAt(nav.route, Math.min(s, nav.route.length ? polylineLength(nav.route) : s)))
      floorChange = null
      return ok
    },
    onResume() {
      if (!nav) return
      floor.clear()
      sceneBaseFromCamera = false
      trackingLostAt = null
      matcher = createRouteMatcher(nav.route)
      lastMatchAt = -Infinity
      // Back from the background: the walk lines the arrows up again (dimmed until it does).
      unconfirmedSince = null
      offerRealign = false
    },
    /** The "Re-align" button: open the line-up step again. */
    reopenLineUp() {
      if (phase !== 'ready' || arrived || !nav?.aligned) return false
      offerRealign = false
      unconfirmedSince = null
      lineUp = true
      lineUpTouched = false
      return true
    },
    get lineUp() {
      return lineUp
    },
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
