import {describe, expect, it} from 'vitest'
import {ARRIVAL, CONFIDENCE, OFF_ROUTE, TRACKING_STATE} from '../../src/config.js'
import {createArrivalDetector, createConfidenceMonitor, createOffRouteMonitor, trackingState} from '../../src/route/trip-monitors.js'

const STEP = 0.1 // ten readings a second
/** Feed a monitor readings from `from` to `to` seconds; returns the last result. */
function run(monitor, from, to, reading) {
  let r = null
  for (let t = from; t < to - 1e-9; t += STEP) r = monitor.update({time: Number(t.toFixed(3)), ...reading(t)})
  return r
}
const goodGps = {gpsAccuracy: 6, useGps: true}

describe('settings', () => {
  it('keeps the tunable numbers in one place', () => {
    expect(CONFIDENCE).toMatchObject({maxGpsAccuracyM: 20, maxHeadingSwingDeg: 40, swingWindowS: 2, unreliableAfterS: 3, reliableAfterS: 3})
    expect(OFF_ROUTE).toEqual({offM: 15, forS: 5, minIntervalS: 15})
    expect(ARRIVAL).toEqual({arriveM: 8, forS: 1})
  })
})

describe('confidence: GPS', () => {
  it('stays reliable with GPS within 20 m', () => {
    const m = createConfidenceMonitor()
    expect(run(m, 0, 10, () => ({gpsAccuracy: 20}))).toMatchObject({reliable: true, gpsBad: false})
  })

  it('becomes unreliable only after 3 s of GPS worse than 20 m, then recovers after 3 s of good GPS', () => {
    const m = createConfidenceMonitor()
    expect(run(m, 0, 2.9, () => ({gpsAccuracy: 35}))).toMatchObject({reliable: true, gpsBad: true})
    expect(run(m, 2.9, 3.2, () => ({gpsAccuracy: 35}))).toMatchObject({reliable: false, reason: 'gps'})
    expect(run(m, 3.2, 6.1, () => ({gpsAccuracy: 8}))).toMatchObject({reliable: false}) // 2.9 s of good
    expect(run(m, 6.1, 6.4, () => ({gpsAccuracy: 8}))).toMatchObject({reliable: true, reason: null})
  })

  it('one bad moment starts the count again', () => {
    const m = createConfidenceMonitor()
    run(m, 0, 2.5, () => ({gpsAccuracy: 40}))
    run(m, 2.5, 2.7, () => ({gpsAccuracy: 5}))
    expect(run(m, 2.7, 5.5, () => ({gpsAccuracy: 40})).reliable).toBe(true) // 2.8 s since the good moment
  })

  it('no fix at all counts as bad, but GPS is ignored when the trip does not use it', () => {
    expect(run(createConfidenceMonitor(), 0, 4, () => ({gpsAccuracy: null})).reliable).toBe(false)
    expect(run(createConfidenceMonitor(), 0, 10, () => ({gpsAccuracy: 80, useGps: false})).reliable).toBe(true)
  })
})

describe('confidence: compass', () => {
  it('a compass swinging 60° while the phone holds still is unreliable after 3 s', () => {
    const m = createConfidenceMonitor()
    const swinging = (t) => ({...goodGps, heading: 90 + 30 * Math.sin(t * 3), cameraYawDeg: 10})
    // ±30° passes 40° of spread at about 1.2 s; 3 s later the arrow goes.
    expect(run(m, 0, 4, swinging).reliable).toBe(true)
    const r = run(m, 4, 4.5, swinging)
    expect(r).toMatchObject({reliable: false, reason: 'compass'})
    expect(r.swingDeg).toBeGreaterThan(40)
  })

  it('a real turn, compass and phone together, is not a swing', () => {
    const m = createConfidenceMonitor()
    // Turning 180° in 1.5 s, then holding: compass and camera move by the same amount.
    const turning = (t) => {
      const yaw = Math.min(180, t * 120)
      return {...goodGps, heading: (350 + yaw) % 360, cameraYawDeg: yaw - 75}
    }
    const r = run(m, 0, 8, turning)
    expect(r.reliable).toBe(true)
    expect(r.swingDeg).toBeLessThan(1)
  })

  it('a steady compass error is fine; only a change within 2 s counts', () => {
    const m = createConfidenceMonitor()
    // Compass 35° out but steady, plus 2° of noise.
    expect(run(m, 0, 10, (t) => ({...goodGps, heading: 35 + 2 * Math.sin(t * 7), cameraYawDeg: 0})).reliable).toBe(true)
    // A slow 30° drift over 20 s is never 40° within 2 s.
    expect(run(createConfidenceMonitor(), 0, 20, (t) => ({...goodGps, heading: t * 1.5, cameraYawDeg: 0})).reliable).toBe(true)
  })

  it('handles the swing across north (350° to 20°)', () => {
    const m = createConfidenceMonitor()
    const r = run(m, 0, 4, (t) => ({...goodGps, heading: (360 + 5 + 25 * Math.sign(Math.sin(t * 6))) % 360, cameraYawDeg: 0}))
    expect(r.swingDeg).toBeCloseTo(50, 0)
    expect(r.reliable).toBe(false)
  })

  it('ignores the compass when the trip does not steer by it, or there is none', () => {
    const swinging = (t) => ({...goodGps, heading: 90 + 40 * Math.sin(t * 3), cameraYawDeg: 0})
    expect(run(createConfidenceMonitor(), 0, 10, (t) => ({...swinging(t), useCompass: false})).reliable).toBe(true)
    expect(run(createConfidenceMonitor(), 0, 10, () => ({...goodGps, heading: null, cameraYawDeg: 0})).reliable).toBe(true)
  })

  it('takes its numbers from the config', () => {
    const strict = createConfidenceMonitor({...CONFIDENCE, maxHeadingSwingDeg: 10, unreliableAfterS: 1})
    expect(run(strict, 0, 2, (t) => ({...goodGps, heading: 8 * Math.sin(t * 6), cameraYawDeg: 0})).reliable).toBe(false)
  })
})

