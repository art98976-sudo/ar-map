import {describe, expect, it, vi} from 'vitest'
import {anchorsNear} from '../../src/ar/building-shell.js'
import {getStepFree, planRoute, setStepFree} from '../../src/route/route.js'
import {routeByFloor} from '../../src/ui/screens/indoor.js'

const memory = () => {
  const m = new Map()
  return {getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}
}

describe('the indoor map', () => {
  it('splits the route into one line per floor, joined at the stair', () => {
    const pts = [
      {lat: 56.1448, lng: -3.9205, z: 1},
      {lat: 56.1449, lng: -3.9205, z: 1},
      {lat: 56.1449, lng: -3.9204, z: 2},
      {lat: 56.145, lng: -3.9204, z: 2},
    ]
    const fc = routeByFloor(pts)
    expect(fc.features.map((f) => f.properties.z)).toEqual([1, 2])
    expect(fc.features[1].geometry.coordinates[0]).toEqual(fc.features[0].geometry.coordinates.at(-1)) // joined
  })
})

describe('step-free routes', () => {
  it('remembers the choice on this device', () => {
    const storage = memory()
    expect(getStepFree(storage)).toBe(false)
    setStepFree(true, storage)
    expect(getStepFree(storage)).toBe(true)
  })

  it("asks MazeMap for the route without stairs, to the room's own floor", async () => {
    const mazemap = vi.fn(async () => ({points: [{lat: 56.1463, lng: -3.923, z: 0}, {lat: 56.1449, lng: -3.9206, z: 0}], outdoorPoints: [], indoor: false, endsIndoor: false}))
    const room = {id: 'mm-1', name: 'A3', category: 'room', floor: 2, building: 'Cottrell Building', lat: 56.1448, lng: -3.92051}
    const route = await planRoute({lat: 56.1463, lng: -3.923}, room, {mazemap, stepFree: true})
    expect(mazemap.mock.calls[0][2]).toEqual({targetZ: 2, stepFree: true})
    expect(route.stepFree).toBe(true)
    await planRoute({lat: 56.1463, lng: -3.923}, {...room, category: 'library', floor: null}, {mazemap, stepFree: false})
    expect(mazemap.mock.calls[1][2]).toEqual({targetZ: 0, stepFree: false})
  })
})

describe('"I\'m here"', () => {
  it('offers the doors, stairs and lifts near the user, nearest first', () => {
    const sq = (x, y) => [[{x, y}, {x: x + 1, y}, {x: x + 1, y: y + 1}, {x, y: y + 1}, {x, y}]]
    const floor = {
      doors: [{a: {x: 3, y: 0}, b: {x: 4, y: 0}}, {a: {x: 60, y: 0}, b: {x: 61, y: 0}}],
      stairs: [{polygon: sq(10, 0)}],
      lifts: [{polygon: sq(0, 20)}],
    }
    const near = anchorsNear(floor, {x: 0, y: 0}, 25)
    expect(near.map((a) => a.kind)).toEqual(['door', 'stairs', 'lift'])
    expect(near.every((a) => a.d <= 25)).toBe(true)
  })
})
