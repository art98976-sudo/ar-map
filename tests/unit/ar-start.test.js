// Alignment Phase 1, step 1 and step 4: when may GPS start an AR trip?
import {describe, expect, it} from 'vitest'
import {gpsStartDecision} from '../../src/route/ar-start.js'
import {AR_START, GPS, MATCH} from '../../src/config.js'

const fix = (accuracy) => ({lat: 56.1452, lng: -3.9201, accuracy})

describe('the AR start limits', () => {
  it('a GPS start is never further off than map matching can correct', () => {
    expect(AR_START.gpsMaxM).toBe(15)
    expect(AR_START.gpsMaxM).toBeLessThanOrEqual(MATCH.maxTotalM)
  })

  it('leaves the self-correction and the map blue dot limits as they were', () => {
    expect(MATCH.maxTotalM).toBe(20)
    expect(MATCH.maxTotalDeg).toBe(75)
    expect(GPS.goodEnoughFixM).toBe(50)
  })
})

describe('gpsStartDecision', () => {
  it('good GPS outdoors starts AR from GPS', () => {
    expect(gpsStartDecision({fix: fix(15), inside: false})).toEqual({action: 'gps', reason: 'good'})
    expect(gpsStartDecision({fix: fix(4), inside: false})).toEqual({action: 'gps', reason: 'good'})
  })

  it('good GPS inside a building goes to the door picker at once', () => {
    expect(gpsStartDecision({fix: fix(8), inside: true})).toEqual({action: 'pick', reason: 'indoors'})
    expect(gpsStartDecision({fix: fix(25), inside: true})).toEqual({action: 'pick', reason: 'indoors'})
  })

  it('a rough fix that lands in a building waits: it may be someone outside by the wall', () => {
    expect(gpsStartDecision({fix: fix(45), inside: true, waitedMs: 1000})).toEqual({action: 'wait', reason: 'indoors'})
    expect(gpsStartDecision({fix: fix(45), inside: true, waitedMs: AR_START.waitForGpsMs})).toEqual({action: 'pick', reason: 'indoors'})
  })

  it('16 to 50 m outdoors is not good enough: wait, then the picker (the old 20 m and 50 m limits)', () => {
    for (const a of [16, 20, 35, 50]) {
      expect(gpsStartDecision({fix: fix(a), inside: false, waitedMs: 2000}).action).toBe('wait')
      expect(gpsStartDecision({fix: fix(a), inside: false, waitedMs: AR_START.waitForGpsMs})).toEqual({action: 'pick', reason: 'weak'})
    }
  })

  it('no fix at all: wait, then the picker', () => {
    expect(gpsStartDecision({fix: null, waitedMs: 500}).action).toBe('wait')
    expect(gpsStartDecision({fix: null, waitedMs: AR_START.waitForGpsMs + 1})).toEqual({action: 'pick', reason: 'no-fix'})
    expect(gpsStartDecision({fix: {accuracy: NaN}, waitedMs: AR_START.waitForGpsMs})).toEqual({action: 'pick', reason: 'no-fix'})
  })

  it('outlines unavailable (MazeMap down): good GPS still starts, and says so', () => {
    expect(gpsStartDecision({fix: fix(10), inside: null})).toEqual({action: 'gps', reason: 'outline-unknown'})
    expect(gpsStartDecision({fix: fix(30), inside: null, waitedMs: AR_START.waitForGpsMs}).action).toBe('pick')
  })
})
