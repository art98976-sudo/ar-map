// Compass: which way the camera is pointing, in degrees clockwise from north.
//
// iPhone (Safari): 'deviceorientation' with event.webkitCompassHeading (already clockwise
//   from north, for the top edge of the phone) and webkitCompassAccuracy (± degrees, -1 when
//   uncalibrated). It ignores screen rotation, so we add screen.orientation.angle.
// Android (Chrome): 'deviceorientationabsolute' with alpha/beta/gamma relative to north;
//   we compute where the back camera points from the full rotation, so it is correct
//   when the phone is held upright, not only when it lies flat, and in any screen rotation.
//   Flat on its back the camera has no heading, so we use the top edge (360 - alpha).
// Motion permission on iPhone is requested in the tap that starts AR (permissions.js).

const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI
const wrap360 = (a) => ((a % 360) + 360) % 360

/**
 * Heading of the back camera from W3C device orientation angles (degrees).
 * The camera looks along the device's -Z axis; rotate it into the earth frame
 * (x east, y north, z up) with R = Rz(alpha)·Rx(beta)·Ry(gamma) and take its bearing.
 * Returns null when the camera points almost straight up or down (no meaningful heading).
 */
export function cameraHeadingFromOrientation(alpha, beta, gamma) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null
  const a = rad(alpha)
  const b = rad(beta)
  const g = rad(gamma)
  // Third column of R, negated = camera direction in the earth frame.
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g))
  const north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g))
  if (Math.hypot(east, north) < 0.15) return null // looking at the sky or the ground
  return wrap360(deg(Math.atan2(east, north)))
}

/** How far the screen is turned: 0, 90, 180 or 270 degrees. */
export function screenAngle(win = window) {
  const angle = win.screen?.orientation?.angle ?? win.orientation ?? 0
  return Number.isFinite(angle) ? wrap360(angle) : 0
}

/** Heading of the phone's top edge from alpha, corrected for screen rotation. */
export function topEdgeHeading(alpha, angle = 0) {
  return Number.isFinite(alpha) ? wrap360(360 - alpha + angle) : null
}

/** iPhone reports ± degrees, or -1 when uncalibrated. Android reports nothing (null). */
export function isPoorAccuracy(accuracy, maxDeg = 30) {
  return Number.isFinite(accuracy) && (accuracy < 0 || accuracy > maxDeg)
}

/** Mean of angles (degrees), handling the 359° / 1° wrap. */
export function circularMean(angles) {
  if (!angles.length) return null
  let x = 0
  let y = 0
  for (const a of angles) {
    x += Math.cos(rad(a))
    y += Math.sin(rad(a))
  }
  return wrap360(deg(Math.atan2(y, x)))
}

/** Spread of angles as a circular standard deviation in degrees (0 = all identical). */
export function circularSpread(angles) {
  if (angles.length < 2) return 0
  let x = 0
  let y = 0
  for (const a of angles) {
    x += Math.cos(rad(a))
    y += Math.sin(rad(a))
  }
  const r = Math.min(1, Math.hypot(x, y) / angles.length)
  return deg(Math.sqrt(-2 * Math.log(Math.max(r, 1e-9))))
}

/** Smallest signed difference b - a in degrees (-180..180). */
export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180
}

/**
 * Collects readings while the user stands still, then gives one steady heading.
 * add(heading, accuracy, now) -> {status: 'collecting'|'unsteady'|'done', progress 0..1, heading, spread}
 *   unsteady: readings jump around (or iPhone reports poor accuracy) -> ask for a figure-8
 */
export function createCalibrator({durationMs = 3000, maxSpreadDeg = 12, maxAccuracyDeg = 30} = {}) {
  let samples = []
  return {
    add(heading, accuracy = null, now = Date.now()) {
      if (!Number.isFinite(heading)) return {status: 'collecting', progress: 0, heading: null, spread: null}
      samples.push({heading, now})
      // Sliding window: only the newest `durationMs` of readings count.
      samples = samples.filter((s) => now - s.now <= durationMs)
      const angles = samples.map((s) => s.heading)
      const spread = circularSpread(angles)
      const span = now - samples[0].now
      if (spread > maxSpreadDeg || isPoorAccuracy(accuracy, maxAccuracyDeg)) return {status: 'unsteady', progress: 0, heading: null, spread}
      // The window is "full" once readings span (almost) the whole duration.
      const progress = Math.min(1, span / (durationMs * 0.95))
      // Need a full window and enough readings (compass events come at 20-60 Hz).
      if (progress >= 1 && samples.length >= 10) return {status: 'done', progress: 1, heading: circularMean(angles), spread}
      return {status: 'collecting', progress, heading: circularMean(angles), spread}
    },
    reset() {
      samples = []
    },
  }
}

/**
 * Listen to the compass. onReading({heading, accuracy, source}) is called for each event.
 * Returns stop(). onUnavailable() is called if no reading arrives within 3 s.
 */
export function startCompass({onReading, onUnavailable}, win = window) {
  let got = false
  const ios = (e) => {
    if (!Number.isFinite(e.webkitCompassHeading)) return
    got = true
    // iOS reports the direction the back camera faces when the phone is held upright.
    onReading({
      heading: wrap360(e.webkitCompassHeading + screenAngle(win)),
      accuracy: e.webkitCompassAccuracy ?? null,
      source: 'webkitCompassHeading',
      beta: e.beta ?? null,
    })
  }
  const absolute = (e) => {
    const heading = cameraHeadingFromOrientation(e.alpha, e.beta, e.gamma) ?? topEdgeHeading(e.alpha, screenAngle(win))
    if (heading == null) return
    got = true
    onReading({heading, accuracy: null, source: 'alpha', beta: e.beta ?? null})
  }
  // Some Android browsers only send absolute values on the normal event.
  const fallback = (e) => {
    if (Number.isFinite(e.webkitCompassHeading)) return ios(e)
    if (e.absolute === true) absolute(e)
  }

  const hasAbsoluteEvent = 'ondeviceorientationabsolute' in win
  if (hasAbsoluteEvent) win.addEventListener('deviceorientationabsolute', absolute)
  win.addEventListener('deviceorientation', fallback)

  const timer = setTimeout(() => {
    if (!got) onUnavailable?.()
  }, 3000)

  return () => {
    clearTimeout(timer)
    if (hasAbsoluteEvent) win.removeEventListener('deviceorientationabsolute', absolute)
    win.removeEventListener('deviceorientation', fallback)
  }
}
