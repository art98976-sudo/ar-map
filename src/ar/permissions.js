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
