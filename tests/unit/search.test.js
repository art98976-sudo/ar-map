import {describe, expect, it} from 'vitest'
import {describeDestination, editDistance, normalize, searchDestinations} from '../../src/nav/search.js'
import {
  DESTINATIONS,
  POPULAR,
  addRecent,
  clearRecent,
  findDestination,
  getRecent,
  setCurrentDestination,
} from '../../src/nav/destinations.js'
import {parseMazeMapResults} from '../../src/map/mazemap-search.js'

const ids = (list) => list.map((d) => d.id)
const top = (q) => searchDestinations(DESTINATIONS, q, {popular: ids(POPULAR)})[0]?.id

/** In-memory stand-in for localStorage / sessionStorage. */
function memoryStorage() {
  const map = new Map()
  return {getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k)}
}

describe('normalize', () => {
  it('lower-cases and strips punctuation and accents', () => {
    expect(normalize("  Students' Union ")).toBe('students union')
    expect(normalize('Café & Bar')).toBe('cafe and bar')
  })
})

describe('editDistance', () => {
  it('counts single typos', () => {
    expect(editDistance('cotrell', 'cottrell')).toBe(1)
    expect(editDistance('libary', 'library')).toBe(1)
    expect(editDistance('abc', 'xyz', 1)).toBe(2) // capped at max + 1
  })
})

describe('searchDestinations', () => {
  it('matches the start of a name: "lib" finds the Library', () => {
    expect(top('lib')).toBe('library')
  })
  it('matches aliases: "atrium", "gym", "gannochy", "food court"', () => {
    expect(top('atrium')).toBe('atrium')
    expect(top('gym')).toBe('sports-centre')
    expect(top('gannochy')).toBe('sports-centre')
    expect(top('food court')).toBe('atrium')
  })
  it('ignores case and extra spaces', () => {
    expect(top('  COTTRELL  ')).toBe('cottrell')
  })
  it('forgives small typos', () => {
    expect(top('cotrell')).toBe('cottrell')
    expect(top('libary')).toBe('library')
    expect(top('pathfot')).toBe('pathfoot')
  })
  it('matches several words in any order', () => {
    expect(top('centre sports')).toBe('sports-centre')
  })
  it('returns nothing for an empty or unknown query', () => {
    expect(searchDestinations(DESTINATIONS, '')).toEqual([])
    expect(searchDestinations(DESTINATIONS, '   ')).toEqual([])
    expect(searchDestinations(DESTINATIONS, 'qqqzzz')).toEqual([])
  })
  it('respects the limit', () => {
    expect(searchDestinations(DESTINATIONS, 'a', {limit: 3}).length).toBeLessThanOrEqual(3)
  })
})

describe('destination data', () => {
  it('has the six popular places in order', () => {
    expect(POPULAR.map((d) => d.name)).toEqual([
      'Library',
      'Atrium',
      'Cottrell Building',
      'Pathfoot Building',
      'Sports Centre',
      'Campus Central',
    ])
  })
  it('every place has an id, name, category and coordinates on campus', () => {
    const seen = new Set()
    for (const d of DESTINATIONS) {
      expect(d.id && d.name && d.category).toBeTruthy()
      expect(seen.has(d.id)).toBe(false)
      seen.add(d.id)
      expect(d.lat).toBeGreaterThan(56.13)
      expect(d.lat).toBeLessThan(56.16)
      expect(d.lng).toBeGreaterThan(-3.94)
      expect(d.lng).toBeLessThan(-3.9)
    }
  })
  it('describes a room with building and level', () => {
    expect(describeDestination({name: '2A73', building: 'Cottrell Building', floor: 2, category: 'room'})).toBe(
      'Cottrell Building · Level 2',
    )
    expect(describeDestination({name: 'Library', building: 'Library', floor: null})).toBe('')
  })
})

describe('recent searches', () => {
  it('keeps the newest first, without duplicates, at most six', () => {
    const store = memoryStorage()
    for (const d of DESTINATIONS.slice(0, 8)) addRecent(d, store)
    addRecent(DESTINATIONS[7], store)
    const recent = getRecent(store)
    expect(recent).toHaveLength(6)
    expect(recent[0].id).toBe(DESTINATIONS[7].id)
    expect(new Set(ids(recent)).size).toBe(6)
  })
  it('clears, and survives broken storage', () => {
    const store = memoryStorage()
    addRecent(DESTINATIONS[0], store)
    clearRecent(store)
    expect(getRecent(store)).toEqual([])
    store.setItem('welcomeAR.recent.v1', '{not json')
    expect(getRecent(store)).toEqual([])
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => addRecent(DESTINATIONS[0], broken)).not.toThrow()
    expect(getRecent(broken)).toEqual([])
  })
})

describe('current destination', () => {
  it('finds local places by id and remembers a MazeMap room for the trip', () => {
    const session = memoryStorage()
    expect(findDestination('library', session).name).toBe('Library')
    const room = {id: 'mm-1', name: '2A73', building: 'Cottrell Building', floor: 2, category: 'room', lat: 56.1444, lng: -3.9195}
    setCurrentDestination(room, session)
    expect(findDestination('mm-1', session)).toMatchObject({name: '2A73', floor: 2})
    expect(findDestination('mm-2', session)).toBeNull()
    expect(findDestination(undefined, session)).toBeNull()
  })
})

describe('parseMazeMapResults', () => {
  it('keeps rooms, drops stairs and duplicates, strips highlight tags', () => {
    const json = {
      result: [
        {title: '<em>2A73</em>', poiId: 1, dispBldNames: ['Cottrell Building'], zValue: 2, dispTypeNames: ['Learning Spaces'], point: {coordinates: [-3.9195, 56.1444]}},
        {title: '2A73', poiId: 2, dispBldNames: ['Cottrell Building'], zValue: 2, dispTypeNames: ['Learning Spaces'], point: {coordinates: [-3.9195, 56.1444]}},
        {title: 'Central Stair', poiId: 3, dispBldNames: ['Library'], zValue: 2, dispTypeNames: ['Stairs'], point: {coordinates: [-3.92, 56.14]}},
        {title: 'No location', poiId: 4},
        {title: 'null', poiId: 5, point: {coordinates: [0, 0]}},
      ],
    }
    expect(parseMazeMapResults(json)).toEqual([
      {
        id: 'mm-1',
        name: '2A73',
        building: 'Cottrell Building',
        floor: 2,
        category: 'room',
        kind: 'Learning Spaces',
        lat: 56.1444,
        lng: -3.9195,
        mazemapPoi: 1,
        source: 'mazemap',
      },
    ])
    expect(parseMazeMapResults(null)).toEqual([])
  })
})
