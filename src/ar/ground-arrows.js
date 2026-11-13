// The way to walk, drawn on the real floor: flat green chevrons with a white edge and a soft
// shadow, one every 1 m along the next 10 m of the route, inside the AR scene geo-root group.
// Being 3D objects in the world, the real camera gives them perspective and they stay on the floor.
//
// They are laid along the same polyline the map draws, with each corner rounded (about 1 m
// radius), so the line of arrows itself bends left or right: that bend is the only turn signal.
// Chevrons are anchored to fixed spots along the route, so they do not slide as the user walks;
// the ones left behind are recycled ahead. A fixed pool of meshes is made once; nothing is
// created per frame. A chevron behind a wall or furniture (hit tests, in trip.js) fades out.
//
// Route frame: {x east, y north} metres. Geo-root: x = east, y = up, z = -north.
import {localBearing, pointAt, polylineLength, projectOntoPolyline, toRad} from '../geo/geo.js'
import {GROUND_ARROWS, GROUND_EXTRAS} from '../config.js'
import {createPathStrip, createTurnRings, stripSamples} from './ground-extras.js'

/** Round every corner of a polyline (about `radius` m), as a list of points. Pure. */
export function roundCorners(points, radius = GROUND_ARROWS.cornerRadiusM, steps = GROUND_ARROWS.cornerSteps) {
  if (points.length < 3) return points.map((p) => ({x: p.x, y: p.y}))
  const out = [{x: points[0].x, y: points[0].y}]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
    const lenOut = Math.hypot(c.x - b.x, c.y - b.y)
    if (lenIn < 1e-6 || lenOut < 1e-6) continue
    const u = {x: (b.x - a.x) / lenIn, y: (b.y - a.y) / lenIn}
    const v = {x: (c.x - b.x) / lenOut, y: (c.y - b.y) / lenOut}
    const turn = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) // 0 = straight on
    if (turn < toRad(GROUND_ARROWS.minCornerDeg)) {
      out.push({x: b.x, y: b.y})
      continue
    }
    // A circle of this radius touching both legs meets them this far from the corner.
    const cut = Math.min(radius * Math.tan(turn / 2), lenIn * 0.45, lenOut * 0.45)
    const p0 = {x: b.x - u.x * cut, y: b.y - u.y * cut}
    const p2 = {x: b.x + v.x * cut, y: b.y + v.y * cut}
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const m = 1 - t
      out.push({x: m * m * p0.x + 2 * m * t * b.x + t * t * p2.x, y: m * m * p0.y + 2 * m * t * b.y + t * t * p2.y})
    }
  }
  out.push({x: points.at(-1).x, y: points.at(-1).y})
  return out
}

/** How opaque a chevron is at `d` metres ahead: solid near the user, gone by GROUND_ARROWS.aheadM. */
export function fadeAt(d) {
  const {solidM, aheadM} = GROUND_ARROWS
  if (d <= solidM) return 1
  return Math.max(0, 1 - (d - solidM) / (aheadM - solidM))
}

/**
 * Where the chevrons go: [{x, y, bearingDeg, d, s}] on the rounded line, at fixed spots every
 * spacing m along it, from just ahead of `userS` (on the original route) to aheadM further on.
 * Pure: the same inputs always give the same chevrons.
 */
export function chevronSpots(route, rounded, userS, {spacing = GROUND_ARROWS.spacingM, aheadM = GROUND_ARROWS.aheadM, nearM = GROUND_ARROWS.nearM} = {}) {
  if (rounded.length < 2 || !Number.isFinite(userS)) return []
  const total = polylineLength(rounded)
  const from = projectOntoPolyline(rounded, pointAt(route, Math.max(0, userS))).s
  const spots = []
  for (let s = Math.ceil((from + nearM) / spacing) * spacing; s <= Math.min(total, from + aheadM) + 1e-9; s += spacing) {
    const at = pointAt(rounded, s)
    const bearingDeg = localBearing(pointAt(rounded, Math.max(0, s - 0.3)), pointAt(rounded, Math.min(total, s + 0.3)))
    spots.push({x: at.x, y: at.y, bearingDeg, d: s - from, s})
  }
  return spots
}

