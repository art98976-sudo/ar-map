// Three small state machines for an AR trip, shared by the AR screen and the ?simulate=1 test mode.
// Pure: they are fed times and readings, and say what to do. Times are seconds.
//
// - createConfidenceMonitor: is the position good enough to draw the AR arrow?
// - createOffRouteMonitor: has the user left the route long enough to plan a new one?
// - createArrivalDetector: has the user reached the destination?
import {angleDiff} from '../geo/geo.js'
import {ARRIVAL, CONFIDENCE, OFF_ROUTE, SAFETY, TRACKING_STATE} from '../config.js'

/**
 * B9: walking fast with the phone pointed at the ground. Feed it every frame:
 *   update({time, speedMps, downY}) -> true while "Look up" should show.
 * downY: how far down the camera looks (0 level, 1 straight down). After SAFETY.headDownForS of
 * fast walking pointed down, the nudge shows for SAFETY.lookUpForS, then not again for
 * SAFETY.headDownCooldownS.
 */
export function createHeadDownMonitor() {
  let since = null
  let showUntil = -Infinity
  let quietUntil = -Infinity
  return {
    update({time, speedMps, downY}) {
      const risky = Number.isFinite(speedMps) && speedMps >= SAFETY.fastMps && downY >= SAFETY.downMinY
      since = risky ? (since ?? time) : null
      if (since != null && time - since >= SAFETY.headDownForS && time >= quietUntil) {
        showUntil = time + SAFETY.lookUpForS
        quietUntil = time + SAFETY.headDownCooldownS
        since = null
      }
      return time < showUntil
    },
  }
}

/**
 * One word for how well the trip knows where the user is, for the screen to act on:
 *   'LOST'  world tracking has been gone longer than TRACKING_STATE.lostAfterS: the arrows are hidden
 *   'WEAK'  tracking just dropped, or the position or heading is unreliable (the confidence monitor)
 *   'GOOD'  everything agrees
 * A webcam in test mode never tracks, so there tracking alone never makes it WEAK or LOST.
 */
export function trackingState({tracking = 'NORMAL', lostForS = 0, positionOk = true, testMode = false} = {}) {
  const trackingOk = testMode || tracking === 'NORMAL'
  if (!trackingOk && lostForS > TRACKING_STATE.lostAfterS) return 'LOST'
  if (!trackingOk || !positionOk) return 'WEAK'
  return 'GOOD'
}

/**
 * Unreliable while GPS is worse than maxGpsAccuracyM, or while the compass swings more than
 * maxHeadingSwingDeg within swingWindowS although the phone itself is not turning.
 *
 * "Not turning" comes from motion tracking: cameraYawDeg is the phone's own rotation (gyro and
 * camera, any fixed zero). A real turn moves compass and camera together, so their difference
 * stays put; a compass upset by steel or a building moves alone, and the difference swings.
 *
 * The arrow goes after unreliableAfterS of bad readings, and comes back after reliableAfterS of
 * good ones, so one bad reading does not make it flicker. GPS also has two thresholds: worse than
 * maxGpsAccuracyM is bad, but once unreliable only recoverGpsAccuracyM or better is good again.
 */
export function createConfidenceMonitor(config = CONFIDENCE) {
  const {maxGpsAccuracyM, maxHeadingSwingDeg, swingWindowS, unreliableAfterS, reliableAfterS} = config
  const recoverGpsAccuracyM = config.recoverGpsAccuracyM ?? maxGpsAccuracyM
  let window = [] // {time, gap}: compass minus camera yaw
  let badSince = null
  let goodSince = null
  let reliable = true
  let reason = null

  /** Spread of the compass-minus-camera gap over the window, in degrees. */
  function swing() {
    if (window.length < 2) return 0
    const ref = window[0].gap
    let lo = 0
    let hi = 0
    for (const {gap} of window) {
      const d = angleDiff(ref, gap)
      lo = Math.min(lo, d)
      hi = Math.max(hi, d)
    }
    return hi - lo
  }

  return {
    /**
     * @param r.time         seconds
     * @param r.gpsAccuracy  metres, or null with no fix; ignored unless r.useGps
     * @param r.heading      compass, degrees; ignored unless r.useCompass
     * @param r.cameraYawDeg the phone's own rotation, degrees clockwise
     * @returns {{reliable, reason: 'gps'|'compass'|null, gpsBad, swingDeg}}
     */
    update({time, gpsAccuracy = null, useGps = true, heading = null, cameraYawDeg = null, useCompass = true}) {
      // Hysteresis: once unreliable, GPS has to be clearly better (recoverGpsAccuracyM) to count as good.
      const gpsLimit = reliable ? maxGpsAccuracyM : recoverGpsAccuracyM
      const gpsBad = useGps && !(Number.isFinite(gpsAccuracy) && gpsAccuracy <= gpsLimit)
      if (useCompass && Number.isFinite(heading) && Number.isFinite(cameraYawDeg)) {
        window.push({time, gap: angleDiff(cameraYawDeg, heading)})
        window = window.filter((s) => time - s.time <= swingWindowS)
      } else {
        window = []
      }
      const swingDeg = swing()
      const compassBad = swingDeg > maxHeadingSwingDeg
      const bad = gpsBad || compassBad
      if (bad) {
        goodSince = null
        badSince ??= time
        if (reliable && time - badSince >= unreliableAfterS) reliable = false
        if (!reliable) reason = gpsBad ? 'gps' : 'compass'
      } else {
        badSince = null
        goodSince ??= time
        if (!reliable && time - goodSince >= reliableAfterS) {
          reliable = true
          reason = null
        }
      }
      return {reliable, reason, gpsBad, swingDeg}
    },
    get reliable() {
      return reliable
    },
    reset() {
      window = []
      badSince = null
      goodSince = null
      reliable = true
      reason = null
    },
  }
}

/**
 * More than offM from the route for forS without a break: plan a new route. At most one new route
 * per minIntervalS. update() is true at the moment a new route should be requested.
 */
export function createOffRouteMonitor({offM, forS, minIntervalS} = OFF_ROUTE) {
  let since = null
  let lastAt = -Infinity
  return {
    update(distanceFromRoute, time) {
      if (!(distanceFromRoute > offM)) {
        since = null
        return false
      }
      since ??= time
      if (time - since < forS || time - lastAt < minIntervalS) return false
      lastAt = time
      since = null
      return true
    },
    /** Seconds until another new route may be requested (0: now). */
    waitS(time) {
      return Math.max(0, lastAt + minIntervalS - time)
    },
    /** How long the user has been off the route so far, in seconds. */
    offForS(time) {
      return since == null ? 0 : time - since
    },
  }
}

/**
 * Arrived: within arriveM of the destination, in a straight line or along what is left of the
 * route, held for forS. update() is true once only.
 */
export function createArrivalDetector({arriveM, forS} = ARRIVAL) {
  let held = 0
  let done = false
  return {
    update(dt, remainingM, toDestinationM = null) {
      if (done) return false
      const close = remainingM <= arriveM || (toDestinationM != null && toDestinationM <= arriveM)
      held = close ? held + dt : 0
      if (held < forS) return false
      done = true
      return true
    },
    get arrived() {
      return done
    },
  }
}
