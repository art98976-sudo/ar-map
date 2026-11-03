import {describe, expect, it} from 'vitest'
import {checkDevice, parseUserAgent} from '../../src/ar/device.js'

const UA = {
  iphone15:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneOld:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  pixel:
    'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_GB;FBAV/400.0]',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

const goodEnv = (userAgent, extra = {}) => ({
  userAgent,
  maxTouchPoints: 5,
  isSecureContext: true,
  hasGetUserMedia: true,
  hasWebGL: true,
  hasDeviceMotion: true,
  ...extra,
})

describe('parseUserAgent', () => {
  it('reads iPhone Safari and the iOS version', () => {
    expect(parseUserAgent(UA.iphone15)).toMatchObject({os: 'ios', osVersion: 18.1, browser: 'safari', mobile: true})
  })
  it('reads Chrome on iPhone', () => {
    expect(parseUserAgent(UA.iphoneChrome)).toMatchObject({os: 'ios', browser: 'chrome'})
  })
  it('treats a touch "Mac" as iPadOS', () => {
    expect(parseUserAgent(UA.ipadOs, {maxTouchPoints: 5})).toMatchObject({os: 'ios', osVersion: 18.1, mobile: true})
    expect(parseUserAgent(UA.ipadOs, {maxTouchPoints: 0})).toMatchObject({os: 'mac', mobile: false})
  })
  it('reads Android Chrome and Samsung Internet', () => {
    expect(parseUserAgent(UA.pixel)).toMatchObject({os: 'android', osVersion: 15, browser: 'chrome'})
    expect(parseUserAgent(UA.samsung)).toMatchObject({os: 'android', browser: 'samsung'})
  })
  it('spots in-app browsers', () => {
    expect(parseUserAgent(UA.iphoneInstagram).inAppBrowser).toBe('Instagram')
    expect(parseUserAgent(UA.androidFacebook).inAppBrowser).toBe('Facebook')
  })
  it('reads desktop Windows', () => {
    expect(parseUserAgent(UA.windowsChrome)).toMatchObject({os: 'windows', mobile: false})
  })
})

describe('checkDevice', () => {
  it('supports an iPhone 15 Pro on Safari', () => {
    const r = checkDevice(goodEnv(UA.iphone15))
    expect(r.status).toBe('supported')
    expect(r.primaryIssue).toBeNull()
    expect(r.checks.every((c) => c.ok)).toBe(true)
  })

  it('supports Android Chrome', () => {
    expect(checkDevice(goodEnv(UA.pixel)).status).toBe('supported')
  })

  it('sends desktop users to their phone', () => {
    const r = checkDevice(goodEnv(UA.windowsChrome, {maxTouchPoints: 0}))
    expect(r.status).toBe('unsupported')
    expect(r.primaryIssue.code).toBe('desktop')
  })

  it('asks Instagram users on iPhone to open Safari', () => {
    const r = checkDevice(goodEnv(UA.iphoneInstagram))
    expect(r.primaryIssue.code).toBe('in-app-browser')
    expect(r.primaryIssue.title).toContain('Safari')
  })

  it('asks Facebook users on Android to open Chrome', () => {
    const r = checkDevice(goodEnv(UA.androidFacebook))
    expect(r.primaryIssue.title).toContain('Chrome')
  })

  it('asks for an update on old iOS', () => {
    const r = checkDevice(goodEnv(UA.iphoneOld))
    expect(r.primaryIssue.code).toBe('old-os')
    expect(r.primaryIssue.body).toContain('14.8')
  })

  it('needs https', () => {
    const r = checkDevice(goodEnv(UA.iphone15, {isSecureContext: false}))
    expect(r.primaryIssue.code).toBe('secure')
  })

  it('needs a camera API', () => {
    expect(checkDevice(goodEnv(UA.pixel, {hasGetUserMedia: false})).primaryIssue.code).toBe('camera')
  })

  it('needs WebGL', () => {
    expect(checkDevice(goodEnv(UA.pixel, {hasWebGL: false})).primaryIssue.code).toBe('graphics')
  })

  it('copes with an empty environment without throwing', () => {
    expect(() => checkDevice({})).not.toThrow()
    expect(checkDevice({}).status).toBe('unsupported')
  })
})
