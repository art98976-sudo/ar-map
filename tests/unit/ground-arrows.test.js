import * as THREE from 'three'
import {describe, expect, it} from 'vitest'
import {angleFade, chevronSpots, createGroundArrows, fadeAt, roundCorners} from '../../src/ar/ground-arrows.js'
import {GROUND_ARROWS} from '../../src/config.js'

// North 30 m, then east 30 m (route frame: x east, y north).
const L = [
  {x: 0, y: 0},
  {x: 0, y: 30},
  {x: 30, y: 30},
]
const straight = [
  {x: 0, y: 0},
  {x: 0, y: 100},
]

describe('roundCorners', () => {
  it('rounds a right-angle corner with about a 1 m radius, staying on the legs either side', () => {
    const r = roundCorners(L)
    const curve = r.filter((p) => p.y > 28.9 && p.x < 1.1)
    expect(curve.length).toBeGreaterThan(5)
    // The 90° corner is cut 1 m back along each leg (radius 1 m: tan 45° = 1).
    expect(curve[0].x).toBeCloseTo(0, 6)
    expect(curve[0].y).toBeCloseTo(29, 6)
    expect(curve.at(-1).x).toBeCloseTo(1, 6)
    expect(curve.at(-1).y).toBeCloseTo(30, 6)
    // Never touches the sharp corner itself.
    expect(r.some((p) => p.x === 0 && p.y === 30)).toBe(false)
  })
  it('leaves a straight route and its ends alone', () => {
    expect(roundCorners(straight)).toEqual(straight)
    const r = roundCorners(L)
    expect(r[0]).toEqual(L[0])
    expect(r.at(-1)).toEqual(L.at(-1))
  })
})

describe('chevronSpots', () => {
  it('lays one every 1 m along the next 10 m, pointing along the path', () => {
    const spots = chevronSpots(straight, roundCorners(straight), 10)
    expect(spots.length).toBeGreaterThanOrEqual(9)
    expect(spots.length).toBeLessThanOrEqual(GROUND_ARROWS.poolSize)
    for (let i = 1; i < spots.length; i++) expect(spots[i].d - spots[i - 1].d).toBeCloseTo(1, 6)
    expect(spots[0].d).toBeGreaterThanOrEqual(GROUND_ARROWS.nearM)
    expect(spots.at(-1).d).toBeLessThanOrEqual(10 + 1e-6)
    for (const s of spots) expect(s.bearingDeg).toBeCloseTo(0, 6)
  })
  it('anchors them to fixed spots on the route, so they do not slide as the user walks', () => {
    const at = (s) => chevronSpots(straight, roundCorners(straight), s).map((spot) => spot.y)
    for (const y of [...at(10), ...at(10.5), ...at(11.37)]) expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-6)
    const a = at(10)
    const b = at(10.5)
    expect(b.filter((y) => a.some((v) => Math.abs(v - y) < 1e-6)).length).toBeGreaterThanOrEqual(b.length - 1)
  })
  it('bends through the turn: bearings go from north (0°) through the curve to east (90°)', () => {
    const spots = chevronSpots(L, roundCorners(L), 22)
    const bearings = spots.map((s) => s.bearingDeg)
    expect(bearings[0]).toBeCloseTo(0, 3)
    expect(bearings.at(-1)).toBeCloseTo(90, 3)
    expect(bearings.some((b) => b > 10 && b < 80)).toBe(true) // at least one on the curve
    for (let i = 1; i < bearings.length; i++) expect(bearings[i]).toBeGreaterThanOrEqual(bearings[i - 1] - 1e-6)
  })
  it('stops at the end of the route', () => {
    const spots = chevronSpots(straight, roundCorners(straight), 95)
    expect(spots.at(-1).y).toBeLessThanOrEqual(100)
    expect(chevronSpots(straight, roundCorners(straight), null)).toEqual([])
  })
})

describe('fadeAt', () => {
  it('is solid near the user and gone by 10 m', () => {
    expect(fadeAt(1)).toBe(1)
    expect(fadeAt(3)).toBe(1)
    expect(fadeAt(6.5)).toBeCloseTo(0.5, 6)
    expect(fadeAt(10)).toBe(0)
  })
})

