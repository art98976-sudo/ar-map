// iPhone asks separately for motion sensors, and only during a tap.
// Call this directly inside a click handler, before any other `await`,
// or Safari silently refuses to show the prompt.

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
