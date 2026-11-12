import {describe, expect, it} from 'vitest'
import {buildingFeatures, growRing, heightForFloors, outlineMask} from '../../src/premium/buildings.js'
import {EFFECTS, medianFps, nextToDrop} from '../../src/premium/fps-guard.js'
import {INDOOR_ZOOM, indoorMinZoom, restyle} from '../../src/premium/map-look.js'
import {premiumPixelRatio} from '../../src/premium/premium.js'
import {lightGradient} from '../../src/premium/route-look.js'

const square = [
  [-3.92, 56.145],
  [-3.919, 56.145],
  [-3.919, 56.146],
  [-3.92, 56.146],
  [-3.92, 56.145],
]

describe('premium buildings', () => {
  it('estimates height from floors, at least one floor', () => {
    expect(heightForFloors(4)).toBeCloseTo(16.4)
    expect(heightForFloors(0)).toBeCloseTo(5)
    expect(heightForFloors(undefined)).toBeCloseTo(5)
  })
  it('grows a ring outwards', () => {
    const grown = growRing(square, 10)
    expect(grown[0][0]).toBeLessThan(square[0][0])
    expect(grown[0][1]).toBeLessThan(square[0][1])
    expect(grown[2][0]).toBeGreaterThan(square[2][0])
  })
  it('turns MazeMap buildings into extrusion features and a mask', () => {
    const fc = buildingFeatures([
      {id: 1009833, name: 'Cottrell Building', floors: [{}, {}, {}, {}], fullOutline: {type: 'Polygon', coordinates: [square]}},
      {id: 2, name: 'No outline', floors: []},
    ])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toMatchObject({name: 'Cottrell Building', height: 16.4})
    expect(outlineMask(fc).coordinates).toHaveLength(1)
  })
})

describe('premium map look', () => {
  it('hides cartoon clutter and the flat street buildings', () => {
    expect(restyle('road-oneway-arrow-blue', 'symbol')).toEqual({hide: true})
    expect(restyle('building', 'fill')).toEqual({hide: true})
    expect(restyle('poi-label', 'symbol')).toEqual({hide: true})
  })
  it('draws indoor rooms as a plan: no room colour fills, thin lines, dark labels with white halo', () => {
    expect(restyle('mm-rooms-fill', 'fill').paint['fill-opacity']).toBe(0)
    expect(restyle('mm-rooms-outline', 'line').paint['line-width']).toBeLessThan(1)
    expect(restyle('mm-poi-label', 'symbol').paint['text-halo-color']).toBe('#ffffff')
    expect(restyle('road-label', 'symbol').paint['text-color']).toMatch(/255,255,255/)
  })
  it('keeps MazeMap indoor layers for close zoom, but never its route', () => {
    expect(indoorMinZoom('mm-rooms')).toBeLessThan(INDOOR_ZOOM)
    expect(indoorMinZoom('mm-route-shape-1')).toBeNull()
    expect(indoorMinZoom('road-path')).toBeNull()
  })
  it('caps the pixel ratio at 2', () => {
    expect(premiumPixelRatio(3)).toBe(2)
    expect(premiumPixelRatio(1.5)).toBe(1.5)
    expect(premiumPixelRatio(0)).toBe(1)
  })
})

describe('premium route light', () => {
  it('always has strictly rising stops from 0 to 1', () => {
    for (const t of [0, 0.03, 0.5, 0.97, 1]) {
      const g = lightGradient(t)
      const stops = g.slice(3).filter((_, i) => i % 2 === 0)
      expect(stops[0]).toBe(0)
      expect(stops.at(-1)).toBe(1)
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1])
    }
  })
})

describe('fps guard', () => {
  it('reads the median frame', () => {
    expect(medianFps([16, 17, 16, 50])).toBeCloseTo(1000 / 17)
    expect(medianFps([])).toBe(Infinity)
  })
  it('turns effects off in order: shadows, haze, blur', () => {
    expect(nextToDrop([])).toBe('shadows')
    expect(nextToDrop(['shadows'])).toBe('haze')
    expect(nextToDrop(EFFECTS)).toBeNull()
  })
})
