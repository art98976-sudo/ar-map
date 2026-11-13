import * as THREE from 'three'
import {describe, expect, it} from 'vitest'
import {createNavScene} from '../../src/ar/nav-scene.js'
import {buildScene} from '../../src/scene/scene-data.js'
import {fitRoute} from '../../src/scene/fit-route.js'
import {fromLocal} from '../../src/geo/geo.js'

const origin = {lat: 56.1448, lng: -3.9205}
const toLL = ([x, y]) => {
  const p = fromLocal(origin, {x, y})
  return [p.lng, p.lat]
}
const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(toLL)]
const ll = (x, y, z) => ({...fromLocal(origin, {x, y}), z})
// A wall across the way at y = 6, with a 0.9 m door in it at x = 0.
const floor = {
  walls: [{id: 1, polygon: rect(-10, 6, -0.45, 6.2)}, {id: 2, polygon: rect(0.45, 6, 10, 6.2)}],
  doors: [{id: 3, line: [toLL([-0.45, 6.1]), toLL([0.45, 6.1])]}],
  rooms: [], outlines: [{id: 4, polygon: rect(-20, -20, 20, 30)}], labels: [], stairs: [], lifts: [],
}

describe('walls and doors in AR (Step 4)', () => {
  const scene = buildScene({route: [ll(0, 0, 1), ll(0.3, 12, 1)], origin, floors: {1: floor}})
  const fitted = fitRoute(scene)
  const camera = new THREE.PerspectiveCamera()
  const world = new THREE.Scene()
  const nav = createNavScene({THREE, scene: world, camera, route: {points: fitted.latlng, entrance: fitted.latlng.at(-1)}, origin})
  nav.setShellFloor({...scene.floors[1], level: 1})

  it('walls from the scene, as an occluder that is off until switched on', () => {
    expect(nav.shellLoaded).toBe(true)
    const occluder = world.getObjectByName('shell-occluder')
    expect(occluder.visible).toBe(false)
    nav.setOccluder(true)
    expect(occluder.visible).toBe(true)
    nav.setOccluder(false)
    expect(occluder.visible).toBe(false)
  })

  it('a soft outline across the doorway within 10 m, at the real door width', () => {
    expect(nav.updateDoorways(0)).toBe(1)
    const line = world.getObjectByName('doorway-0')
    expect(line.visible).toBe(true)
    expect(line.material.opacity).toBeLessThan(0.85) // soft
    const p = line.geometry.attributes.position
    expect(Math.hypot(p.getX(1) - p.getX(0), p.getZ(1) - p.getZ(0))).toBeCloseTo(0.9, 1) // the door's width
  })

  it('no outline for a door more than 10 m ahead', () => {
    expect(nav.updateDoorways(-5)).toBe(0) // 11.1 m ahead
  })
})
