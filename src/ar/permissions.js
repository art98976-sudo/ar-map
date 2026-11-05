// Tapping a destination asks for everything at once: motion, camera and location.
// iPhone asks separately for motion sensors, and only during a tap.
// Call this directly inside a click handler, before any other `await`,
// or Safari silently refuses to show the prompt.
import {watchLocation} from '../geo/location.js'

/** @returns {Promise<'granted'|'denied'|'not-needed'>} */
export function requestMotionPermission(win = window) {
  const motion = win.DeviceMotionEvent
  const orientation = win.DeviceOrientationEvent
  const needsPrompt = typeof motion?.requestPermission === 'function'
  if (!needsPrompt) return Promise.resolve('not-needed')

  // Start both requests synchronously, still inside the tap. iOS shows one prompt.
  const requests = [motion.requestPermission()]
  if (typeof orientation?.requestPermission === 'function') requests.push(orientation.requestPermission())

  return Promise.all(requests)
    .then((results) => (results.every((r) => r === 'granted') ? 'granted' : 'denied'))
    .catch(() => 'denied')
}

/**
 * Ask for the camera, then release it at once: the AR engine opens it again later.
 * Only a clear "no" counts as denied. Other failures are left for the engine to report.
 * @returns {Promise<'granted'|'denied'|'unknown'>}
 */
export async function requestCameraPermission(nav = navigator) {
  if (!nav.mediaDevices?.getUserMedia) return 'unknown'
  try {
    const stream = await nav.mediaDevices.getUserMedia({video: {facingMode: 'environment'}})
    stream.getTracks().forEach((track) => track.stop())
    return 'granted'
  } catch (err) {
    return err?.name === 'NotAllowedError' ? 'denied' : 'unknown'
  }
}

// iPhone forgets the motion answer on reload, so this lives in memory on purpose: a reload
// needs a new tap, and a second trip in the same page load needs none.
let allowed = false
export const permissionsAllowed = () => allowed
export function markPermissionsAllowed(value = true) {
  allowed = value
}

const CAMERA_ANSWER_MS = 15_000
let pending = null

/**
 * A GPS watch that starts in the tap and is handed to the location screen later, keeping what
 * has arrived so far. A second watch could wait a long time for a phone standing still.
 */
function startSharedWatch() {
  let fix = null
  let error = null
  let sink = null
  const stop = watchLocation({
    onFix: (position) => {
      fix = position
      error = null
      sink?.onFix(position)
    },
    onError: (code) => {
      error = code
      sink?.onError(code)
    },
  })
  return {
    stop,
    listen(next) {
      sink = next
      if (error) next.onError(error)
      else if (fix) next.onFix(fix)
    },
  }
}

/**
 * The one tap. Call first thing in a click handler, before any `await`: all three requests
 * start here, synchronously, so iPhone shows its prompts. Returns what settlePermissions needs.
 */
export function startPermissionRequests() {
  const motion = requestMotionPermission()
  const camera = requestCameraPermission()
  const gps = startSharedWatch()
  motion.then((answer) => {
    if (answer !== 'denied') markPermissionsAllowed()
  })
  pending = {motion, camera, gps}
  return pending
}

/** The requests made by the last tap, for the next screen. Hands them over only once. */
export function takePendingPermissions() {
  const taken = pending
  pending = null
  return taken
}

/**
 * Wait for the answers. The engine asks for the camera again anyway, so a camera prompt that
 * never settles (a phone refusing overlapping prompts) must not hold up the trip.
 */
export async function settlePermissions({motion, camera}, waitMs = CAMERA_ANSWER_MS) {
  let timer
  const giveUp = new Promise((resolve) => {
    timer = setTimeout(() => resolve('unknown'), waitMs)
  })
  const answer = {motion: await motion, camera: await Promise.race([camera, giveUp])}
  clearTimeout(timer)
  return answer
}
