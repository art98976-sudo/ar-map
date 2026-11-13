import {describe, expect, it, vi} from 'vitest'
import {count, countBody, deviceLabels, newTrip} from '../../src/stats/counts.js'
import {keysFor, storeConfig} from '../../api/_store.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

describe('anonymous counts (8.2)', () => {
  it('labels the phone and browser coarsely', () => {
    expect(deviceLabels(IPHONE, 5)).toEqual({device: 'ios', browser: 'safari'})
    expect(deviceLabels(PIXEL, 5)).toEqual({device: 'android', browser: 'chrome'})
  })

  it('sends only the event name, plus phone and browser for a new trip', () => {
    expect(countBody('trip-started', {device: 'ios', browser: 'safari'})).toEqual({event: 'trip-started', device: 'ios', browser: 'safari'})
    expect(countBody('arrived', {device: 'ios', browser: 'safari'})).toEqual({event: 'arrived'})
    expect(countBody('where-am-i', {})).toBeNull()
  })

  it('counts once-per-trip events once, until the next trip', () => {
    const nav = {userAgent: PIXEL, maxTouchPoints: 5, sendBeacon: vi.fn(() => true)}
    newTrip()
    count('tracking-lost', {onceKey: 'tl', nav, local: false})
    count('tracking-lost', {onceKey: 'tl', nav, local: false})
    expect(nav.sendBeacon).toHaveBeenCalledTimes(1)
    newTrip()
    count('tracking-lost', {onceKey: 'tl', nav, local: false})
    expect(nav.sendBeacon).toHaveBeenCalledTimes(2)
  })

  it('the server counts only known events and labels', () => {
    expect(keysFor({event: 'trip-started', device: 'ios', browser: 'chrome'})).toEqual(['count:trip-started', 'count:device:ios', 'count:browser:chrome'])
    expect(keysFor({event: 'trip-started', device: 'x; DEL *'})).toEqual(['count:trip-started'])
    expect(keysFor({event: 'nope'})).toBeNull()
  })

  it('with no store set up, counting is off', () => {
    expect(storeConfig({})).toBeNull()
    expect(storeConfig({KV_REST_API_URL: 'https://x.upstash.io/', KV_REST_API_TOKEN: 't'})).toEqual({url: 'https://x.upstash.io', token: 't'})
  })
})