/**
 * The chevron (pointing +Y, widthM wide, depthM deep), as [x, y] corners. Deeper than it is in
 * plan view on a screen, because seen along the floor it is squashed by perspective.
 */
export function chevronOutline() {
  const {widthM: w, depthM: d} = GROUND_ARROWS
  return [
    [0, d / 2], // tip
    [w / 2, -d / 2],
    [w / 2 - w * 0.22, -d / 2],
    [0, d / 2 - d * 0.52], // inner notch
    [-w / 2 + w * 0.22, -d / 2],
    [-w / 2, -d / 2],
  ]
}

/** The same polygon grown outwards by `t` metres all round (mitred corners, capped), for the edge. */
export function growPolygon(pts, t, miterLimit = 3) {
  const n = pts.length
  const area = pts.reduce((sum, [x, y], i) => sum + x * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * y, 0)
  const sign = area > 0 ? 1 : -1 // outward normals depend on the winding
  const normal = ([ax, ay], [bx, by]) => {
    const len = Math.hypot(bx - ax, by - ay) || 1
    return [(sign * (by - ay)) / len, (sign * -(bx - ax)) / len]
  }
  return pts.map((p, i) => {
    const n1 = normal(pts[(i - 1 + n) % n], p)
    const n2 = normal(p, pts[(i + 1) % n])
    let mx = n1[0] + n2[0]
    let my = n1[1] + n2[1]
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const k = Math.min(miterLimit, 1 / Math.max(1e-6, mx * n1[0] + my * n1[1]))
    return [p[0] + mx * t * k, p[1] + my * t * k]
  })
}

function shapeOf(THREE, pts) {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
}


/** 1 for a chevron well below the horizon, fading to 0 by GROUND_ARROWS.minAngleDeg / 2. */
export function angleFade(depressionDeg) {
  const full = GROUND_ARROWS.minAngleDeg
  const none = full / 2
  if (!Number.isFinite(depressionDeg) || depressionDeg <= none) return 0
  if (depressionDeg >= full) return 1
  const t = (depressionDeg - none) / (full - none)
  return t * t * (3 - 2 * t)
}

/** A soft dark blurred chevron on a transparent canvas, for the shadow under each arrow. */
function shadowTexture(THREE, outline) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  let ctx = null
  try {
    ctx = canvas?.getContext?.('2d') ?? null
  } catch {
    ctx = null // no canvas (tests): a plain dark shape instead
  }
  if (!ctx) return null
  const size = 128
  canvas.width = size
  canvas.height = size
  const span = GROUND_ARROWS.widthM * GROUND_ARROWS.shadowScale // metres across the texture
  const px = (m) => (m / span) * size
  // Draw the chevron far off the canvas and keep only its blurred shadow, which every browser does.
  const off = size * 4
  ctx.shadowColor = 'rgba(0,0,0,1)'
  ctx.shadowBlur = size * 0.09
  ctx.shadowOffsetX = off
  ctx.fillStyle = '#000'
  ctx.beginPath()
  outline.forEach(([x, y], i) => {
    const cx = size / 2 + px(x) - off
    const cy = size / 2 - px(y)
    if (i) ctx.lineTo(cx, cy)
    else ctx.moveTo(cx, cy)
  })
  ctx.closePath()
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}

/**
 * The pool and its drawing. update() once per frame with the user's s along the route, the
 * ground slope (height change per metre along the route), whether to show them, an opacity for
 * all of them (half while the floor is still a guess), and the camera (to keep them on the floor).
 */
