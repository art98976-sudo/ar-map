import {describe, expect, it} from 'vitest'
import {getSaved, SAVED_GROUPS, savedByGroup, savedGroup, savePlace, unsavePlace} from '../../src/map/saved.js'

// Item 12: saved places, on this device only.
function memoryStorage() {
  const data = new Map()
  return {getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data}
}
const LIB = {id: 'library', name: 'Library', category: 'library', lat: 56.146, lng: -3.92, description: 'kept out'}
const A3 = {id: 'mm-1002085033', name: 'A3 Lecture Theatre', category: 'room', building: 'Cottrell Building', floor: 2, lat: 56.1449, lng: -3.9203}

describe('saved places', () => {
  it('has the three groups', () => {
    expect(SAVED_GROUPS.map((g) => g.label)).toEqual(['My lectures', 'My halls', 'Other places'])
  })
  it('saves a place in a group, keeps only what is needed, and moves it between groups', () => {
    const storage = memoryStorage()
    savePlace(A3, 'lectures', storage)
    savePlace(LIB, 'other', storage)
    expect(savedGroup('mm-1002085033', storage)).toBe('lectures')
    expect(getSaved(storage)[1].place).not.toHaveProperty('description')
    savePlace(A3, 'halls', storage)
    expect(savedGroup('mm-1002085033', storage)).toBe('halls')
    expect(getSaved(storage)).toHaveLength(2)
  })
  it('lists non-empty groups in order, and removes', () => {
    const storage = memoryStorage()
    savePlace(LIB, 'other', storage)
    savePlace(A3, 'lectures', storage)
    expect(savedByGroup(storage).map((g) => [g.label, g.places.map((p) => p.name)])).toEqual([
      ['My lectures', ['A3 Lecture Theatre']],
      ['Other places', ['Library']],
    ])
    unsavePlace('library', storage)
    expect(savedGroup('library', storage)).toBeNull()
  })
  it('ignores unknown groups and damaged storage', () => {
    const storage = memoryStorage()
    savePlace(LIB, 'secret', storage)
    expect(getSaved(storage)).toEqual([])
    storage.setItem('welcomeAR.saved.v1', '{not json')
    expect(getSaved(storage)).toEqual([])
    expect(getSaved({getItem: () => { throw new Error('blocked') }})).toEqual([])
  })
})
