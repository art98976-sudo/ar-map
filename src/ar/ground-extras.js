// What lies on the floor with the chevrons: a translucent strip along the path, and a ring at each
// corner that fills as the user comes to it. Both follow the chevrons' rules (same line, range,
// floor height, distance and horizon fades, and hiding behind walls). Fixed meshes updated in
// place; nothing is created per frame. Route frame {x east, y north}; geo-root x, y up, z = -north.
import {pointAt, polylineLength} from '../geo/geo.js'
import {GROUND_ARROWS, GROUND_EXTRAS} from '../config.js'

/**
 * Centre-line samples for the strip: [{x, y, s, d, nx, ny}] every `step` m from `from` to
 * from + aheadM on the rounded line, with the unit normal (to the right). Pure.
 */
export function stripSamples(rounded, from, {aheadM = GROUND_ARROWS.aheadM, step = GROUND_EXTRAS.stripStepM, startM = GROUND_EXTRAS.stripStartM} = {}) {
  if (rounded.length < 2 || !Number.isFinite(from)) return []
  const total = polylineLength(rounded)
  const out = []
  for (let d = startM; d <= aheadM + 1e-9 && from + d <= total; d += step) {
    const s = from + d
    const a = pointAt(rounded, Math.max(0, s - 0.2))
    const b = pointAt(rounded, Math.min(total, s + 0.2))
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const at = pointAt(rounded, s)
    out.push({x: at.x, y: at.y, s, d, nx: (b.y - a.y) / len, ny: -(b.x - a.x) / len})
  }
  return out
}

/** How full a corner ring is: 0 at the edge of the range, 1 at the corner. */
export function ringFill(d, aheadM = GROUND_ARROWS.aheadM) {
  if (!Number.isFinite(d)) return 0
  return Math.max(0, Math.min(1, 1 - d / aheadM))
}

/** The strip: one mesh whose vertices are rewritten each frame. */
export function createPathStrip(THREE) {
  const max = Math.ceil(GROUND_ARROWS.aheadM / GROUND_EXTRAS.stripStepM) + 2
  const positions = new Float32Array(max * 2 * 3)
  const colours = new Float32Array(max * 2 * 4)
  const index = []
  for (let i = 0; i < max - 1; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4))
  geometry.setIndex(index)
  geometry.setDrawRange(0, 0)
  const material = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide})
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'path-strip'
  mesh.renderOrder = GROUND_ARROWS.renderOrder - 1 // under the shadows and the chevrons
  mesh.frustumCulled = false
  mesh.visible = false
  const colour = new THREE.Color(GROUND_ARROWS.green)
  const half = GROUND_EXTRAS.stripWidthM / 2

  return {
    mesh,
    /**
     * samples: from stripSamples. heightAt(s) and alphaAt(sample) give each sample's height above
     * the geo-root floor and its opacity (fades, blocking), from the chevron rules.
     */
    update(samples, heightAt, alphaAt) {
      const n = Math.min(samples.length, max)
      for (let i = 0; i < n; i++) {
        const q = samples[i]
        const y = heightAt(q.s) + 0.003
        const alpha = GROUND_EXTRAS.stripOpacity * alphaAt(q)
        positions.set([q.x - q.nx * half, y, -(q.y - q.ny * half), q.x + q.nx * half, y, -(q.y + q.ny * half)], i * 6)
        for (let k = 0; k < 2; k++) colours.set([colour.r, colour.g, colour.b, alpha], (i * 2 + k) * 4)
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.setDrawRange(0, Math.max(0, n - 1) * 6)
      mesh.visible = n >= 2
      return n
    },
    hide() {
      mesh.visible = false
      geometry.setDrawRange(0, 0)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Corner rings: a thin ring on the floor and a disc inside it that grows as the user nears. */
export function createTurnRings(THREE) {
  const {ringRadiusM: r, ringLineM: line} = GROUND_EXTRAS
  const ringGeo = new THREE.RingGeometry(r - line, r, 48)
  const discGeo = new THREE.CircleGeometry(r - line, 48)
  ringGeo.rotateX(-Math.PI / 2)
  discGeo.rotateX(-Math.PI / 2)
  const flat = {transparent: true, depthTest: false, depthWrite: false}
  const pool = Array.from({length: GROUND_EXTRAS.ringPool}, (_, i) => {
    const group = new THREE.Group()
    group.name = `turn-ring-${i}`
    const ringMat = new THREE.MeshBasicMaterial({...flat, color: 0xffffff})
    const discMat = new THREE.MeshBasicMaterial({...flat, color: GROUND_EXTRAS.ringGreen})
    const ring = new THREE.Mesh(ringGeo, ringMat)
    const disc = new THREE.Mesh(discGeo, discMat)
    ring.renderOrder = GROUND_ARROWS.renderOrder + 3
    disc.renderOrder = GROUND_ARROWS.renderOrder - 1
    group.add(disc, ring)
    group.visible = false
    return {group, ringMat, discMat, disc}
  })
  return {
    groups: pool.map((slot) => slot.group),
    /** corners: [{x, y, d, height, alpha}] for the corners within range, nearest first. */
    update(corners) {
      let shown = 0
      pool.forEach((slot, i) => {
        const c = corners[i]
        if (!c || c.alpha <= 0.01) {
          slot.group.visible = false
          return
        }
        shown += 1
        slot.group.visible = true
        slot.group.position.set(c.x, c.height + 0.004, -c.y)
        slot.disc.scale.setScalar(Math.max(0.05, ringFill(c.d)))
        slot.ringMat.opacity = c.alpha
        slot.discMat.opacity = c.alpha * GROUND_EXTRAS.ringFillOpacity
      })
      return shown
    },
    hide() {
      for (const slot of pool) slot.group.visible = false
    },
    dispose() {
      ringGeo.dispose()
      discGeo.dispose()
      for (const slot of pool) {
        slot.ringMat.dispose()
        slot.discMat.dispose()
      }
    },
  }
}
