import {describe, expect, it} from 'vitest'
import {sheetHeights, snapHeight} from '../../src/ui/components/home-sheet.js'
import {QUICK_CHIPS} from '../../src/map/filters.js'
import {formatAway, pinPlaces, roomTypeDestinations, toRows} from '../../src/map/quick-places.js'
import types from '../../public/data/room-types.json'

const H = sheetHeights(844, 108) // a 390 x 844 phone

describe('bottom sheet heights', () => {
  it('peek, half and full', () => {
    expect(H).toEqual({peek: 108, half: 422, full: 756})
  })

  it('a short flick moves one height; a tiny drag stays put', () => {
    expect(snapHeight(H, 'peek', 60)).toBe('half')
    expect(snapHeight(H, 'half', 60)).toBe('full')
    expect(snapHeight(H, 'half', -60)).toBe('peek')
    expect(snapHeight(H, 'full', 80)).toBe('full')
    expect(snapHeight(H, 'peek', -80)).toBe('peek')
    expect(snapHeight(H, 'half', 20)).toBe('half')
  })

  it('a long drag goes to where it ends', () => {
    expect(snapHeight(H, 'peek', 640)).toBe('full')
    expect(snapHeight(H, 'full', -640)).toBe('peek')
  })
})

describe('quick chips', () => {
  it('the six asked for come first, then the older three', () => {
    expect(QUICK_CHIPS.map((c) => c.label)).toEqual(['Lecture theatres', 'Toilets', 'Food', 'Library', 'Study spaces', 'Lifts', 'Buildings', 'Bus', 'Sport'])
  })

  it('toilets and lifts come from the campus model, as places the card understands', () => {
    expect(types.toilet.length).toBeGreaterThan(100)
    expect(types.lift.length).toBeGreaterThan(20)
    const [toilet] = roomTypeDestinations(types.toilet)
    expect(toilet).toMatchObject({category: 'room', source: 'mazemap'})
    expect(toilet.id).toBe(`mm-${toilet.mazemapPoi}`)
    expect(Number.isFinite(toilet.floor)).toBe(true)
    expect(toilet.name).toMatch(/toilet/i)
  })

  it('lists nearest first, with the distance only from the user', () => {
    const from = {lat: 56.1452, lng: -3.92}
    const rows = toRows(roomTypeDestinations(types.lift), from, 'lift')
    const d = (r) => Math.hypot(r.dest.lat - from.lat, (r.dest.lng - from.lng) * 0.56)
    for (let i = 1; i < rows.length; i++) expect(d(rows[i])).toBeGreaterThanOrEqual(d(rows[i - 1]) - 1e-9)
    expect(rows[0].detail).toMatch(/Level -?\d+ · \d+ m$/)
    expect(toRows(roomTypeDestinations(types.lift), from, 'lift', {showDistance: false})[0].detail).not.toMatch(/ m$/)
    expect(rows.length).toBeLessThanOrEqual(30)
  })

  it('our own places for the older chips, never the town ones', () => {
    expect(pinPlaces('food').length).toBeGreaterThan(2)
    expect(pinPlaces('bus').every((d) => d.area !== 'town')).toBe(true)
  })

  it('reads distances plainly', () => {
    expect(formatAway(4)).toBe('10 m')
    expect(formatAway(234)).toBe('230 m')
    expect(formatAway(1449)).toBe('1.4 km')
  })
})
