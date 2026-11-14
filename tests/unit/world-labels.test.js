import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {createWorldLabels, entranceLabels, labelHeightM, layoutLabels} from '../../src/ar/world-labels.js'
import {entrancesOf} from '../../src/route/start-point.js'
import {fromLocal} from '../../src/geo/geo.js'
import {LABELS} from '../../src/config.js'

const ORIGIN = {lat: 56.1455, lng: -3.92}

describe('B4: names in AR', () => {
  it('names each door once, near the trip', () => {
    const door = fromLocal(ORIGIN, {x: 20, y: 30})
    const places = [
      {name: 'Cottrell Building', category: 'building', lat: door.lat, lng: door.lng, entrances: [{id: 'main', name: 'main entrance', ...door}]},
      {name: 'Atrium', category: 'building', lat: door.lat, lng: door.lng, entrances: [{id: 'a', name: 'east door', ...fromLocal(ORIGIN, {x: 21, y: 30})}]},
      {name: 'Far', category: 'building', lat: 56.2, lng: -3.92, entrances: [{id: 'f', name: 'door', lat: 56.2, lng: -3.92}]},
    ]
    const labels = entranceLabels(places, ORIGIN, entrancesOf)
    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe('Cottrell Building · Main entrance')
    expect(labels[0].x).toBeCloseTo(20, 0)
  })
  it('keeps a steady size on screen, within limits', () => {
    expect(labelHeightM(100)).toBeCloseTo(100 * LABELS.buildingScreen, 5)
    expect(labelHeightM(1)).toBe(LABELS.minHeightM)
    expect(labelHeightM(1e6)).toBe(LABELS.maxHeightM)
  })
  it('never overlaps: the first in priority stays, one that would cover it goes', () => {
    const keep = layoutLabels([
      {id: 'far', x0: 100, x1: 200, y0: 100, y1: 130, priority: 300},
      {id: 'near', x0: 150, x1: 250, y0: 110, y1: 140, priority: 50},
      {id: 'apart', x0: 400, x1: 500, y0: 100, y1: 130, priority: 400},
    ])
    expect([...keep].sort()).toEqual(['apart', 'near'])
  })
  it('stands the building names above their roofs, facing the user, and shows those in view', () => {
    const scene = new THREE.Scene()
    const parent = new THREE.Group()
    scene.add(parent)
    const camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.1, 2000)
    camera.position.set(0, 1.5, 0)
    camera.lookAt(0, 1.5, -1)
    camera.updateMatrixWorld(true)
    const buildings = [
      {name: 'Library', heightM: 16, centre: {x: 0, y: 120}},
      {name: 'Behind me', heightM: 10, centre: {x: 0, y: -120}},
    ]
    const labels = createWorldLabels(THREE, {parent, buildings, destinationName: 'Library'})
    expect(labels.count).toBe(2)
    for (let t = 0; t < 2; t += 0.05) labels.update(0.05, t, camera, {width: 390, height: 844})
    expect(labels.shownCount).toBe(1)
    const lib = labels.group.children[0]
    expect(lib.position.y).toBeCloseTo(16 + LABELS.aboveRoofM, 5)
    expect(lib.material.depthTest).toBe(true)
    labels.setVisible(false)
    for (let t = 2; t < 4; t += 0.05) labels.update(0.05, t, camera, {width: 390, height: 844})
    expect(labels.shownCount).toBe(0)
    labels.dispose()
    expect(parent.children).toHaveLength(0)
  })
})
