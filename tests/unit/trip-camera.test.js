import {describe, expect, it} from 'vitest'
import {followsFix, routeBounds, TRIP_VIEW, tripPadding} from '../../src/map/trip-camera.js'
import {fromLocal} from '../../src/geo/geo.js'

// Item 1: the map trip frames the whole route between its bars, and follows only a dot on the route.
const ORIGIN = {lat: 56.1487, lng: -3.927} // Pathfoot main entrance
const at = (x, y) => fromLocal(ORIGIN, {x, y})
const ROUTE = {points: [at(0, 0), at(300, -200), at(500, -380)]} // about 660 m towards the Library

describe('routeBounds', () => {
  it('boxes every point, west-south to east-north', () => {
    const [[w, s], [e, n]] = routeBounds(ROUTE.points)
    for (const p of ROUTE.points) {
      expect(p.lng).toBeGreaterThanOrEqual(w)
      expect(p.lng).toBeLessThanOrEqual(e)
      expect(p.lat).toBeGreaterThanOrEqual(s)
      expect(p.lat).toBeLessThanOrEqual(n)
    }
  })
})

describe('tripPadding', () => {
  it('phone portrait: clears the top bar and the bottom panel, with a margin', () => {
    expect(tripPadding({width: 390, height: 844, topPx: 60, bottomPx: 150})).toEqual({top: 84, bottom: 174, left: 31, right: 31})
  })

  it('desktop: no bottom panel, a small top bar', () => {
    const p = tripPadding({width: 1440, height: 900, topPx: 60})
    expect(p).toEqual({top: 84, bottom: 24, left: 48, right: 48})
  })

  it('phone landscape: bars are scaled back so the route keeps 30% of the height', () => {
    const p = tripPadding({width: 844, height: 390, topPx: 60, bottomPx: 220})
    expect(390 - p.top - p.bottom).toBeGreaterThanOrEqual(Math.floor(390 * TRIP_VIEW.minRouteShare))
    expect(p.top).toBeLessThan(84)
    expect(p.bottom).toBeLessThan(244)
  })

  it('never gives a negative padding', () => {
    const p = tripPadding({width: 300, height: 100, topPx: 400, bottomPx: 400})
    expect(Math.min(p.top, p.bottom, p.left, p.right)).toBeGreaterThanOrEqual(0)
  })
})

describe('followsFix', () => {
  it('follows a good fix on the route', () => {
    expect(followsFix(ROUTE, {...at(150, -100), accuracy: 8})).toBe(true)
  })
  it('keeps the route framed for a fix far from it (a chosen start elsewhere, or across campus)', () => {
    expect(followsFix(ROUTE, {...at(-300, 300), accuracy: 8})).toBe(false)
  })
  it("keeps the route framed for a laptop's coarse Wi-Fi fix, even on the route", () => {
    expect(followsFix(ROUTE, {...at(150, -100), accuracy: 1200})).toBe(false)
  })
  it('no fix, or no route: nothing to follow', () => {
    expect(followsFix(ROUTE, null)).toBe(false)
    expect(followsFix({points: []}, {...at(0, 0), accuracy: 5})).toBe(false)
  })
})
