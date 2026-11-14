import {describe, expect, it, vi} from 'vitest'
import {locateForGo, noLocationReason} from '../../src/route/go-start.js'

const base = {fix: null, hasGeolocation: true, permission: 'prompt', trouble: false, timeoutMs: 1000}
const fix = {lat: 56.145, lng: -3.92, accuracy: 12}

describe('noLocationReason', () => {
  it('names why no fix can come', () => {
    expect(noLocationReason({hasGeolocation: false, permission: 'granted', trouble: false})).toBe('unsupported')
    expect(noLocationReason({hasGeolocation: true, permission: 'denied', trouble: false})).toBe('denied')
    expect(noLocationReason({hasGeolocation: true, permission: 'granted', trouble: true})).toBe('trouble')
  })
  it('is null when a fix may still come', () => {
    expect(noLocationReason({hasGeolocation: true, permission: 'prompt', trouble: false})).toBeNull()
    expect(noLocationReason({hasGeolocation: true, permission: 'unknown', trouble: false})).toBeNull()
  })
})

describe('locateForGo', () => {
  it('uses the fix it already has, without asking again', async () => {
    const current = vi.fn()
    expect(await locateForGo({...base, fix, current})).toEqual({fix})
    expect(current).not.toHaveBeenCalled()
  })

  it('does not wait when location is blocked or missing', async () => {
    const current = vi.fn()
    expect(await locateForGo({...base, permission: 'denied', current})).toEqual({reason: 'denied'})
    expect(await locateForGo({...base, hasGeolocation: false, current})).toEqual({reason: 'unsupported'})
    expect(current).not.toHaveBeenCalled()
  })

  it('waits for a fix that arrives in time', async () => {
    expect(await locateForGo({...base, current: () => Promise.resolve(fix)})).toEqual({fix})
  })

  it('passes on the error code when the prompt is refused', async () => {
    expect(await locateForGo({...base, current: () => Promise.reject('denied')})).toEqual({reason: 'denied'})
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    const result = locateForGo({...base, current: () => new Promise(() => {})})
    vi.advanceTimersByTime(1000)
    expect(await result).toEqual({reason: 'timeout'})
    vi.useRealTimers()
  })
})
