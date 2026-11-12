// The way to walk, drawn on the real floor: flat green chevrons with a white edge, one every
// 1.2 m along the next 18 m of the route, inside the AR scene's geo-root group. Being 3D objects
// in the world, the real camera gives them perspective and they stay put when the phone moves.
//
// They are laid along the same polyline the map draws, with each corner rounded (about 1 m
// radius), so the line of arrows itself bends left or right: that bend is the only turn signal.
// Chevrons are anchored to fixed spots along the route (every 1.2 m from the start), so they do
// not slide as the user walks; the ones left behind are recycled ahead. A fixed pool of meshes is
// made once; nothing is created per frame.
//
// Route frame: {x east, y north} metres. Geo-root: x = east, y = up, z = -north.
import {localBearing, pointAt, polylineLength, projectOntoPolyline, toRad} from '../geo/geo.js'
import {GROUND_ARROWS} from '../config.js'

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

/**
 * The pool and its drawing. update() once per frame with the user's s along the route, the
 * ground slope (height change per metre along the route), and whether to show them at all.
 */
export function createGroundArrows(THREE, {reducedMotion = false} = {}) {
  const group = new THREE.Group()
  group.name = 'ground-arrows'
  group.visible = false
  const outline = chevronOutline()
  const greenGeo = new THREE.ShapeGeometry(shapeOf(THREE, outline))
  const edgeGeo = new THREE.ShapeGeometry(shapeOf(THREE, growPolygon(outline, GROUND_ARROWS.edgeM)))
  // Lying flat: the shape's +Y (its point) becomes -Z, which the geo-root calls north.
  greenGeo.rotateX(-Math.PI / 2)
  edgeGeo.rotateX(-Math.PI / 2)
  const green = new THREE.Color(GROUND_ARROWS.green)
  const bright = new THREE.Color(GROUND_ARROWS.pulseGreen)

  const pool = Array.from({length: GROUND_ARROWS.poolSize}, (_, i) => {
    const item = new THREE.Group()
    item.name = `chevron-${i}`
    const edgeMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, depthTest: false, depthWrite: false})
    const fillMat = new THREE.MeshBasicMaterial({color: green.clone(), transparent: true, depthTest: false, depthWrite: false})
    const edge = new THREE.Mesh(edgeGeo, edgeMat)
    const fill = new THREE.Mesh(greenGeo, fillMat)
    // Drawn on top of the camera image and everything else; the green over its own white edge.
    edge.renderOrder = GROUND_ARROWS.renderOrder
    fill.renderOrder = GROUND_ARROWS.renderOrder + 1
    fill.position.y = 0.002
    item.add(edge, fill)
    item.visible = false
    group.add(item)
    return {item, edgeMat, fillMat}
  })

  let route = []
  let rounded = []
  let active = 0

  return {
    group,
    /** The route polyline (route frame). The corners are rounded once here, not every frame. */
    setRoute(points) {
      route = points
      rounded = roundCorners(points)
    },
    /** Lay the chevrons for this frame. Returns how many are drawn. */
    update({userS, slope = 0, show, time = 0}) {
      group.visible = Boolean(show)
      const spots = show ? chevronSpots(route, rounded, userS) : []
      active = Math.min(spots.length, pool.length)
      for (let i = 0; i < pool.length; i++) {
        const {item, edgeMat, fillMat} = pool[i]
        const spot = spots[i]
        if (!spot || i >= active) {
          item.visible = false
          continue
        }
        item.visible = true
        // On the floor: the geo-root sits at the floor under the user; the slope carries it along.
        const lift = Math.max(-GROUND_ARROWS.maxLiftM, Math.min(GROUND_ARROWS.maxLiftM, (spot.s - userS) * slope))
        item.position.set(spot.x, lift + 0.01, -spot.y)
        item.rotation.set(0, -toRad(spot.bearingDeg), 0)
        const alpha = fadeAt(spot.d)
        edgeMat.opacity = alpha * 0.95
        fillMat.opacity = alpha
        // A slow pulse travelling forward along the arrows (none with reduced motion).
        const wave = reducedMotion ? 0 : Math.max(0, Math.cos(2 * Math.PI * (spot.d / GROUND_ARROWS.pulseWavelengthM - time / GROUND_ARROWS.pulsePeriodS)))
        fillMat.color.copy(green).lerp(bright, wave ** 4)
      }
      return active
    },
    /** How many of the drawn chevrons are inside the camera's view right now. */
    countInView(camera) {
      if (!group.visible || !active) return 0
      camera.updateMatrixWorld()
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(m)
      const p = new THREE.Vector3()
      let n = 0
      for (let i = 0; i < active; i++) {
        pool[i].item.getWorldPosition(p)
        if (frustum.containsPoint(p)) n += 1
      }
      return n
    },
    get created() {
      return pool.length
    },
    get active() {
      return active
    },
    dispose() {
      greenGeo.dispose()
      edgeGeo.dispose()
      for (const {edgeMat, fillMat} of pool) {
        edgeMat.dispose()
        fillMat.dispose()
      }
    },
  }
}
