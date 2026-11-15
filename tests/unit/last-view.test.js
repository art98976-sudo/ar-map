import {describe, expect, it} from 'vitest'
import {readLastView, saveLastView, validView, watchLastView} from '../../src/map/last-view.js'
import {HOME_MAP} from '../../src/config.js'
import {DESTINATIONS} from '../../src/map/destinations.js'

// Map-first home, item 3: open at indoor zoom on Campus Central, or where the student left the map.
function memoryStorage() {
  const data = new Map()
  return {getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data}
}
const HERE = {lng: -3.9213, lat: 56.1451, zoom: 18.3, bearing: 30}

describe('the opening view', () => {
  it('is Campus Central at an indoor zoom (rooms, codes and icons show from zoom 17)', () => {
    expect(HOME_MAP.openOn).toBe('campus-central')
    expect(DESTINATIONS.some((d) => d.id === HOME_MAP.openOn)).toBe(true)
    expect(HOME_MAP.openZoom).toBe(17.8)
    expect(HOME_MAP.openZoom).toBeGreaterThan(HOME_MAP.indoorZoom)
  })
})

describe('the last view', () => {
  it('is saved and read back, rounded, on this device', () => {
    const storage = memoryStorage()
    saveLastView({...HERE, lat: 56.14512345678}, storage)
    expect(readLastView(storage)).toEqual({...HERE, lat: 56.145123})
    expect([...storage.data.keys()]).toEqual(['welcomeAR.lastView.v1'])
  })

  it('none, broken or off-campus views are ignored', () => {
    const storage = memoryStorage()
    expect(readLastView(storage)).toBeNull()
    storage.setItem('welcomeAR.lastView.v1', '{not json')
    expect(readLastView(storage)).toBeNull()
    expect(validView({...HERE, lng: -0.12, lat: 51.5})).toBeNull() // London
    expect(validView({...HERE, zoom: 3})).toBeNull()
    expect(validView({...HERE, zoom: NaN})).toBeNull()
    saveLastView({...HERE, lat: 40}, storage)
    expect(readLastView(storage)).toBeNull()
  })

  it('blocked storage never throws', () => {
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    }
    expect(() => saveLastView(HERE, blocked)).not.toThrow()
    expect(readLastView(blocked)).toBeNull()
  })

  it('only a move the student made is saved, not one the app made', () => {
    const storage = memoryStorage()
    const handlers = {}
    const map = {
      on: (name, fn) => (handlers[name] = fn),
      off: (name) => delete handlers[name],
      getCenter: () => ({lng: HERE.lng, lat: HERE.lat}),
      getZoom: () => HERE.zoom,
      getBearing: () => HERE.bearing,
    }
    const stop = watchLastView(map, storage)
    handlers.moveend({}) // flyTo a place, the opening: no originalEvent
    expect(readLastView(storage)).toBeNull()
    handlers.moveend({originalEvent: {type: 'touchend'}})
    expect(readLastView(storage)).toEqual(HERE)
    stop()
    expect(handlers.moveend).toBeUndefined()
  })
})
