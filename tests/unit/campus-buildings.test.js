import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {buildOccluder, buildingsToLocal, insetRing, insideRing} from '../../src/ar/campus-buildings.js'
import {beaconOpacity, beaconScale, createBeacon} from '../../src/ar/beacon.js'
import {createNavScene} from '../../src/ar/nav-scene.js'
import {fromLocal} from '../../src/geo/geo.js'
import {BEACON, BUILDINGS} from '../../src/config.js'

const ORIGIN = {lat: 56.1455, lng: -3.92}
const square = (x0, y0, size) => [
  {x: x0, y: y0},
  {x: x0 + size, y: y0},
  {x: x0 + size, y: y0 + size},
  {x: x0, y: y0 + size},
  {x: x0, y: y0},
]
/** A MazeMap-like building feature from a ring in the route frame. */
function feature(ring, props = {}) {
  const coordinates = [ring.map((p) => fromLocal(ORIGIN, p)).map(({lat, lng}) => [lng, lat])]
  return {type: 'Feature', properties: {id: 1, name: 'Cottrell Building', height: 16.4, ...props}, geometry: {type: 'Polygon', coordinates}}
}

describe('campus buildings in AR', () => {
  it('pulls an outline in by the inset, either way round', () => {
    for (const ring of [square(0, 0, 20), square(0, 0, 20).reverse()]) {
      const inner = insetRing(ring, 2)
      expect(inner).toHaveLength(4)
      const xs = inner.map((p) => p.x)
      const ys = inner.map((p) => p.y)
      expect(Math.min(...xs)).toBeCloseTo(2, 5)
      expect(Math.max(...xs)).toBeCloseTo(18, 5)
      expect(Math.min(...ys)).toBeCloseTo(2, 5)
      expect(Math.max(...ys)).toBeCloseTo(18, 5)
    }
  })
  it('knows when a point is inside an outline', () => {
    expect(insideRing({x: 5, y: 5}, square(0, 0, 10))).toBe(true)
    expect(insideRing({x: 15, y: 5}, square(0, 0, 10))).toBe(false)
  })
  it('turns MazeMap features into the route frame, inset, and leaves far ones out', () => {
    const near = feature(square(30, 30, 20))
    const far = feature(square(5000, 0, 20), {id: 2, name: 'Far away'})
    const buildings = buildingsToLocal({features: [near, far]}, ORIGIN)
    expect(buildings).toHaveLength(1)
    expect(buildings[0]).toMatchObject({name: 'Cottrell Building', heightM: 16.4})
    expect(buildings[0].centre.x).toBeCloseTo(40, 0)
    expect(buildings[0].centre.y).toBeCloseTo(40, 0)
    expect(Math.min(...buildings[0].inner.map((p) => p.x))).toBeCloseTo(30 + BUILDINGS.insetM, 0)
  })
  it('builds one depth-only mesh, from under the ground to the roof', () => {
    const buildings = buildingsToLocal({features: [feature(square(30, 30, 20)), feature(square(-60, 10, 10), {id: 2, height: 9})]}, ORIGIN)
    const mesh = buildOccluder(THREE, mergeGeometries, buildings)
    expect(mesh.material.colorWrite).toBe(false)
    expect(mesh.material.depthWrite).toBe(true)
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    expect(box.min.y).toBeCloseTo(-BUILDINGS.belowM, 3)
    expect(box.max.y).toBeCloseTo(16.4, 3)
    // North is -z in the geo root: the building at y 30..50 north lies at z -50..-30.
    expect(box.min.z).toBeLessThan(-45)
    expect(buildOccluder(THREE, mergeGeometries, [])).toBeNull()
  })
})

describe('the destination beacon', () => {
  it('is gone close by, where the pin is, and fully there further away', () => {
    expect(beaconOpacity(BEACON.hideWithinM - 1)).toBe(0)
    expect(beaconOpacity(BEACON.fadeInM + 1)).toBe(1)
    expect(beaconOpacity((BEACON.hideWithinM + BEACON.fadeInM) / 2)).toBeCloseTo(0.5, 5)
  })
  it('keeps its width on screen far away', () => {
    expect(beaconScale(10)).toBe(1)
    expect(beaconScale(BEACON.constantWidthFromM * 3)).toBeCloseTo(3, 5)
  })
  it('stands over the entrance in the brand green, depth-tested', () => {
    const b = createBeacon(THREE)
    b.update(0, 200)
    expect(b.group.visible).toBe(true)
    const pillar = b.group.getObjectByName('beacon-pillar')
    expect(pillar.material.depthTest).toBe(true)
    expect(`#${pillar.material.uniforms.colour.value.getHexString()}`).toBe(BEACON.colour)
    b.update(0, 5)
    expect(b.group.visible).toBe(false)
    b.update(0, 200, false)
    expect(b.group.visible).toBe(false)
    b.dispose()
  })
})

describe('the AR scene with the campus', () => {
  function makeScene() {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 1.4, 0)
    camera.lookAt(0, 1.4, -1)
    camera.updateMatrixWorld(true)
    const route = {points: [ORIGIN, fromLocal(ORIGIN, {x: 0, y: 100}), fromLocal(ORIGIN, {x: 0, y: 200})], lengthM: 200, entrance: fromLocal(ORIGIN, {x: 0, y: 200})}
    const nav = createNavScene({THREE, scene, camera, route, origin: ORIGIN, name: 'Library'})
    nav.align(0, ORIGIN)
    return {scene, camera, nav}
  }
  it('adds the occluder, shown only with the walls occluder on and the user outside', () => {
    const {scene, camera, nav} = makeScene()
    expect(nav.setBuildings({features: [feature(square(20, 40, 20))]})).toBe(1)
    const occ = scene.getObjectByName('campus-occluder')
    expect(occ.visible).toBe(false)
    nav.setOccluder(true)
    nav.update(0.016, 1)
    expect(occ.visible).toBe(true)
    // Walk into the building: its occluder would hide everything, so it goes.
    camera.position.set(30, 1.4, -50)
    camera.updateMatrixWorld(true)
    nav.update(0.016, 1.1)
    expect(nav.insideBuilding).toBe(true)
    expect(occ.visible).toBe(false)
    nav.dispose()
  })
  it('shows the beacon over the entrance when far from it', () => {
    const {nav} = makeScene()
    nav.update(0.016, 1)
    expect(nav.beaconShown).toBe(true)
    nav.setVisible(false)
    nav.update(0.016, 1.1)
    expect(nav.beaconShown).toBe(false)
    nav.dispose()
  })
})
