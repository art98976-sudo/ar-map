import {afterEach, describe, expect, it} from 'vitest'
import {arrowMode, createFloorArrows, easeAngle} from '../../src/ui/components/floor-arrows.js'
import {FLOOR_ARROWS} from '../../src/config.js'

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('the floor arrows turn smoothly', () => {
  it('ease towards the way to walk instead of jumping', () => {
    near(easeAngle(null, 40, 0.016), 40) // the first reading is used as it is
    const once = easeAngle(0, 40, 0.016)
    expect(once).toBeGreaterThan(0)
    expect(once).toBeLessThan(10)
    let a = 0
    for (let i = 0; i < 120; i++) a = easeAngle(a, 40, 0.016)
    near(a, 40, 0.1)
  })
  it('always take the short way round, across 180°', () => {
    expect(easeAngle(170, -170, 0.05)).toBeGreaterThan(170)
  })
  it('switch to a turn arrow past about 100°, and back only below 85°', () => {
    expect(FLOOR_ARROWS.turnDeg).toBe(100)
    expect(arrowMode(95)).toBe('trail')
    expect(arrowMode(-101)).toBe('turn')
    expect(arrowMode(92, 'turn')).toBe('turn')
    expect(arrowMode(80, 'turn')).toBe('trail')
  })
})

describe('the floor arrows on screen', () => {
  let host
  let arrows
  afterEach(() => {
    arrows?.destroy()
    host?.remove()
  })
  const make = (getDeg) => {
    host = document.createElement('div')
    document.body.append(host)
    arrows = createFloorArrows(host, {getDeg})
    return arrows
  }

  it('draws four chevrons, turned by the way to walk', () => {
    let deg = 30
    make(() => deg)
    expect(host.querySelectorAll('.floor-arrows__chevron')).toHaveLength(4)
    arrows.step(0.016)
    expect(host.querySelector('[data-trail]').hidden).toBe(true) // not until a walk is under way
    arrows.setActive(true)
    arrows.step(0.016)
    expect(host.querySelector('[data-trail]').hidden).toBe(false)
    expect(host.querySelector('.floor-arrows__ground').style.getPropertyValue('--yaw')).toBe('30.0deg')
    deg = 160
    for (let i = 0; i < 60; i++) arrows.step(0.016)
    expect(arrows.mode).toBe('turn')
    expect(host.querySelector('[data-trail]').hidden).toBe(true)
    expect(host.querySelector('[data-turn]').hasAttribute('hidden')).toBe(false)
  })
  it('mirrors the turn arrow for a turn to the left', () => {
    make(() => -150)
    arrows.setActive(true)
    arrows.step(0.016)
    expect(arrows.mode).toBe('turn')
    expect(host.querySelector('.floor-arrows__ground').style.getPropertyValue('--side')).toBe('-1')
  })
  it('hides with no direction to show', () => {
    make(() => null)
    arrows.setActive(true)
    arrows.step(0.016)
    expect(host.querySelector('[data-trail]').hidden).toBe(true)
    expect(host.querySelector('[data-turn]').hasAttribute('hidden')).toBe(true)
  })
  it('near the entrance: a pin and "You\'ve arrived" instead of arrows', () => {
    make(() => 0)
    arrows.setActive(true)
    arrows.setArrived(true)
    arrows.step(0.016)
    expect(host.querySelector('[data-trail]').hidden).toBe(true)
    expect(host.querySelector('[data-arrived]').hidden).toBe(false)
    expect(host.querySelector('[data-arrived]').textContent).toContain("You've arrived")
  })
})
