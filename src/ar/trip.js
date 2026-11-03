// One AR trip: find the ground, calibrate the compass, then show the route.
//
// Phases (reported through onPhase):
//   'ground'      wait until 8th Wall tracks the world in real metres (tracking NORMAL and
//                 a believable camera height above the ground)
//   'compass'     hold the phone upright and still for 3 s; readings are averaged
//                 detail: {progress 0..1, issue: null | 'unsteady' | 'tilt'}
//   'ready'       route placed: arrows and pin visible
//   'no-compass'  this phone gives no compass readings
import {createCalibrator, startCompass} from './compass.js'
import {createNavScene, gpsDistanceToEntrance} from './nav-scene.js'
import {GPS, watchLocation} from '../geo/location.js'

const MIN_CAMERA_HEIGHT_M = 0.4 // phone held at least this high = ground found
const UPRIGHT_MAX_TILT = 0.55 // |forward.y|: about 33° up or down from level

export function createArTrip({route, origin, destination, allowDesktop = false, onPhase, onStats}) {
  let phase = null
  let nav = null
  let camera = null
  let THREE = null
  let tracking = 'LIMITED'
  let groundSince = null
  let heading = null
  let headingAccuracy = null
  let compassSource = null
  let lastFix = null
  let fps = null
  let statsTimer = 0
  const calibrator = createCalibrator()

  function setPhase(next, detail = {}) {
    if (phase === next && next !== 'compass') return
    phase = next
    onPhase?.(next, detail)
  }

  // ---------- sensors ----------
  const stopCompass = startCompass({
    onReading: ({heading: h, accuracy, source}) => {
      heading = h
      headingAccuracy = accuracy
      compassSource = source
      if (phase === 'compass') feedCalibration(h, accuracy)
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

  function upright() {
    if (!camera || !THREE) return false
    const f = camera.getWorldDirection(new THREE.Vector3())
    return Math.abs(f.y) <= UPRIGHT_MAX_TILT
  }

  function feedCalibration(h, accuracy) {
    if (!upright()) {
      calibrator.reset()
      return setPhase('compass', {progress: 0, issue: 'tilt'})
    }
    const r = calibrator.add(h, accuracy)
    if (r.status === 'unsteady') return setPhase('compass', {progress: 0, issue: 'unsteady'})
    if (r.status === 'done') return place(r.heading)
    setPhase('compass', {progress: r.progress, issue: null})
  }

  function place(h) {
    // Use the freshest good GPS fix for "where am I standing"; else the trip start.
    const fix = lastFix && lastFix.accuracy <= GPS.goodAccuracyM ? lastFix : origin
    nav.align(h, fix)
    setPhase('ready', {heading: h})
  }

  // ---------- engine hooks ----------
  function onSceneReady({scene, camera: cam}) {
    THREE = window.THREE
    camera = cam
    nav = createNavScene({THREE, scene, camera, route, origin, name: destination.name})
    setPhase('ground')
  }

  function onTracking({status}) {
    tracking = status
  }

  function onTick({dt, time}) {
    if (!nav) return
    if (phase === 'ground') {
      const height = camera.position.y
      const ok = tracking === 'NORMAL' && height >= MIN_CAMERA_HEIGHT_M
      // Desktop test mode: a webcam on a desk never reports a height, so wait 2 s instead.
      if (ok || allowDesktop) groundSince ??= time
      else groundSince = null
      if (groundSince != null && time - groundSince > (allowDesktop ? 2 : 0.5)) {
        calibrator.reset()
        setPhase('compass', {progress: 0, issue: null})
      }
    }
    // No compass at all: real phones get the 'no-compass' message (set above); desktop test
    // mode faces north so the arrows can still be checked on a laptop.
    if (phase === 'compass' && compassSource === 'none') {
      if (allowDesktop) place(0)
      else setPhase('no-compass')
    }
    const s = nav.update(dt, time)
    statsTimer += dt
    if (statsTimer >= 0.25) {
      statsTimer = 0
      onStats?.({
        phase,
        tracking,
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
    /** Redo the compass step (e.g. if the arrows point the wrong way). */
    recalibrate() {
      if (!nav) return
      calibrator.reset()
      setPhase('compass', {progress: 0, issue: null})
    },
    stop() {
      stopCompass()
      stopGps()
      nav?.dispose()
      nav = null
    },
  }
}