export function createGroundArrows(THREE) {
  const group = new THREE.Group()
  group.name = 'ground-arrows'
  group.visible = false
  const outline = chevronOutline()
  const greenGeo = new THREE.ShapeGeometry(shapeOf(THREE, outline))
  const edgeGeo = new THREE.ShapeGeometry(shapeOf(THREE, growPolygon(outline, GROUND_ARROWS.edgeM)))
  const shadowSize = GROUND_ARROWS.widthM * GROUND_ARROWS.shadowScale
  const shadowGeo = new THREE.PlaneGeometry(shadowSize, shadowSize)
  // Lying flat: the shape's +Y (its point) becomes -Z, which the geo-root calls north.
  for (const g of [greenGeo, edgeGeo, shadowGeo]) g.rotateX(-Math.PI / 2)
  const shadowMap = shadowTexture(THREE, outline)
  const flat = {transparent: true, depthTest: false, depthWrite: false}

  const pool = Array.from({length: GROUND_ARROWS.poolSize}, (_, i) => {
    const item = new THREE.Group()
    item.name = `chevron-${i}`
    const shadowMat = new THREE.MeshBasicMaterial({...flat, color: 0x000000, map: shadowMap, opacity: GROUND_ARROWS.shadowOpacity})
    const edgeMat = new THREE.MeshBasicMaterial({...flat, color: 0xffffff})
    const fillMat = new THREE.MeshBasicMaterial({...flat, color: GROUND_ARROWS.green})
    const shadow = new THREE.Mesh(shadowGeo, shadowMat)
    const edge = new THREE.Mesh(edgeGeo, edgeMat)
    const fill = new THREE.Mesh(greenGeo, fillMat)
    // Over the camera image (depthTest off), in this order: shadow, white edge, green.
    shadow.renderOrder = GROUND_ARROWS.renderOrder
    edge.renderOrder = GROUND_ARROWS.renderOrder + 1
    fill.renderOrder = GROUND_ARROWS.renderOrder + 2
    item.add(shadow, edge, fill)
    item.visible = false
    group.add(item)
    return {item, shadowMat, edgeMat, fillMat, spot: null, alpha: 0}
  })

  // The strip under the chevrons and the corner rings: same line, range and rules.
  const strip = createPathStrip(THREE)
  const rings = createTurnRings(THREE)
  group.add(strip.mesh, ...rings.groups)
  const green = new THREE.Color(GROUND_ARROWS.green)
  const corner = new THREE.Color(GROUND_EXTRAS.cornerGreen)
  const pulse = new THREE.Color(GROUND_EXTRAS.pulseGreen)

  let route = []
  let rounded = []
  let turns = [] // corners of the route: [{x, y}] in the route frame
  let active = 0
  let visibleCount = 0
  let ringsShown = 0
  // Blocked state per spot along the route (its s), so it follows the spot, not the pool slot.
  const blocked = new Map() // sKey -> {target: 0|1 (1 = blocked), shown: 0..1 (1 = fully hidden), cascade}
  const keyOf = (s) => Math.round(s * 100)
  const p = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const v = new THREE.Vector3()

  // Indoors with indoor AR: up or down a floor along the route (route level - the user's level).
  let levelLift = null
  const heightAt = (s, userS, slope) => Math.max(-GROUND_ARROWS.maxLiftM, Math.min(GROUND_ARROWS.maxLiftM, (s - userS) * slope)) + (levelLift ? levelLift(s) : 0)

  /** The strip and the corner rings, by the chevrons' rules: range, fades, eye level, blocking. */
  function paintExtras({userS, slope, show, opacity, camera, spots}) {
    if (!show || rounded.length < 2 || !Number.isFinite(userS)) {
      strip.hide()
      rings.hide()
      ringsShown = 0
      return
    }
    const from = projectOntoPolyline(rounded, pointAt(route, Math.max(0, userS))).s
    // Hidden behind something from the first blocked chevron on, as the chevrons are.
    let blockS = Infinity
    let blockShown = 0
    for (const spot of spots) {
      const b = blocked.get(keyOf(spot.s))
      if (b?.target === 1) {
        blockS = spot.s - GROUND_ARROWS.spacingM / 2
        blockShown = b.shown
        break
      }
    }
    const alphaAt = (x, y, s, d) => {
      let a = fadeAt(d) * opacity
      if (camera) {
        v.set(x, heightAt(s, userS, slope), -y)
        group.localToWorld(v)
        const below = camPos.y - v.y
        if (below < GROUND_ARROWS.minBelowCameraM) return 0
        a *= angleFade((Math.atan2(below, Math.hypot(v.x - camPos.x, v.z - camPos.z)) * 180) / Math.PI)
      }
      if (s >= blockS) a *= 1 - blockShown
      return a
    }
    strip.update(stripSamples(rounded, from), (s) => heightAt(s, userS, slope), (q) => alphaAt(q.x, q.y, q.s, q.d))
    const corners = turns
      .map((c) => ({...c, d: c.s - from}))
      .filter((c) => c.d > -0.5 && c.d <= GROUND_ARROWS.aheadM)
      .sort((a, b) => a.d - b.d)
      .map((c) => ({x: c.x, y: c.y, d: Math.max(0, c.d), height: heightAt(c.s, userS, slope), alpha: alphaAt(c.x, c.y, c.s, Math.max(0, c.d))}))
    ringsShown = rings.update(corners)
  }

  return {
    group,
    /** The route polyline (route frame). The corners are rounded once here, not every frame. */
    setRoute(points, corners = []) {
      route = points
      rounded = roundCorners(points)
      turns = corners.map((c) => ({x: c.x, y: c.y, s: projectOntoPolyline(rounded, c).s}))
      blocked.clear()
    },
    /**
     * Lay the chevrons, the strip and the corner rings for this frame. camera: the AR camera
     * (world). time: seconds, for the slow pulse (0 with reduced motion). Returns how many are placed.
     */
    update({userS, slope = 0, show, opacity = 1, dt = 0, time = 0, camera = null, lift = null}) {
      levelLift = lift
      group.visible = Boolean(show)
      const spots = show ? chevronSpots(route, rounded, userS) : []
      active = Math.min(spots.length, pool.length)
      visibleCount = 0
      const live = new Set(spots.slice(0, active).map((s) => keyOf(s.s)))
      for (const key of blocked.keys()) if (!live.has(key)) blocked.delete(key)
      const k = 1 - Math.exp((-3 * dt) / GROUND_ARROWS.blockEaseS)
      if (camera) camera.getWorldPosition(camPos)
      group.updateMatrixWorld(true)
      let behind = false // past the first blocked spot along the path, everything is hidden too
      for (let i = 0; i < pool.length; i++) {
        const slot = pool[i]
        const spot = i < active ? spots[i] : null
        slot.spot = spot
        if (!spot) {
          slot.item.visible = false
          slot.alpha = 0
          continue
        }
        // On the floor: the geo-root sits at the floor under the user; the slope carries it along.
        const lift = heightAt(spot.s, userS, slope)
        slot.item.position.set(spot.x, lift + 0.005, -spot.y)
        slot.item.rotation.set(0, -toRad(spot.bearingDeg), 0)
        slot.item.updateMatrixWorld(true)
        let alpha = fadeAt(spot.d) * opacity
        if (camera) {
          slot.item.getWorldPosition(p)
          const below = camPos.y - p.y
          // Never at or above eye level, and nothing seen nearly edge-on near the horizon.
          if (below < GROUND_ARROWS.minBelowCameraM) alpha = 0
          else alpha *= angleFade((Math.atan2(below, Math.hypot(p.x - camPos.x, p.z - camPos.z)) * 180) / Math.PI)
        }
        const b = blocked.get(keyOf(spot.s)) ?? {target: 0, shown: 0, cascade: false}
        b.cascade = behind && b.target === 0
        const hide = b.target === 1 || behind ? 1 : 0
        if (b.target === 1) behind = true
        b.shown += (hide - b.shown) * k
        blocked.set(keyOf(spot.s), b)
        alpha *= 1 - b.shown
        slot.alpha = alpha
        slot.item.visible = alpha > 0.01
        if (slot.item.visible) visibleCount += 1
        slot.shadowMat.opacity = GROUND_ARROWS.shadowOpacity * alpha
        slot.edgeMat.opacity = alpha
        slot.fillMat.opacity = alpha
        // Brighter through a corner; elsewhere a slow, light band moving forward (no glow).
        const nearCorner = turns.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) <= GROUND_EXTRAS.cornerNearM)
        const wave = time ? Math.max(0, Math.cos(2 * Math.PI * (spot.d / GROUND_EXTRAS.pulseWavelengthM - time / GROUND_EXTRAS.pulsePeriodS))) : 0
        slot.fillMat.color.copy(nearCorner ? corner : green).lerp(pulse, nearCorner ? 0 : wave ** 4 * GROUND_EXTRAS.pulseMix)
      }
      paintExtras({userS, slope, show, opacity, camera, spots})
      return active
    },
    /**
     * When no chevron is in the camera's view: which way they are, as a screen angle (degrees,
     * 0 = right, 90 = down), for one small chevron at the screen edge. Null if any is in view.
     */
    offscreenHint(camera) {
      if (!group.visible || !active) return null
      camera.updateMatrixWorld()
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(m)
      for (let i = 0; i < active; i++) {
        pool[i].item.getWorldPosition(p)
        if (frustum.containsPoint(p)) return null
      }
      // Towards the nearest one: its place on screen, mirrored when it is behind the camera.
      pool[0].item.getWorldPosition(p)
      const q = p.clone().applyMatrix4(camera.matrixWorldInverse)
      const ndc = p.clone().project(camera)
      let dx = ndc.x
      let dy = -ndc.y
      if (q.z > 0) {
        dx = -dx
        dy = -dy
      }
      if (Math.hypot(dx, dy) < 1e-6) dy = 1
      return {angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI}
    },
    /**
     * Where chevron i is on screen ({x, y} 0..1 from the top left) and how far from the camera,
     * for the blocked test; null if it is not placed or not in front of the camera.
     */
    screenSpot(i, camera) {
      const slot = pool[i]
      if (!slot?.spot || i >= active) return null
      camera.updateMatrixWorld()
      slot.item.getWorldPosition(p)
      camera.getWorldPosition(camPos)
      const distance = p.distanceTo(camPos)
      const q = p.clone().project(camera)
      if (q.z < -1 || q.z > 1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) return null
      return {x: (q.x + 1) / 2, y: (1 - q.y) / 2, distance, s: slot.spot.s}
    },
    /** The blocked test for spot s: is a surface nearer the camera than the chevron? */
    setBlocked(s, isBlocked) {
      const key = keyOf(s)
      const b = blocked.get(key) ?? {target: 0, shown: 0, cascade: false}
      b.target = isBlocked ? 1 : 0
      blocked.set(key, b)
    },
    /** How many of the drawn chevrons are inside the camera's view right now. */
    countInView(camera) {
      if (!group.visible || !active) return 0
      camera.updateMatrixWorld()
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(m)
      let n = 0
      for (let i = 0; i < active; i++) {
        if (!pool[i].item.visible) continue
        pool[i].item.getWorldPosition(p)
        if (frustum.containsPoint(p)) n += 1
      }
      return n
    },
    /**
     * With the building shell on: the arrows, strip and rings test depth against the invisible
     * walls, so they hide behind them and show through doors. Off: always drawn on top.
     */
    setDepthTest(on) {
      group.traverse((o) => {
        if (o.material) {
          o.material.depthTest = Boolean(on)
          o.material.needsUpdate = true
        }
      })
    },
    /** Corner rings drawn now. */
    get ringsShown() {
      return ringsShown
    },
    get created() {
      return pool.length
    },
    get active() {
      return active
    },
    /** Drawn with some opacity (not faded out, not hidden as blocked). */
    get visible() {
      return visibleCount
    },
    /** Hidden because a surface is in front of them, or in front of one before them on the path. */
    get blockedCount() {
      let n = 0
      for (let i = 0; i < active; i++) {
        const b = pool[i].spot && blocked.get(keyOf(pool[i].spot.s))
        if (b && (b.target === 1 || b.cascade)) n += 1
      }
      return n
    },
    dispose() {
      greenGeo.dispose()
      edgeGeo.dispose()
      shadowGeo.dispose()
      shadowMap?.dispose()
      strip.dispose()
      rings.dispose()
      for (const {shadowMat, edgeMat, fillMat} of pool) {
        shadowMat.dispose()
        edgeMat.dispose()
        fillMat.dispose()
      }
    },
  }
}
