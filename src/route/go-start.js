// "Go" from "my location": use the fix we have, wait a little for one, or say why there is none,
// so the home screen can ask where the walk starts instead of showing a route error.

export const NO_LOCATION_TEXT = 'We can’t see your location. Choose where you’re starting from.'

/**
 * Why no fix can come right now, or null when it is worth waiting for one. Pure.
 * 'unsupported': no geolocation in this browser; 'denied': blocked; 'trouble': the last try failed.
 */
export function noLocationReason({hasGeolocation, permission, trouble}) {
  if (!hasGeolocation) return 'unsupported'
  if (permission === 'denied') return 'denied'
  if (trouble) return 'trouble'
  return null
}

/**
 * The start for Go: {fix} or {reason}. Waits at most timeoutMs for current(), which resolves
 * with a fix or rejects with a location error code ('denied', 'unavailable', 'timeout', ...).
 */
export async function locateForGo({fix, current, hasGeolocation, permission, trouble, timeoutMs, timers = globalThis}) {
  if (fix) return {fix}
  const reason = noLocationReason({hasGeolocation, permission, trouble})
  if (reason) return {reason}
  let timer = null
  try {
    const got = await Promise.race([
      current(),
      new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject('timeout'), timeoutMs)
      }),
    ])
    return got ? {fix: got} : {reason: 'unavailable'}
  } catch (code) {
    return {reason: typeof code === 'string' ? code : 'unavailable'}
  } finally {
    if (timer != null) timers.clearTimeout(timer)
  }
}