describe('createGroundArrows', () => {
  it('makes a fixed pool once and only moves it: flat on the floor, drawn on top, pointing along the route', () => {
    const arrows = createGroundArrows(THREE)
    arrows.setRoute(straight)
    expect(arrows.created).toBe(GROUND_ARROWS.poolSize)
    const children = arrows.group.children.slice()
    const drawn = arrows.update({userS: 10, slope: 0, show: true, time: 0})
    expect(drawn).toBeGreaterThanOrEqual(9)
    arrows.update({userS: 20, slope: 0, show: true, time: 1})
    expect(arrows.group.children).toEqual(children) // same objects, recycled
    const first = arrows.group.children[0]
    expect(first.visible).toBe(true)
    expect(first.position.y).toBeCloseTo(0.005, 6) // on the floor (the geo-root sits at the floor)
    expect(first.rotation.y).toBeCloseTo(0, 6) // north: no turn
    for (const mesh of first.children) {
      expect(mesh.material.depthTest).toBe(false)
      expect(mesh.renderOrder).toBeGreaterThanOrEqual(GROUND_ARROWS.renderOrder)
    }
    const fill = first.children[2].geometry
    fill.computeBoundingBox()
    expect(fill.boundingBox.max.x - fill.boundingBox.min.x).toBeCloseTo(0.5, 2) // 0.5 m wide
    expect(fill.boundingBox.max.y - fill.boundingBox.min.y).toBeCloseTo(0, 6) // flat
  })
  it('follows the ground slope, and hides everything when told to', () => {
    const arrows = createGroundArrows(THREE)
    arrows.setRoute(straight)
    arrows.update({userS: 10, slope: 0.1, show: true})
    const items = arrows.group.children.filter((c) => c.visible)
    expect(items.at(-1).position.y).toBeGreaterThan(items[0].position.y) // uphill ahead
    arrows.update({userS: 10, slope: 0, show: false})
    expect(arrows.group.visible).toBe(false)
    expect(arrows.active).toBe(0)
  })
})

describe('only what reads as floor', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(60, 0.5, 0.05, 100)
    c.position.set(0, 1.4, 0)
    c.lookAt(0, 0, -6)
    c.updateMatrixWorld(true)
    return c
  }

  it('fades chevrons seen within 8° of the horizon, gone by 4°', () => {
    expect(angleFade(20)).toBe(1)
    expect(angleFade(8)).toBe(1)
    expect(angleFade(6)).toBeCloseTo(0.5, 6)
    expect(angleFade(4)).toBe(0)
    expect(angleFade(NaN)).toBe(0)
  })

  it('draws a soft shadow first, then the white edge, then the green; half-transparent on a guessed floor', () => {
    const arrows = createGroundArrows(THREE)
    arrows.setRoute(straight)
    arrows.update({userS: 0, show: true, opacity: 0.5, camera: camera()})
    const [shadow, edge, fill] = arrows.group.children[0].children
    expect(shadow.renderOrder).toBeLessThan(edge.renderOrder)
    expect(edge.renderOrder).toBeLessThan(fill.renderOrder)
    expect(fill.material.opacity).toBeCloseTo(0.5, 6)
    expect(shadow.material.opacity).toBeCloseTo(0.25 * 0.5, 6)
    expect(fill.material.color.getHex()).toBe(GROUND_ARROWS.green) // no glow, no pulse
  })

  it('never draws a chevron at or above eye level', () => {
    const arrows = createGroundArrows(THREE)
    arrows.setRoute(straight)
    const high = camera()
    high.position.y = 0.1 // the floor guess is wrong: the arrows would be level with the phone
    high.updateMatrixWorld(true)
    arrows.update({userS: 0, show: true, camera: high})
    expect(arrows.visible).toBe(0)
  })

  it('a blocked chevron hides it and every one after it, fading over about 0.3 s', () => {
    const arrows = createGroundArrows(THREE)
    arrows.setRoute(straight)
    const cam = camera()
    arrows.update({userS: 0, show: true, camera: cam, dt: 0.05})
    const before = arrows.visible
    const third = arrows.screenSpot(2, cam)
    expect(third).not.toBeNull()
    arrows.setBlocked(third.s, true)
    arrows.update({userS: 0, show: true, camera: cam, dt: 0.05})
    expect(arrows.blockedCount).toBe(arrows.active - 2) // the third and all beyond it
    expect(arrows.group.children[2].children[2].material.opacity).toBeGreaterThan(0.2) // not snapped off
    for (let i = 0; i < 10; i++) arrows.update({userS: 0, show: true, camera: cam, dt: 0.05})
    expect(arrows.visible).toBeLessThanOrEqual(2)
    expect(before).toBeGreaterThan(2)
    arrows.setBlocked(third.s, false)
    for (let i = 0; i < 10; i++) arrows.update({userS: 0, show: true, camera: cam, dt: 0.05})
    expect(arrows.visible).toBe(before)
  })
})
