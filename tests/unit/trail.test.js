import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {bentHeadings, createArrowTrail, laneGeometryData, nextTurn, visibleCount, visibleWindowEnd} from '../../src/ar/trail.js'
import {resample} from '../../src/geo/geo.js'
import {TRAIL} from '../../src/config.js'

// 30 m north, right turn, 30 m east, left turn, 30 m north.
const ROUTE = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}, {x: 30, y: 60}]
const turns = [{s: 30, angle: 90}, {s: 60, angle: -90}]

describe('visible window', () => {
  it('reaches 8 m ahead, round corners too', () => {
    expect(visibleWindowEnd(25)).toBe(33)
    expect(visibleWindowEnd(0)).toBe(TRAIL.aheadM)
  })
  it('shows 5 to 8 chevrons, a metre apart, from 1.5 m ahead, and none behind the user', () => {
    expect(TRAIL.spacingM).toBe(1)
    expect(TRAIL.startM).toBe(1.5)
    expect(TRAIL.aheadM).toBe(8)
    const aS = Float32Array.from({length: 100}, (_, i) => i)
    for (const s of [0, 20.4, 50, 77.7]) {
      const n = visibleCount(aS, s)
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThanOrEqual(8)
    }
    expect(visibleCount(aS, 95)).toBe(3) // 97..99, the route ends
  })
  it('knows the next corner, and moves on once the user has passed it', () => {
    expect(nextTurn(turns, 30.5).s).toBe(30)
    expect(nextTurn(turns, 31.5).s).toBe(60)
    expect(nextTurn(turns, 61.5)).toBeNull()
  })
})

describe('the painted look', () => {
  it('is flat paint lying on the ground: no thickness', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    trail.mesh.geometry.computeBoundingBox()
    const box = trail.mesh.geometry.boundingBox
    near(box.max.y - box.min.y, 0, 1e-9)
    near(box.max.x - box.min.x, TRAIL.sizeM)
    near(box.max.z - box.min.z, TRAIL.sizeM)
    trail.dispose()
  })
  it('is semi-transparent green #1DB954 at 0.85, and never flickers against the floor', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    const {material} = trail.mesh
    expect(material.uniforms.uColor.value.getHex()).toBe(new THREE.Color(0x1db954).getHex())
    expect(material.uniforms.uPaint.value).toBe(0.85)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.polygonOffset).toBe(true)
    expect(material.polygonOffsetFactor).toBeLessThan(0)
    trail.dispose()
  })
  it('pulses towards the destination about once every 1.2 s, getting smaller into the distance', () => {
    expect(TRAIL.flowS).toBe(1.2)
    expect(TRAIL.farScale).toBeLessThan(1)
    const trail = createArrowTrail(THREE, ROUTE)
    expect(trail.mesh.material.uniforms.uFlowS.value).toBe(1.2)
    expect(createArrowTrail(THREE, ROUTE, {reducedMotion: true}).mesh.material.uniforms.uMotion.value).toBe(0)
    trail.dispose()
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
  it('shares the visible window and the colour with the chevrons', () => {
    const amber = createArrowTrail(THREE, ROUTE, {approximate: true})
    const {uniforms} = amber.lane.material
    expect(uniforms.uAheadM).toBe(amber.mesh.material.uniforms.uAheadM)
    expect(uniforms.uUserS).toBe(amber.mesh.material.uniforms.uUserS)
    expect(uniforms.uColor.value.getHex()).toBe(new THREE.Color(TRAIL.approxColor).getHex())
    amber.setSlope(0.1)
    expect(uniforms.uSlope.value).toBe(0.1)
    expect(amber.mesh.material.uniforms.uSlope.value).toBe(0.1)
  })
})

describe('arrow trail', () => {
  it('follows the user along the route, 8 m ahead', () => {
    const trail = createArrowTrail(THREE, ROUTE)
    trail.reset(25)
    expect(trail.windowEnd).toBe(33)
    near(trail.mesh.material.uniforms.uUserS.value, 25)
    // It eases, it does not jump.
    trail.update(36, 0.1, 1)
    expect(trail.windowEnd).toBeGreaterThan(33)
    expect(trail.windowEnd).toBeLessThan(36 + TRAIL.aheadM)
    trail.dispose()
  })

  it('bends round a corner: the chevrons turn one after another', () => {
    const samples = resample(ROUTE, TRAIL.spacingM)
    const headings = bentHeadings(samples)
    near(headings[25], 0)
    near(headings[35], 90)
    expect(headings[30]).toBeGreaterThan(5)
    expect(headings[30]).toBeLessThan(85)
    for (let i = 27; i < 33; i++) expect(headings[i + 1]).toBeGreaterThanOrEqual(headings[i] - 1e-9)
    // ...and each one still sits exactly on the route line.
    const trail = createArrowTrail(THREE, ROUTE)
    const m = new THREE.Matrix4()
    trail.mesh.getMatrixAt(30, m)
    const p = new THREE.Vector3().setFromMatrixPosition(m)
    near(p.x, samples[30].x)
    near(p.z, -samples[30].y)
    trail.dispose()
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
