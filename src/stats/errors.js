// Anonymous error counts: which kind of failure happened, sent like the trip counts (counts.js).
// Only a kind from the list below leaves the phone: never the message, stack, file, page, place,
// position, route or any id. Each kind is sent at most once per page load.
import {send} from './counts.js'

export const ERROR_KINDS = ['js', 'promise', 'webgl-lost', 'camera', 'motion', 'location', 'engine-load', 'ar-stopped']

/** The body sent for one kind, or null for a kind we do not count. Pure. */
export function errorBody(kind) {
  return ERROR_KINDS.includes(kind) ? {event: 'error', kind} : null
}

/** The kind for an AR screen error code (ar-errors.js), or null when it is not a failure to count. Pure. */
export function arErrorKind(code) {
  if (code === 'camera-denied' || code === 'camera-missing' || code === 'camera-failed') return 'camera'
  if (code === 'motion-denied') return 'motion'
  if (code === 'runtime') return 'ar-stopped'
  if (code === 'webgl-lost') return 'webgl-lost'
  if (code === 'offline' || code === 'timeout') return null // the connection, not the app
  return 'engine-load'
}

/** The kind for a location error code (locate-errors.js), or null. Pure. */
export function locationErrorKind(code) {
  return ['denied', 'unavailable', 'timeout', 'unsupported'].includes(code) ? 'location' : null
}

const sent = new Set()

/** Count one failure of this kind, once per page load. */
export function reportError(kind, {nav, local, seen = sent} = {}) {
  const body = errorBody(kind)
  if (!body || seen.has(kind)) return false
  seen.add(kind)
  return send(body, {nav, local})
}

/**
 * Count uncaught errors and rejections from this site's own code. Errors from other origins
 * (extensions, MazeMap's scripts) say nothing about this app and are left out.
 */
export function watchGlobalErrors(win = globalThis.window, report = reportError) {
  const origin = win.location?.origin ?? ''
  const onError = (event) => {
    if (event.filename && !event.filename.startsWith(origin)) return
    report('js')
  }
  const onRejection = () => report('promise')
  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)
  return () => {
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
  }
}
