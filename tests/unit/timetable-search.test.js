import {describe, expect, it} from 'vitest'
import {inBuilding, timetableQuery} from '../../src/map/timetable.js'
import {rankResults} from '../../src/map/search-rank.js'

// Item 7: rooms typed as a timetable writes them. (Live check against MazeMap, 30 strings:
// SEARCH_PROBE=1 npx vitest run tests/unit/search-probe.live.test.js)
const room = (q) => timetableQuery(q).room
const where = (q) => timetableQuery(q).building

describe('timetable queries', () => {
  it('takes the building off, before or after the room', () => {
    expect(timetableQuery('Cottrell 4B49')).toMatchObject({room: '4B49', building: 'Cottrell Building'})
    expect(timetableQuery('COTT 4B49')).toMatchObject({room: '4B49', building: 'Cottrell Building'})
    expect(timetableQuery('Cottrell Building 4B49')).toMatchObject({room: '4B49', building: 'Cottrell Building'})
    expect(timetableQuery('4B49 Cottrell')).toMatchObject({room: '4B49', building: 'Cottrell Building'})
    expect(timetableQuery('Colin Bell 3S29')).toMatchObject({room: '3S29', building: 'Colin Bell Building'})
    expect(timetableQuery('CB 3S29')).toMatchObject({room: '3S29', building: 'Colin Bell Building'})
    expect(timetableQuery('Iris Murdoch 10.2')).toMatchObject({room: '10.2', building: 'Iris Murdoch Building'})
    expect(timetableQuery('Library 2.23')).toMatchObject({room: '2.23', building: 'Library'})
  })
  it('joins a room code typed with a space, dash or dot, in any case', () => {
    expect(room('4B 49')).toBe('4B49')
    expect(room('4B-49')).toBe('4B49')
    expect(room('4b49')).toBe('4B49')
    expect(room('3s 29')).toBe('3S29')
  })
  it('reads LT and MLT as a lecture theatre', () => {
    expect(room('LT A3')).toBe('A3')
    expect(room('A3 LT')).toBe('A3')
    expect(room('Lecture Theatre A3')).toBe('A3')
    expect(timetableQuery('Cottrell LT A3')).toMatchObject({room: 'A3', building: 'Cottrell Building'})
    expect(room('Logie LT')).toBe('Logie Lecture Theatre')
    expect(room('Pathfoot LT')).toBe('Pathfoot Lecture Theatre')
    expect(room('Pathfoot MLT')).toBe('Pathfoot Lecture Theatre')
  })
  it('leaves alone what needs no help', () => {
    expect(timetableQuery('Library')).toMatchObject({room: 'Library', building: null, changed: false})
    expect(timetableQuery('Pathfoot')).toMatchObject({room: 'Pathfoot', building: null})
    expect(timetableQuery('COTT/4B049')).toMatchObject({room: 'COTT/4B049', building: null})
    expect(where('seminar room')).toBeNull()
    expect(room('  4B49  ')).toBe('4B49')
  })
})

describe('the building named comes first', () => {
  const items = [
    {id: 'a', name: 'Seminar Room 2', building: 'Andrew Miller', floor: 3, source: 'mazemap', lat: 56.14, lng: -3.92, kind: 'Seminar room'},
    {id: 'b', name: 'Seminar Room 2', building: 'Iris Murdoch Building', floor: 3, source: 'mazemap', lat: 56.15, lng: -3.93, kind: 'Seminar room'},
  ]
  it('ranks rooms in that building first, keeping the rest', () => {
    expect(rankResults('Seminar Room 2', items, {building: 'Iris Murdoch Building'}).map((d) => d.id)).toEqual(['b', 'a'])
    expect(inBuilding(items[1], 'Iris Murdoch Building')).toBe(true)
    expect(inBuilding(items[0], 'Iris Murdoch Building')).toBe(false)
  })
})
