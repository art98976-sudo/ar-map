import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {createArrowTrail, nextTurn, TRAIL, visibleWindowEnd} from '../../src/arrows/trail.js'

// 30 m north, right turn, 30 m east, left turn, 30 m north.
const ROUTE = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}, {x: 30, y: 60}]
const turns = [{s: 30, angle: 90}, {s: 60, angle: -90}]

describe('visible window', () => {
  it('ends 3 m after the next turn', () => {
    expect(visibleWindowEnd(turns, 20)).toBe(33)
    expect(visibleWindowEnd(turns, 25)).toBe(33)
    expect(visibleWindowEnd(turns, 50)).toBe(63)
  })
  it('shows at least 6 m', () => {
    expect(visibleWindowEnd(turns, 29)).toBe(35)
    expect(visibleWindowEnd(turns, 58)).toBe(64)
  })
  it('never looks further ahead than the 15 m limit', () => {
    expect(visibleWindowEnd(turns, 0)).toBe(TRAIL.aheadM)
    expect(visibleWindowEnd([], 40)).toBe(40 + TRAIL.aheadM)
  })
  it('moves on to the next turn once the user has passed a corner', () => {
    expect(nextTurn(turns, 30.5).s).toBe(30)
    expect(nextTurn(turns, 31.5).s).toBe(60)
    expect(visibleWindowEnd(turns, 40)).toBe(55)
    expect(nextTurn(turns, 61.5)).toBeNull()
  })
})

describe('arrow trail', () => {
  it('feeds the window end to the shader, and fades in the next leg after the turn', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    trail.reset(25)
    expect(trail.windowEnd).toBe(33)
    expect(trail.update(25, 0.016, 1)).toBe(trail.update(25, 0.016, 1))
    near(trail.mesh.material.uniforms.uAheadEnd.value, 33)
    // Walk past the corner: the end eases out, it does not jump.
    trail.reset(34)
    expect(trail.windowEnd).toBe(34 + TRAIL.aheadM)
    trail.reset(25)
    for (let i = 0; i < 3; i++) trail.update(36, 0.1, 2 + i)
    expect(trail.windowEnd).toBeGreaterThan(33)
    expect(trail.windowEnd).toBeLessThan(36 + TRAIL.aheadM)
  })

  it('marks corner arrows left or right', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    const aTurn = trail.mesh.geometry.getAttribute('aTurn').array
    expect(aTurn[30]).toBe(1)
    expect(aTurn[60]).toBe(-1)
    expect(aTurn[10]).toBe(0)
  })

  it('draws green normally and amber for an approximate route', () => {
    const green = createArrowTrail(THREE, ROUTE)
    const amber = createArrowTrail(THREE, ROUTE, {approximate: true})
    expect(green.mesh.material.uniforms.uColor.value.getHex()).toBe(new THREE.Color(TRAIL.color).getHex())
    expect(amber.mesh.material.uniforms.uColor.value.getHex()).toBe(new THREE.Color(TRAIL.approxColor).getHex())
  })
})

function near(a, b, tol = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
}
