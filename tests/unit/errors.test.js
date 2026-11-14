import {describe, expect, it, vi} from 'vitest'
import {arErrorKind, ERROR_KINDS, errorBody, locationErrorKind, reportError, watchGlobalErrors} from '../../src/stats/errors.js'
import {ERROR_KINDS as SERVER_KINDS, keysFor} from '../../api/_store.js'

const beaconNav = () => ({sendBeacon: vi.fn(() => true)})
/** What the beacon sent, parsed. */
async function sentBody(nav, call = 0) {
  return JSON.parse(await nav.sendBeacon.mock.calls[call][1].text())
}

describe('anonymous error counts', () => {
  it('sends the kind and nothing else', () => {
    expect(errorBody('camera')).toEqual({event: 'error', kind: 'camera'})
    expect(errorBody('TypeError: x is undefined at /route?to=library')).toBeNull()
  })

  it('maps screen error codes to kinds, skipping connection problems', () => {
    expect(arErrorKind('camera-denied')).toBe('camera')
    expect(arErrorKind('camera-missing')).toBe('camera')
    expect(arErrorKind('motion-denied')).toBe('motion')
    expect(arErrorKind('load-failed')).toBe('engine-load')
    expect(arErrorKind('runtime')).toBe('ar-stopped')
    expect(arErrorKind('offline')).toBeNull()
    expect(locationErrorKind('denied')).toBe('location')
    expect(locationErrorKind('no-route')).toBeNull()
  })

  it('sends each kind once per page load, as {event, kind} only', async () => {
    const nav = beaconNav()
    const seen = new Set()
    reportError('camera', {nav, local: false, seen})
    reportError('camera', {nav, local: false, seen})
    reportError('location', {nav, local: false, seen})
    expect(nav.sendBeacon).toHaveBeenCalledTimes(2)
    expect(nav.sendBeacon.mock.calls[0][0]).toBe('/api/count')
    expect(await sentBody(nav)).toEqual({event: 'error', kind: 'camera'})
  })

  it('sends nothing from a development server', () => {
    const nav = beaconNav()
    expect(reportError('js', {nav, local: true, seen: new Set()})).toBe(false)
    expect(nav.sendBeacon).not.toHaveBeenCalled()
  })

  it('counts uncaught errors from this site only, and rejections', () => {
    const win = new EventTarget()
    win.location = {origin: 'https://stirling-welcome-ar.vercel.app'}
    const report = vi.fn()
    const stop = watchGlobalErrors(win, report)
    const error = (filename) => Object.assign(new Event('error'), {filename})
    win.dispatchEvent(error('chrome-extension://abc/content.js'))
    win.dispatchEvent(error('https://api.mazemap.com/js/v2.2.6/mazemap.min.js'))
    expect(report).not.toHaveBeenCalled()
    win.dispatchEvent(error('https://stirling-welcome-ar.vercel.app/assets/index.js'))
    win.dispatchEvent(new Event('unhandledrejection'))
    expect(report.mock.calls).toEqual([['js'], ['promise']])
    stop()
    win.dispatchEvent(new Event('unhandledrejection'))
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('the server takes the same kinds, and nothing else', () => {
    expect(SERVER_KINDS).toEqual(ERROR_KINDS)
    expect(keysFor({event: 'error', kind: 'webgl-lost'})).toEqual(['count:error:webgl-lost'])
    expect(keysFor({event: 'error', kind: 'x; DEL *'})).toBeNull()
    expect(keysFor({event: 'error'})).toBeNull()
  })
})
