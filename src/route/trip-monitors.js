// Three small state machines for an AR trip, shared by the AR screen and the ?simulate=1 test mode.
// Pure: they are fed times and readings, and say what to do. Times are seconds.
//
// - createConfidenceMonitor: is the position good enough to draw the AR arrow?
// - createOffRouteMonitor: has the user left the route long enough to plan a new one?
// - createArrivalDetector: has the user reached the destination?
import {angleDiff} from '../geo/geo.js'
import {ARRIVAL, CONFIDENCE, OFF_ROUTE} from '../config.js'

/**
 * Unreliable while GPS is worse than maxGpsAccuracyM, or while the compass swings more than
 * maxHeadingSwingDeg within swingWindowS although the phone itself is not turning.
 *
 * "Not turning" comes from motion tracking: cameraYawDeg is the phone's own rotation (gyro and
 * camera, any fixed zero). A real turn moves compass and camera together, so their difference
 * stays put; a compass upset by steel or a building moves alone, and the difference swings.
 *
 * The arrow goes after unreliableAfterS of bad readings, and comes back after reliableAfterS of
 * good ones, so one bad reading does not make it flicker.
 */
export function createConfidenceMonitor(config = CONFIDENCE) {
  const {maxGpsAccuracyM, maxHeadingSwingDeg, swingWindowS, unreliableAfterS, reliableAfterS} = config
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
      const gpsBad = useGps && !(Number.isFinite(gpsAccuracy) && gpsAccuracy <= maxGpsAccuracyM)
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
