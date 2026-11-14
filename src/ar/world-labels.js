// B4: names pinned to the real campus in AR. Each building's name floats above its roof; each
// named entrance has a small label at the door, shown only near it. Labels always face the user,
// keep a readable size on screen (bigger in the world the further they are), and never overlap:
// a few times a second they are laid out on screen, the destination's and the nearest first, and
// any that would cover one already placed fades out. Their depth test is on, so the campus
// occluders hide them behind other buildings.
//
// Route frame: {x east, y north} metres. Geo-root: x = east, y = up, z = -north.
import {toLocal} from '../geo/geo.js'
import {LABELS} from '../config.js'

/** "main entrance" -> "Main entrance". */
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * The named doors of these places, in the route frame: [{text, x, y}]. One label per door (two
 * places sharing a door are named once). Pure.
 */
export function entranceLabels(places, origin, entrancesOf, withinM = LABELS.withinM) {
  const out = []
  for (const place of places) {
    for (const door of entrancesOf(place)) {
      if (!door.name || !Number.isFinite(door.lat)) continue
      const p = toLocal(origin, door)
      if (Math.hypot(p.x, p.y) > withinM) continue
      if (out.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < LABELS.sameDoorM)) continue
      out.push({text: `${place.name} · ${capital(door.name)}`, x: p.x, y: p.y})
    }
  }
  return out
}

/** How tall to draw a label at this distance (metres in the world): a steady size on screen. */
export function labelHeightM(distanceM, kind = 'building') {
  const k = kind === 'entrance' ? LABELS.entranceScreen : LABELS.buildingScreen
  return Math.max(LABELS.minHeightM, Math.min(LABELS.maxHeightM, distanceM * k))
}

/**
 * Which labels to show: greedy, in priority order, skipping any whose screen box overlaps one
 * already kept. boxes: [{id, x0, y0, x1, y1, priority}] in pixels. Returns the kept ids. Pure.
 */
export function layoutLabels(boxes, gapPx = LABELS.gapPx) {
  const kept = []
  for (const b of [...boxes].sort((a, c) => a.priority - c.priority)) {
    const clash = kept.some((k) => b.x0 < k.x1 + gapPx && b.x1 + gapPx > k.x0 && b.y0 < k.y1 + gapPx && b.y1 + gapPx > k.y0)
    if (!clash) kept.push(b)
  }
  return new Set(kept.map((b) => b.id))
}

/** A label board: white text on the brand green (building) or on dark glass (entrance). */
function makeBoard(THREE, text, kind, doc = globalThis.document) {
  const canvas = doc?.createElement?.('canvas')
  const ctx = canvas?.getContext?.('2d')
  const fontPx = 48
  const pad = 22
  let aspect = Math.max(2, text.length * 0.55)
  let texture = null
  if (ctx) {
    ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
    canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2)
    canvas.height = fontPx + pad * 2
    ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`
    ctx.fillStyle = kind === 'entrance' ? 'rgba(15, 23, 20, 0.78)' : LABELS.buildingColour
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2)
    else ctx.rect(0, 0, canvas.width, canvas.height)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, pad, canvas.height / 2)
    texture = new THREE.CanvasTexture(canvas)
    aspect = canvas.width / canvas.height
  }
  const material = new THREE.MeshBasicMaterial({map: texture, color: texture ? 0xffffff : LABELS.buildingColour, transparent: true, depthWrite: false, depthTest: true, opacity: 0})
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), material)
  mesh.renderOrder = LABELS.renderOrder
  mesh.visible = false
  return mesh
}

/**
 * @param THREE three.js
 * @param o.parent the geo root (labels move with the route's placement)
 * @param o.buildings route-frame buildings (campus-buildings.js buildingsToLocal)
 * @param o.entrances route-frame doors (entranceLabels)
 * @param o.destinationName the place's building name: its label is laid out first
 */
export function createWorldLabels(THREE, {parent, buildings = [], entrances = [], destinationName = ''}) {
  const items = [
    ...buildings.filter((b) => b.name).map((b, i) => ({id: `b${i}`, kind: 'building', text: b.name, x: b.centre.x, y: b.centre.y, h: b.heightM + LABELS.aboveRoofM, mine: b.name === destinationName})),
    ...entrances.map((e, i) => ({id: `e${i}`, kind: 'entrance', text: e.text, x: e.x, y: e.y, h: LABELS.entranceHeightM, mine: false})),
  ]
  const group = new THREE.Group()
  group.name = 'world-labels'
  parent.add(group)
  for (const item of items) {
    item.mesh = makeBoard(THREE, item.text, item.kind)
    item.mesh.position.set(item.x, item.h, -item.y)
    item.shown = 0 // 0..1, eased
    item.wanted = false
    group.add(item.mesh)
  }
  const world = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const ndc = new THREE.Vector3()
  let layoutAt = -Infinity
  let visible = true

  function layout(camera, size) {
    camera.getWorldPosition(camPos)
    const boxes = []
    for (const item of items) {
      item.mesh.getWorldPosition(world)
      const d = Math.hypot(world.x - camPos.x, world.z - camPos.z)
      item.distanceM = d
      const near = item.kind === 'entrance' ? d <= LABELS.entranceWithinM : d <= LABELS.buildingWithinM && d >= LABELS.buildingMinM
      if (!near) continue
      ndc.copy(world).project(camera)
      if (ndc.z > 1 || Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) continue // behind or off screen
      const hM = labelHeightM(d, item.kind)
      // On-screen size: the board's height in pixels from the camera's vertical field of view.
      const pxPerM = size.height / (2 * d * Math.tan(((camera.fov ?? 60) * Math.PI) / 360))
      const hPx = hM * pxPerM
      const wPx = hPx * item.mesh.geometry.parameters.width
      const cx = ((ndc.x + 1) / 2) * size.width
      const cy = ((1 - ndc.y) / 2) * size.height
      boxes.push({id: item.id, x0: cx - wPx / 2, x1: cx + wPx / 2, y0: cy - hPx / 2, y1: cy + hPx / 2, priority: (item.mine ? -1e6 : 0) + d})
    }
    const keep = layoutLabels(boxes)
    for (const item of items) item.wanted = keep.has(item.id)
  }

  return {
    group,
    get count() {
      return items.length
    },
    /** How many are on screen now (opacity over half). */
    get shownCount() {
      return items.filter((i) => i.mesh.visible && i.shown > 0.5).length
    },
    setVisible(on) {
      visible = Boolean(on)
    },
    /** Each frame. size: the canvas in pixels {width, height}. */
    update(dt, time, camera, size) {
      if (!visible) {
        for (const item of items) item.wanted = false
      } else if (time - layoutAt >= LABELS.layoutEveryS) {
        layoutAt = time
        layout(camera, size)
      }
      camera.getWorldPosition(camPos)
      const k = 1 - Math.exp(-dt / LABELS.fadeS)
      for (const item of items) {
        item.shown += ((item.wanted ? 1 : 0) - item.shown) * k
        item.mesh.visible = item.shown > 0.02
        if (!item.mesh.visible) continue
        item.mesh.material.opacity = item.shown
        const hM = labelHeightM(item.distanceM ?? LABELS.buildingWithinM, item.kind)
        item.mesh.scale.set(hM, hM, 1)
        // Upright, turned to face the user.
        item.mesh.getWorldPosition(world)
        item.mesh.lookAt(camPos.x, world.y, camPos.z)
      }
    },
    dispose() {
      parent.remove(group)
      for (const item of items) {
        item.mesh.geometry.dispose()
        item.mesh.material.map?.dispose()
        item.mesh.material.dispose()
      }
    },
  }
}
