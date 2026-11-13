import {describe, expect, it} from 'vitest'
import {createHeightProfile, heightsFromLevels} from '../../src/scene/route-height.js'
import {fromLocal} from '../../src/geo/geo.js'

const origin = {lat: 56.1448, lng: -3.9205}
const at = (x, y, z, h) => ({...fromLocal(origin, {x, y}), z, h})

describe('arrows on the scene floors (Step 3)', () => {
  it('reads the floor height along the route: flat, then up the stair slope, then the next floor', () => {
    const points = [at(0, 0, 1, 0), at(10, 0, 1, 0), at(14, 0, 2, 3.5), at(20, 0, 2, 3.5)]
    const nav = [{x: 0, y: 0}, {x: 20, y: 0}]
    const h = createHeightProfile(points, nav, origin)
    expect(h(5)).toBeCloseTo(0)
    expect(h(12)).toBeCloseTo(1.75) // half way up the stair
    expect(h(18)).toBeCloseTo(3.5)
    expect(h(-3)).toBe(0) // flat before the start
    expect(h(Infinity)).toBeCloseTo(3.5) // the destination's floor
  })

  it('a route saved before heights existed still gets them from its levels', () => {
    expect(heightsFromLevels([{z: 0}, {z: -1}, {z: 1}, {z: 2}, {z: 0}, {z: 3}])).toEqual([0, 0, 3.5, 7, 0, 0])
  })
})
