// The 3D campus model (public/data/stirling_campus.glb) drawn on the MazeMap map with three.js,
// as a Mapbox GL custom layer that shares the map's WebGL context.
//
// - Only the floor the map shows is drawn in each building, with its walls. A building without
//   that floor shows its nearest floor below, as a plan with no walls.
// - The drawn floor sits on the map, so its rooms lie on MazeMap's own room outlines at any tilt.
// - highlight(poiId) colours and raises one room, found through the poiId at the end of its name.
// - The map redraws only when it moves or something here changes: no render loop of our own.
//
// Loaded on demand (dynamic import), so three.js stays out of the map screen's first download.
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {CAMPUS_ORIGIN, floorLevelOf, floorPartOf, floorToShow, poiIdOf} from './campus-geo.js'

export const CAMPUS_MODEL_URL = '/data/stirling_campus.glb'
const LAYER_ID = 'campus-model-3d'
const HIGHLIGHT = {color: 0xe8175d, liftM: 0.6} // a pink no room category uses

/**
 * Add the campus model to a MazeMap map. Resolves once the model is loaded and drawn.
 * @param map       a Mazemap.Map (Mapbox GL inside)
 * @param mapboxgl  Mazemap.mapboxgl, for MercatorCoordinate
 */
export async function createCampusModel(map, mapboxgl) {
  const gltf = await new GLTFLoader().loadAsync(CAMPUS_MODEL_URL)
  const campus = gltf.scene.getObjectByName('Campus')
  if (!campus) throw new Error('campus model has no Campus node')
  campus.updateMatrixWorld(true)

  const materials = new Map() // GLB material name -> our flat-shaded material
  const materialFor = (source) => {
    if (!materials.has(source.name)) {
      // The model has no normals: flat shading works them out per face, so walls still read as walls.
      materials.set(source.name, new THREE.MeshLambertMaterial({color: source.color.clone(), flatShading: true}))
    }
    return materials.get(source.name)
  }

  // Everything below is in the model's raw frame (x east, y north, z up); `raw` turns it Y-up.
  const raw = new THREE.Group()
  raw.matrixAutoUpdate = false
  raw.matrix.copy(campus.matrixWorld)
  const buildingsLift = new THREE.Group() // lowers the shown floor to the ground
  buildingsLift.add(raw)
  const outdoor = new THREE.Group()
  outdoor.matrixAutoUpdate = false
  outdoor.matrix.copy(campus.matrixWorld)

  const buildings = [] // {name, floors: [{level, group, walls: [mesh], baseZ}]}
  const rooms = new Map() // poiId -> {geometry, level, building}
  const baseByLevel = new Map() // floor level -> height of its slab above the model origin
  const inverseCampus = campus.matrixWorld.clone().invert()
  const rawGeometry = (mesh) => mesh.geometry.clone().applyMatrix4(inverseCampus.clone().multiply(mesh.matrixWorld))

  for (const buildingNode of campus.children) {
    if (buildingNode.name === 'Outdoor') {
      const byMaterial = new Map()
      buildingNode.traverse((o) => o.isMesh && pushTo(byMaterial, o.material, rawGeometry(o)))
      addMerged(outdoor, byMaterial, materialFor)
      continue
    }
    const building = {name: buildingNode.name, floors: []}
    for (const floorNode of buildingNode.children) {
      const level = floorLevelOf(floorNode.name)
      if (level == null) continue
      const group = new THREE.Group()
      group.name = floorNode.name
      const walls = []
      const roomsByMaterial = new Map()
      let baseZ = Infinity
      floorNode.traverse((o) => {
        if (!o.isMesh) return
        const geometry = rawGeometry(o)
        const part = floorPartOf(o.name)
        const poiId = poiIdOf(o.name)
        if (part) {
          const mesh = new THREE.Mesh(geometry, materialFor(o.material))
          group.add(mesh)
          if (part === 'walls' || part === 'lintels') walls.push(mesh)
          if (part === 'slab') {
            geometry.computeBoundingBox()
            baseZ = Math.min(baseZ, geometry.boundingBox.max.z)
          }
        } else {
          pushTo(roomsByMaterial, o.material, geometry)
          if (poiId) rooms.set(poiId, {geometry, level, building: building.name})
        }
      })
      addMerged(group, roomsByMaterial, materialFor)
      if (Number.isFinite(baseZ) && !baseByLevel.has(level)) baseByLevel.set(level, baseZ)
      group.visible = false
      raw.add(group)
      building.floors.push({level, group, walls})
    }
    if (building.floors.length) buildings.push(building)
  }
  disposeGltf(gltf)

  // ---------- three.js inside Mapbox ----------
  const anchor = mapboxgl.MercatorCoordinate.fromLngLat([CAMPUS_ORIGIN.lng, CAMPUS_ORIGIN.lat], 0)
  const scale = anchor.meterInMercatorCoordinateUnits()
  // As in Mapbox's "Add a 3D model" example: Y-up model, -Z points north.
  const modelToMercator = new THREE.Matrix4()
    .makeTranslation(anchor.x, anchor.y, anchor.z)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))

  const scene = new THREE.Scene()
  scene.add(buildingsLift, outdoor)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(-0.5, 1, 0.8) // high, from the south-west (model frame: y up, -z north)
  scene.add(sun)
  const camera = new THREE.Camera()
  let renderer = null
  let visible = false
  let level = null
  let highlighted = null // {poiId, mesh}

  const layer = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      renderer = new THREE.WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true})
      renderer.autoClear = false
    },
    render(_gl, matrix) {
      if (!visible || !renderer) return
      camera.projectionMatrix.fromArray(matrix).multiply(modelToMercator)
      renderer.resetState()
      renderer.render(scene, camera)
    },
    onRemove() {
      renderer?.dispose()
      renderer = null
    },
  }
  // Above MazeMap's indoor fills (mm-rooms, mm-walls-extrusion…), under its route and room
  // labels, so names and POI icons stay readable on top of the model.
  const ids = map.getStyle()?.layers?.map((l) => l.id) ?? []
  const beforeId = ids.find((id) => /^mm-(route|poi-label|building-label|campus-dot)/.test(id))
  map.addLayer(layer, beforeId)

  // ---------- floors ----------
  function applyLevel() {
    level = currentLevel(map)
    for (const building of buildings) {
      const shown = floorToShow(building.floors.map((f) => f.level), level)
      for (const floor of building.floors) {
        floor.group.visible = floor.level === shown
        // Walls only on the floor the map shows: other buildings' fallback floors are plans.
        for (const wall of floor.walls) wall.visible = floor.level === level
      }
    }
    // The model stacks floors 3.5 m apart. Lower the shown floor to the ground, so it lies on
    // MazeMap's room outlines when the map is tilted too.
    const base = baseByLevel.get(level) ?? 0
    buildingsLift.position.set(0, -base, 0)
    buildingsLift.updateMatrixWorld(true)
    map.triggerRepaint()
  }
  const onZLevel = () => applyLevel()
  map.on('zlevel', onZLevel)
  applyLevel()

  // ---------- the destination ----------
  const highlightMaterial = new THREE.MeshLambertMaterial({
    color: HIGHLIGHT.color,
    emissive: HIGHLIGHT.color,
    emissiveIntensity: 0.35,
    flatShading: true,
  })

  function clearHighlight() {
    if (!highlighted) return
    highlighted.mesh.removeFromParent()
    highlighted = null
  }

  /** Colour and raise the room with this poiId. Returns its floor level, or null if the model has no such room. */
  function highlight(poiId) {
    const key = poiId == null ? null : String(poiId)
    if (highlighted?.poiId === key) return rooms.get(key)?.level ?? null
    clearHighlight()
    const room = key && rooms.get(key)
    if (!room) {
      map.triggerRepaint()
      return null
    }
    const mesh = new THREE.Mesh(room.geometry, highlightMaterial)
    mesh.position.z = HIGHLIGHT.liftM // raw frame: z is up
    const floor = buildings.find((b) => b.name === room.building)?.floors.find((f) => f.level === room.level)
    floor?.group.add(mesh)
    highlighted = {poiId: key, mesh}
    map.triggerRepaint()
    return room.level
  }

  return {
    rooms,
    get level() {
      return level
    },
    get visible() {
      return visible
    },
    setVisible(value) {
      visible = Boolean(value)
      map.triggerRepaint()
    },
    highlight,
    /** 1: solid (normal). Less, to see MazeMap's floor plan through the model (?debug=align). */
    setOpacity(value) {
      const opacity = Math.max(0, Math.min(1, Number(value)))
      for (const m of [...materials.values(), highlightMaterial]) {
        m.transparent = opacity < 1
        m.opacity = opacity
        m.depthWrite = opacity >= 1 // see-through walls must not hide the floor behind them
        m.needsUpdate = true
      }
      map.triggerRepaint()
    },
    clearHighlight() {
      clearHighlight()
      map.triggerRepaint()
    },
    /** Meshes drawn now, for tests and the debug console. */
    stats() {
      let meshes = 0
      scene.traverseVisible((o) => o.isMesh && meshes++)
      return {meshes, rooms: rooms.size, level, visible, highlighted: highlighted?.poiId ?? null}
    },
    destroy() {
      map.off('zlevel', onZLevel)
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      } catch {
        // the map is already gone
      }
      scene.traverse((o) => o.geometry?.dispose())
      for (const room of rooms.values()) room.geometry.dispose()
      for (const m of materials.values()) m.dispose()
      highlightMaterial.dispose()
    },
  }
}

function currentLevel(map) {
  const z = typeof map.getZLevel === 'function' ? map.getZLevel() : map.zLevel
  return Number.isFinite(z) ? z : 1
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}

/** One mesh per material: a floor's hundreds of rooms cost a handful of draw calls. */
function addMerged(parent, byMaterial, materialFor) {
  for (const [source, geometries] of byMaterial) {
    const merged = geometries.length === 1 ? geometries[0].clone() : mergeGeometries(geometries, false)
    if (merged) parent.add(new THREE.Mesh(merged, materialFor(source)))
    else for (const g of geometries) parent.add(new THREE.Mesh(g.clone(), materialFor(source)))
  }
}

function disposeGltf(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    for (const m of [o.material].flat()) m.dispose()
  })
}