describe('off route', () => {
  it('more than 15 m off for 5 s in a row asks for a new route, once', () => {
    const monitor = createOffRouteMonitor()
    const fired = []
    for (let t = 0; t <= 12; t += 0.25) if (monitor.update(20, t)) fired.push(t)
    expect(fired).toEqual([5])
  })

  it('coming back within 15 m starts the count again', () => {
    const monitor = createOffRouteMonitor()
    for (let t = 0; t < 4; t += 0.25) expect(monitor.update(20, t)).toBe(false)
    expect(monitor.update(14, 4)).toBe(false)
    for (let t = 4.25; t < 9.25; t += 0.25) expect(monitor.update(20, t)).toBe(false)
    expect(monitor.update(20, 9.25)).toBe(true)
  })

  it('exactly 15 m is not off the route', () => {
    const monitor = createOffRouteMonitor()
    for (let t = 0; t < 30; t += 0.5) expect(monitor.update(15, t)).toBe(false)
  })

  it('never asks more than once every 15 s', () => {
    const monitor = createOffRouteMonitor()
    const fired = []
    for (let t = 0; t <= 60; t += 0.25) if (monitor.update(30, t)) fired.push(t)
    expect(fired).toEqual([5, 20, 35, 50])
    expect(monitor.waitS(51)).toBe(14)
    expect(monitor.offForS(52)).toBeCloseTo(1.75, 6) // counting again since 50.25
  })

  it('ignores a position it does not know', () => {
    const monitor = createOffRouteMonitor()
    for (let t = 0; t < 10; t += 0.5) expect(monitor.update(null, t)).toBe(false)
  })
})

describe('arrival', () => {
  it('triggers once, within 8 m along the route, held for a second', () => {
    const arrival = createArrivalDetector()
    const fired = []
    for (let i = 0; i < 100; i++) if (arrival.update(0.1, Math.max(0, 60 - i), 100)) fired.push(i)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toBeGreaterThanOrEqual(52) // 8 m to go at i = 52, then held for a second
    expect(arrival.arrived).toBe(true)
  })

  it('triggers within 8 m in a straight line, whatever the route says is left', () => {
    const arrival = createArrivalDetector()
    let fired = 0
    for (let i = 0; i < 40; i++) if (arrival.update(0.1, 50, 7.9)) fired += 1
    expect(fired).toBe(1)
  })

  it('does not trigger on a moment passing close by, or at 8.1 m', () => {
    const arrival = createArrivalDetector()
    for (let i = 0; i < 5; i++) expect(arrival.update(0.1, 5, 100)).toBe(false)
    for (let i = 0; i < 100; i++) expect(arrival.update(0.1, 30, 8.1)).toBe(false)
  })
})

describe('GOOD / WEAK / LOST', () => {
  it('is GOOD when tracking is normal and the position is reliable', () => {
    expect(trackingState({tracking: 'NORMAL', positionOk: true})).toBe('GOOD')
  })
  it('is WEAK when the position is unreliable, or tracking has only just dropped', () => {
    expect(trackingState({tracking: 'NORMAL', positionOk: false})).toBe('WEAK')
    expect(trackingState({tracking: 'LIMITED', lostForS: TRACKING_STATE.lostAfterS - 0.5})).toBe('WEAK')
  })
  it('is LOST once tracking has been gone longer than lostAfterS', () => {
    expect(trackingState({tracking: 'LIMITED', lostForS: TRACKING_STATE.lostAfterS + 0.5})).toBe('LOST')
  })
  it('a webcam in test mode is never WEAK or LOST for tracking alone', () => {
    expect(trackingState({tracking: 'LIMITED', lostForS: 60, testMode: true})).toBe('GOOD')
    expect(trackingState({tracking: 'LIMITED', lostForS: 60, testMode: true, positionOk: false})).toBe('WEAK')
  })
})
