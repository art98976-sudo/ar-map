import {describe, expect, it} from 'vitest'
import {GUIDE_LINES, markSeen, seen} from '../../src/ui/first-use.js'
import {markerName} from '../../src/route/card-text.js'
import {errorCopy} from '../../src/ui/screens/ar-errors.js'

const memory = () => {
  const m = new Map()
  return {getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}
}

describe('first-time guide (6.2)', () => {
  it('shows once per device', () => {
    const storage = memory()
    expect(seen('guide', storage)).toBe(false)
    markSeen('guide', storage)
    expect(seen('guide', storage)).toBe(true)
    expect(seen('tilt', storage)).toBe(false) // each thing on its own
  })

  it('blocked storage counts as seen: never nag', () => {
    const broken = {getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }}
    expect(seen('guide', broken)).toBe(true)
    expect(() => markSeen('guide', broken)).not.toThrow()
  })

  it('has three lines: camera, location, motion, in that order', () => {
    expect(GUIDE_LINES.map((l) => l.icon)).toEqual(['camera', 'pin', 'compass'])
    expect(GUIDE_LINES[0].text).toBe('We use your camera to show arrows')
  })

  it('a refusal names the permission and says how to turn it on', () => {
    for (const code of ['camera-denied', 'motion-denied']) {
      for (const os of ['ios', 'android']) {
        const copy = errorCopy(code, {os})
        expect(copy.title).toMatch(code.startsWith('camera') ? /Camera/ : /Motion/)
        expect(copy.steps.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('entrance marker (6.4)', () => {
  const places = [{id: 'cottrell', name: 'Cottrell Building', building: 'Cottrell Building', entrance: {lat: 56.1453, lng: -3.9203}}]
  it('a room names the entrance it ends at', () => {
    const room = {category: 'room', name: 'A3', building: 'Cottrell Building'}
    expect(markerName(room, {lat: 56.1453, lng: -3.9203}, places)).toBe('Cottrell main entrance')
  })
  it('with indoor AR on, or for a building, the place itself', () => {
    expect(markerName({category: 'room', name: 'A3', building: 'Cottrell Building'}, null, places, true)).toBe('A3')
    expect(markerName({category: 'library', name: 'Library'}, null, places)).toBe('Library')
  })
})
