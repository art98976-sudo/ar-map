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

describe('result icons (7.2)', async () => {
  const {iconFor} = await import('../../src/ui/icons.js')
  it('each kind of place has its own icon', () => {
    const kinds = ['library', 'academic', 'services', 'sport', 'landmark', 'living', 'food', 'bus', 'town', 'parking']
    const icons = kinds.map((category) => iconFor({category}))
    expect(new Set(icons).size).toBe(kinds.length)
  })
  it('rooms say what they are', () => {
    expect(iconFor({category: 'room', name: 'Lecture Theatre A4'})).toBe('lecture')
    expect(iconFor({category: 'room', name: 'Accessible toilet'})).toBe('toilet')
    expect(iconFor({category: 'room', name: 'Lift 2'})).toBe('lift')
    expect(iconFor({category: 'room', name: '2B87'})).toBe('door')
  })
})

describe('test modes (9.1, 9.3)', async () => {
  const {simBanner} = await import('../../src/map/simulate.js')
  const {rowFrom, FIELD_COLUMNS} = await import('../../src/ui/screens/ar-fieldtest.js')
  it('?simulate=1: tracking lost and a floor change show as in AR, most urgent first', () => {
    expect(simBanner({trackingLost: true, uncertain: true, name: 'X'}).text).toBe('Tracking lost. Move slowly')
    expect(simBanner({floorTo: 2, rerouting: true, name: 'X'}).text).toBe('Go to Level 2')
    expect(simBanner({arrived: true, trackingLost: true, name: 'X'}).text).toBe('You’ve arrived · X')
  })
  it('?fieldtest=1 logs the debug readings too', () => {
    const row = rowFrom({heading: 90, trackedHeadingDeg: 84, headingGapDeg: -6, locked: true, matchResidualM: 0.84, lateralOffsetM: -1.234, fps: 29.6}, {at: 1000, startedAt: 0})
    expect(row).toMatchObject({tracked_heading_deg: 84, heading_gap_deg: -6, match_locked: true, match_residual_m: 0.84, lateral_offset_m: -1.23, fps: 30})
    for (const c of ['tracked_heading_deg', 'heading_gap_deg', 'match_residual_m', 'lateral_offset_m', 'fps']) expect(FIELD_COLUMNS).toContain(c)
  })
})
