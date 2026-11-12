import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DESTINATIONS} from '../../src/map/destinations.js'
import {parseMazeMapResults} from '../../src/map/mazemap-search.js'
import {searchDestinations} from '../../src/map/search.js'
import {isEventLabel, isRawCode, kindTier, KIND, matchTier, MATCH, rankResults, roomCode} from '../../src/map/search-rank.js'

// Real MazeMap answers (campus 2058), recorded so the tests need no network.
const fixture = (name) => JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/mazemap-search', `${name}.json`), 'utf8'))

/** What the search box shows for a query: our places and MazeMap rooms, ranked together. */
function search(query) {
  const ours = searchDestinations(DESTINATIONS, query, {limit: 12})
  const rooms = parseMazeMapResults(fixture(query.toLowerCase()))
  const fuzzyIds = new Set(ours.filter((d) => matchTier(d, query) == null).map((d) => d.id))
  return rankResults(query, [...ours, ...rooms], {fuzzyIds})
}
const names = (list) => list.map((d) => d.name)

describe('search ranking with real MazeMap answers', () => {
  it('"A3": the lecture theatre first, no event label, no raw code, no duplicate', () => {
    const list = names(search('A3'))
    expect(list[0]).toBe('A3 Lecture Theatre')
    expect(list).not.toContain('Lecture Theatre A3 - Offer Holder Day')
    expect(list.some((n) => n.startsWith('COTT/'))).toBe(false)
    expect(list.filter((n) => /A3 Lecture Theatre/.test(n))).toHaveLength(1)
    // The entrance comes after rooms people go to.
    expect(list.indexOf('A3 Entrance')).toBeGreaterThan(0)
  })

  it('"toilet": toilets, with exits and corridors nowhere near the top', () => {
    const list = search('toilet')
    expect(list.length).toBeGreaterThan(2)
    expect(list.slice(0, 3).every((d) => /toilet/i.test(d.name))).toBe(true)
    expect(list.some((d) => isRawCode(d))).toBe(false)
  })

  it('"library": our Library place first, and not repeated by the MazeMap rooms of the same name', () => {
    const list = search('library')
    expect(list[0].name).toBe('Library')
    expect(list[0].source).not.toBe('mazemap')
    expect(names(list).filter((n) => n === 'Library')).toHaveLength(1)
    // Stairs come after the places people go to.
    const stair = list.findIndex((d) => /stair/i.test(d.name))
    if (stair >= 0) expect(list.slice(stair).every((d) => kindTier(d) >= KIND.facility)).toBe(true)
  })

  it('"2B87": the room with that number first', () => {
    const list = search('2B87')
    expect(list[0].name).toBe('2B87')
    expect(list[0].building).toBe('Cottrell Building')
  })

  it('"cott": the Cottrell Building first, and none of the raw COTT/... codes', () => {
    const list = search('cott')
    expect(list[0].name).toMatch(/^Cottrell/)
    expect(list.some((d) => isRawCode(d))).toBe(false)
  })

  it('shows raw codes when the query has a slash', () => {
    const rooms = parseMazeMapResults(fixture('cott'))
    expect(names(rankResults('COTT/A3', rooms)).some((n) => n.startsWith('COTT/A3/EXIT'))).toBe(true)
  })
})

describe('the rules', () => {
  const room = (name, extra = {}) => ({id: name, name, source: 'mazemap', category: 'room', lat: 56.1448, lng: -3.9205, floor: 2, ...extra})

  it('match order: exact, starts, word starts, contains', () => {
    expect(matchTier(room('A3'), 'a3')).toBe(MATCH.exact)
    expect(matchTier(room('A3 Lecture Theatre'), 'A3')).toBe(MATCH.starts)
    expect(matchTier(room('Lecture Theatre A3'), 'A3')).toBe(MATCH.word)
    expect(matchTier(room('Lab XA3'), 'A3')).toBe(MATCH.contains)
    expect(matchTier(room('Seminar', {code: 'COTT/2B087'}), '2B87')).toBe(MATCH.exact) // room number, zeros dropped
    expect(matchTier(room('Seminar'), 'zz')).toBeNull()
  })

  it('kind order: teaching, named places, offices, toilets and lifts, then passages', () => {
    expect(kindTier(room('A3 Lecture Theatre', {kind: 'Lecture Theatre, Learning Spaces'}))).toBe(KIND.teaching)
    expect(kindTier(room('Café Bar', {kind: 'Cafe'}))).toBe(KIND.named)
    expect(kindTier(room('A35', {kind: 'Office'}))).toBe(KIND.office)
    expect(kindTier(room('Gents Toilet', {kind: 'Toilet Male, Toilets'}))).toBe(KIND.facility)
    expect(kindTier(room('A3 Entrance', {kind: 'Circulation Room'}))).toBe(KIND.passage)
    expect(KIND.teaching < KIND.named && KIND.named < KIND.office && KIND.office < KIND.facility && KIND.facility < KIND.passage).toBe(true)
  })

  it('an event label is hidden only when a permanent room is in the same place', () => {
    const event = room('Lecture Theatre A3 - Offer Holder Day', {kind: 'Offer Holder Day'})
    expect(isEventLabel(event)).toBe(true)
    expect(names(rankResults('A3', [event, room('A3 Lecture Theatre')]))).toEqual(['A3 Lecture Theatre'])
    expect(names(rankResults('A3', [event]))).toEqual(['Lecture Theatre A3 - Offer Holder Day'])
  })

  it('removes duplicates of the same room', () => {
    const a = room('2B87', {mazemapPoi: 1})
    expect(rankResults('2B87', [a, {...a}, room('2B87', {lat: 56.14481})])).toHaveLength(1)
    expect(roomCode('COTT/A3LT')).toBe('A3LT')
  })
})
