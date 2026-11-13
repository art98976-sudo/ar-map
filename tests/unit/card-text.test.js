import {describe, expect, it} from 'vitest'
import {DESTINATIONS} from '../../src/map/destinations.js'
import {entranceNameFor, estimatedWalkM, indoorLines, locationApproximate, subtitleFor, walkSummary} from '../../src/route/card-text.js'

const A3 = {id: 'mm-1002085033', name: 'A3 Lecture Theatre', building: 'Cottrell Building', floor: 2, category: 'room', lat: 56.1448, lng: -3.92051}
const cottrell = DESTINATIONS.find((d) => d.building === 'Cottrell Building' && d.entrance)

describe('the destination card', () => {
  it('shows time and distance together', () => {
    expect(walkSummary(95)).toBe('1 min · 95 m')
    expect(walkSummary(1234)).toMatch(/^\d+ min · 1\.2 km$/)
    expect(walkSummary(null)).toBeNull()
    expect(estimatedWalkM({lat: 56.1448, lng: -3.9205}, {lat: 56.1457, lng: -3.9205})).toBeCloseTo(100 * 1.3, -1)
  })

  it('never repeats the name underneath it', () => {
    expect(subtitleFor('Library', 'Library')).toBe('')
    expect(subtitleFor('A3 Lecture Theatre', 'Cottrell Building · Level 2')).toBe('Cottrell Building · Level 2')
  })

  it('names the door the route goes in by: a known main entrance near it, else "<Building> entrance"', () => {
    expect(cottrell).toBeTruthy()
    expect(entranceNameFor(A3, cottrell.entrance, DESTINATIONS)).toMatch(/^Cottrell.* main entrance$/)
    expect(entranceNameFor(A3, null, DESTINATIONS)).toMatch(/main entrance$/) // not planned yet: the main one
    const farDoor = {lat: cottrell.entrance.lat + 0.001, lng: cottrell.entrance.lng} // 110 m away: another door
    expect(entranceNameFor(A3, farDoor, DESTINATIONS)).toBe('Cottrell entrance')
  })

  it('a room: "Enter by X, then Level n", and stairs only when the levels differ', () => {
    expect(indoorLines(A3, {entranceName: 'Cottrell main entrance', entryLevel: 1})).toEqual({enter: 'Enter by Cottrell main entrance, then Level 2', stairs: true})
    expect(indoorLines(A3, {entranceName: 'Cottrell main entrance', entryLevel: 2}).stairs).toBe(false)
    expect(indoorLines(A3, {entranceName: 'Cottrell main entrance'}).stairs).toBe(false) // not known yet: not claimed
    expect(indoorLines({...A3, category: 'library'}, {entranceName: 'x'}).enter).toBeNull() // not a room
  })

  it('says the location is approximate when GPS is worse than 20 m', () => {
    expect(locationApproximate({accuracy: 35})).toBe(true)
    expect(locationApproximate({accuracy: 12})).toBe(false)
    expect(locationApproximate(null)).toBe(false)
  })
})
