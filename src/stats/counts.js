// Anonymous counts (8.2): how many trips start, reach AR, line up, arrive or end early, lose
// tracking or re-route, and on which kind of phone and browser. Only these names and two coarse
// labels are sent: no position, destination, id or time. Sent with sendBeacon; failures are silent.
import {parseUserAgent} from '../ar/device.js'

export const EVENTS = ['trip-started', 'ar-started', 'lineup-confirmed', 'arrived', 'ended-early', 'tracking-lost', 'rerouted']

/** The coarse labels: ios | android | other, and safari | chrome | firefox | samsung | other. */
export function deviceLabels(userAgent = '', touchPoints = 0) {
  const device = parseUserAgent(userAgent, {maxTouchPoints: touchPoints})
  const os = device.os === 'ios' || device.os === 'android' ? device.os : 'other'
  const ua = userAgent.toLowerCase()
  const browser = ua.includes('samsungbrowser')
    ? 'samsung'
    : ua.includes('firefox') || ua.includes('fxios')
      ? 'firefox'
      : ua.includes('crios') || (ua.includes('chrome') && !ua.includes('edg'))
        ? 'chrome'
        : ua.includes('safari')
          ? 'safari'
          : 'other'
  return {device: os, browser}
}

/** The body sent for one event. Pure, so what leaves the phone is tested. */
export function countBody(event, labels) {
  if (!EVENTS.includes(event)) return null
  return event === 'trip-started' ? {event, ...labels} : {event}
}

const once = new Set()

// Development and test servers have no /api: nothing is sent from them.
const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname ?? '')

/** Count an event. once: at most once per trip (key), e.g. tracking lost. */
export function count(event, {onceKey = null, nav = globalThis.navigator, local = isLocal()} = {}) {
  if (onceKey) {
    if (once.has(onceKey)) return false
    once.add(onceKey)
  }
  return send(countBody(event, deviceLabels(nav?.userAgent, nav?.maxTouchPoints)), {nav, local})
}

/** Send one body to /api/count with sendBeacon. False when not sent (local, no beacon, a failure). */
export function send(body, {nav = globalThis.navigator, local = isLocal()} = {}) {
  if (!body || !nav?.sendBeacon || local) return false
  try {
    return nav.sendBeacon('/api/count', new Blob([JSON.stringify(body)], {type: 'application/json'}))
  } catch {
    return false
  }
}

/** A new trip: forget the once-per-trip keys. */
export function newTrip() {
  once.clear()
}
