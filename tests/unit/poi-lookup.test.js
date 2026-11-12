import {describe, expect, it, vi} from 'vitest'
import {findDestination} from '../../src/map/destinations.js'
import {fetchPoiDestination, poiIdFrom, poiToDestination} from '../../src/map/poi-lookup.js'

// What MazeMap answers for /api/pois/1002085033/?srid=4326 (A3 Lecture Theatre), trimmed.
const A3 = {
  poiId: 1002085033,
  campusId: 2058,
  title: 'A3 Lecture Theatre',
  identifier: 'COTT/A3LT',
  buildingName: 'Cottrell Building',
  z: 2,
  point: {type: 'Point', coordinates: [-3.9205121464987616, 56.144797627811215]},
  types: [{name: 'Lecture Theatre'}, {name: 'Learning Spaces'}],
}
const reply = (status, body) => vi.fn(async () => ({status, ok: status >= 200 && status < 300, json: async () => body}))
const emptyStorage = {getItem: () => null, setItem: () => {}}

describe('room links', () => {
  it('a preset id is found at once, with no network', () => {
    const library = findDestination('library', emptyStorage)
    expect(library?.name).toBe('Library')
    expect(poiIdFrom('library')).toBeNull()
  })

  it('a room id in a fresh session is fetched from MazeMap and becomes the same destination search gives', async () => {
    expect(findDestination('mm-1002085033', emptyStorage)).toBeNull() // not in this tab's memory
    const fetchImpl = reply(200, A3)
    const dest = await fetchPoiDestination(poiIdFrom('mm-1002085033'), {fetchImpl})
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.mazemap.com/api/pois/1002085033/?srid=4326')
    expect(dest).toEqual({
      id: 'mm-1002085033',
      name: 'A3 Lecture Theatre',
      building: 'Cottrell Building',
      floor: 2,
      category: 'room',
      kind: 'Lecture Theatre, Learning Spaces',
      lat: 56.144797627811215,
      lng: -3.9205121464987616,
      mazemapPoi: 1002085033,
      code: 'COTT/A3LT',
      source: 'mazemap',
    })
  })

  it('an unknown id gives null (the screen then says it could not find the place)', async () => {
    expect(await fetchPoiDestination('999999999999', {fetchImpl: reply(404, null)})).toBeNull()
    expect(poiToDestination({...A3, campusId: 99})).toBeNull() // another university's room
    expect(poiToDestination({...A3, deleted: true})).toBeNull()
  })

  it('a network failure is an error, not "not found"', async () => {
    await expect(fetchPoiDestination('1', {fetchImpl: reply(503, null)})).rejects.toThrow(/503/)
  })

  it('only mm- ids with a number are looked up', () => {
    expect(poiIdFrom('mm-1002085033')).toBe('1002085033')
    expect(poiIdFrom('mm-abc')).toBeNull()
    expect(poiIdFrom(undefined)).toBeNull()
  })
})
