import {describe, expect, it, vi} from 'vitest'
import {
  accuracyLevel,
  createFixGate,
  locationErrorCode,
  locationPermissionState,
  readTripFix,
  saveTripFix,
  watchLocation,
} from '../../src/geo/location.js'
import {locationErrorCopy} from '../../src/ui/screens/locate.js'
import {GPS} from '../../src/config.js'

const pos = (accuracy, lat = 56.1452, lng = -3.9201) => ({coords: {latitude: lat, longitude: lng, accuracy}, timestamp: 1})

function memoryStorage() {
  const map = new Map()
  return {getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v))}
}

describe('accuracyLevel', () => {
  it('grades accuracy against the 20 m limit', () => {
    expect(GPS.goodAccuracyM).toBe(20)
    expect(accuracyLevel(5)).toBe('good')
    expect(accuracyLevel(10)).toBe('good')
    expect(accuracyLevel(18)).toBe('ok')
    expect(accuracyLevel(20)).toBe('ok')
    expect(accuracyLevel(21)).toBe('weak')
    expect(accuracyLevel(NaN)).toBe('weak')
  })
})

describe('locationErrorCode', () => {
  it('maps browser error codes', () => {
    expect(locationErrorCode({code: 1})).toBe('denied')
    expect(locationErrorCode({code: 2})).toBe('unavailable')
    expect(locationErrorCode({code: 3})).toBe('timeout')
    expect(locationErrorCode(null)).toBe('unavailable')
  })
})

describe('createFixGate', () => {
  it('starts searching, waits on weak GPS and is ready at 20 m or better', () => {
    const gate = createFixGate({startedAt: 0})
    expect(gate.check(0).status).toBe('searching')
    expect(gate.update(pos(45), 1000)).toMatchObject({status: 'weak', accuracy: 45, level: 'weak'})
    expect(gate.update(pos(12), 2000)).toMatchObject({status: 'ready', level: 'ok'})
    expect(gate.update(pos(4), 3000).fix).toMatchObject({lat: 56.1452, lng: -3.9201, accuracy: 4})
  })

  it('goes back to waiting if accuracy gets worse again', () => {
    const gate = createFixGate({startedAt: 0})
    gate.update(pos(8), 1000)
    expect(gate.update(pos(60), 2000).status).toBe('weak')
  })

  it('suggests indoors after 30 s without ever getting a good fix', () => {
    const gate = createFixGate({startedAt: 0})
    gate.update(pos(80), 1000)
    expect(gate.check(29_000).indoors).toBe(false)
    expect(gate.check(31_000).indoors).toBe(true)
    // No fix at all for 30 s also counts.
    expect(createFixGate({startedAt: 0}).check(31_000).indoors).toBe(true)
  })

  it('does not suggest indoors once a good fix was seen', () => {
    const gate = createFixGate({startedAt: 0})
    gate.update(pos(9), 1000)
    gate.update(pos(40), 40_000)
    expect(gate.check(41_000).indoors).toBe(false)
  })

  it('ignores broken readings', () => {
    const gate = createFixGate({startedAt: 0})
    expect(gate.update({coords: {latitude: NaN, longitude: 1}}, 1).status).toBe('searching')
    expect(gate.update(null, 1).status).toBe('searching')
  })
})

describe('watchLocation', () => {
  it('asks for high accuracy and stops cleanly', () => {
    const geo = {watchPosition: vi.fn(() => 7), clearWatch: vi.fn()}
    const stop = watchLocation({onFix: vi.fn(), onError: vi.fn()}, geo)
    expect(geo.watchPosition.mock.calls[0][2]).toMatchObject({enableHighAccuracy: true, maximumAge: 0})
    stop()
    expect(geo.clearWatch).toHaveBeenCalledWith(7)
  })

  it('passes fixes and translated errors through', () => {
    const onFix = vi.fn()
    const onError = vi.fn()
    const geo = {
      watchPosition: (ok, fail) => {
        ok(pos(5))
        fail({code: 1})
        return 1
      },
      clearWatch: () => {},
    }
    watchLocation({onFix, onError}, geo)
    expect(onFix).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('denied')
  })

  it('reports unsupported when there is no geolocation API', () => {
    const onError = vi.fn()
    watchLocation({onFix: vi.fn(), onError}, null)
    expect(onError).toHaveBeenCalledWith('unsupported')
  })
})

describe('locationPermissionState', () => {
  it('reads the Permissions API, or says unknown without it', async () => {
    expect(await locationPermissionState({permissions: {query: async () => ({state: 'granted'})}})).toBe('granted')
    expect(await locationPermissionState({})).toBe('unknown')
  })
})

describe('trip fix storage', () => {
  it('saves and reads the starting fix, and rejects broken data', () => {
    const s = memoryStorage()
    expect(readTripFix(s)).toBeNull()
    saveTripFix({lat: 56.1, lng: -3.9, accuracy: 6}, s)
    expect(readTripFix(s)).toMatchObject({lat: 56.1, lng: -3.9})
    s.setItem('welcomeAR.fix.v1', '{broken')
    expect(readTripFix(s)).toBeNull()
  })
})

describe('locationErrorCopy', () => {
  it('gives iPhone steps for a blocked location, and always a next action', () => {
    expect(locationErrorCopy('denied', {os: 'ios'}).steps.join(' ')).toContain('Location Services')
    expect(locationErrorCopy('denied', {os: 'android'}).steps.join(' ')).toContain('Turn on Location')
    for (const code of ['denied', 'unavailable', 'timeout', 'unsupported']) {
      const copy = locationErrorCopy(code)
      expect(copy.title).toBeTruthy()
      expect(copy.primary.action).toBeTruthy()
    }
  })
})
