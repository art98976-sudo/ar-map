import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {createArrowTrail, laneGeometryData, nextTurn, TRAIL, visibleWindowEnd} from '../../src/arrows/trail.js'

// 30 m north, right turn, 30 m east, left turn, 30 m north.
const ROUTE = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}, {x: 30, y: 60}]
const turns = [{s: 30, angle: 90}, {s: 60, angle: -90}]

describe('visible window', () => {
  it('ends 3 m after the next turn', () => {
    expect(visibleWindowEnd(turns, 20)).toBe(33)
    expect(visibleWindowEnd(turns, 25)).toBe(35)
    expect(visibleWindowEnd(turns, 50)).toBe(63)
  })
  it('shows at least 6 m', () => {
    expect(visibleWindowEnd(turns, 29)).toBe(39)
    expect(visibleWindowEnd(turns, 58)).toBe(68)
  })
  it('never looks further ahead than the 30 m limit', () => {
    expect(visibleWindowEnd(turns, 0)).toBe(TRAIL.aheadM)
    expect(visibleWindowEnd([], 40)).toBe(40 + TRAIL.aheadM)
  })
  it('moves on to the next turn once the user has passed a corner', () => {
    expect(nextTurn(turns, 30.5).s).toBe(30)
    expect(nextTurn(turns, 31.5).s).toBe(60)
    expect(visibleWindowEnd(turns, 40)).toBe(63)
    expect(nextTurn(turns, 61.5)).toBeNull()
  })
})

describe('the painted look', () => {
  it('uses wider chevrons and smaller corner arrows', () => {
    expect(TRAIL.sizeM).toBe(0.85)
    expect(TRAIL.turnScale).toBe(1.6)
  })
  it('lays a 1.1 m lane strip along the route, to either side of it', () => {
    const lane = laneGeometryData([{x: 0, y: 0, s: 0}, {x: 0, y: 1, s: 1}, {x: 0, y: 2, s: 2}])
    expect(lane.positions).toHaveLength(18)
    expect(lane.aS).toEqual([0, 0, 1, 1, 2, 2])
    expect(lane.aSide).toEqual([-1, 1, -1, 1, -1, 1])
    expect(lane.index).toHaveLength(12)
    // Heading north, the left vertex is to the west and the right to the east.
    near(lane.positions[0], -0.55)
    near(lane.positions[3], 0.55)
    near(lane.positions[2], 0) // z = -north
    near(lane.positions[8], -1)
  })
  it('shares the visible window and the colour with the arrows', () => {
    const amber = createArrowTrail(THREE, ROUTE, {approximate: true})
    const {uniforms} = amber.lane.material
    expect(uniforms.uAheadEnd).toBe(amber.mesh.material.uniforms.uAheadEnd)
    expect(uniforms.uColor.value.getHex()).toBe(new THREE.Color(TRAIL.approxColor).getHex())
    amber.setSlope(0.1)
    expect(uniforms.uSlope.value).toBe(0.1)
    expect(amber.mesh.material.uniforms.uSlope.value).toBe(0.1)
  })
})

describe('arrow trail', () => {
  it('feeds the window end to the shader, and fades in the next leg after the turn', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    trail.reset(25)
    expect(trail.windowEnd).toBe(35)
    expect(trail.update(25, 0.016, 1)).toBe(trail.update(25, 0.016, 1))
    near(trail.mesh.material.uniforms.uAheadEnd.value, 35)
    // Walk past the corner: the end eases out, it does not jump.
    trail.reset(34)
    expect(trail.windowEnd).toBe(63)
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
