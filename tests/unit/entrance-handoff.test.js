import {describe, expect, it} from 'vitest'
import {fromLocal} from '../../src/geo/geo.js'
import {atEntrance, doorAlongM, entryFloor, HANDOFF, handoffLine, indoorLink} from '../../src/route/entrance-handoff.js'

// Item 7: AR hands over to the indoor map at the entrance, on the door's floor, saying why.
const O = {lat: 56.1449, lng: -3.9203}
const at = (x, y, z) => ({...fromLocal(O, {x, y}), ...(z != null ? {z} : {})})
const ROUTE = {points: [at(0, 0), at(0, 60), at(40, 60)], indoorPoints: [at(40, 60, 1), at(40, 80, 2)], entryLevel: 1}
const ROOM = {id: 'mm-1', category: 'room', floor: 2}

describe('entrance handoff', () => {
  it('finds the door at the end of the outdoor walk', () => {
    expect(doorAlongM(ROUTE)).toBeCloseTo(100, 0)
    expect(doorAlongM({points: ROUTE.points})).toBeNull() // no indoor part: nothing to hand over to
  })

  it('opens on the door floor, not the room floor', () => {
    expect(entryFloor(ROUTE, ROOM)).toBe(1)
    expect(entryFloor({...ROUTE, entryLevel: null}, ROOM)).toBe(1) // from the first indoor point
    expect(entryFloor({points: []}, ROOM)).toBe(2)
  })

  it('hands over within 5 m of the door, for a room, once the trip is under way', () => {
    const base = {dest: ROOM, route: ROUTE, phase: 'ready'}
    expect(atEntrance({...base, userS: 90})).toBe(false)
    expect(atEntrance({...base, userS: 100 - HANDOFF.atDoorM})).toBe(true)
    expect(atEntrance({...base, userS: 120})).toBe(true)
    expect(atEntrance({...base, userS: 99, phase: 'aligning'})).toBe(false)
    expect(atEntrance({...base, userS: 99, dismissed: true})).toBe(false) // "Keep using AR"
    expect(atEntrance({...base, userS: 99, dest: {category: 'library'}})).toBe(false) // a building: arrive at its door
    expect(atEntrance({...base, userS: null})).toBe(false)
  })

  it('says why in one line, and links to the floor', () => {
    expect(handoffLine({entranceName: 'Cottrell main entrance', floor: 1})).toBe('You’re at the Cottrell main entrance. The indoor map takes over on Level 1: GPS can’t see you inside.')
    expect(handoffLine({entranceName: null, floor: null})).toBe('You’re at the entrance. The indoor map takes over: GPS can’t see you inside.')
    expect(indoorLink('mm-1002085033', 1)).toBe('/indoor?to=mm-1002085033&from=ar&floor=1')
    expect(indoorLink('mm-1', null)).toBe('/indoor?to=mm-1&from=ar')
  })
})
