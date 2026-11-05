// The one big 3D arrow: about 2 m in front of the camera and a little below eye level, lying almost
// flat and tilted towards the user. It turns to the way to walk. A ring around it fills as a corner
// comes up, and on arrival it becomes a pin.
const MAX_TURN_DEG_PER_S = 120
const AHEAD_M = 2
const BELOW_M = 0.4
// A level phone would put it behind the map on the lower part of the screen, so it rides up a little.
const MIN_BELOW_M = 0.2
const MAX_BELOW_M = 0.6
const TILT_RAD = (20 * Math.PI) / 180
const SCALE = 0.8 // the ring just fits the width of a portrait camera view at 2 m
const MIN_LOOK = 0.2 // below this the camera looks straight up or down: keep the last direction
const RING_SEGMENTS = 64
const RING_INNER_M = 0.62
const RING_OUTER_M = 0.7
const DEPTH_M = 0.05

/** Turn from `current` towards `target` (radians), the short way, at no more than maxDegPerS. */
export function stepYaw(current, target, dt, maxDegPerS = MAX_TURN_DEG_PER_S) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  const max = (maxDegPerS * Math.PI * dt) / 180
  return current + Math.max(-max, Math.min(max, diff))
}

/** How far below the eye the arrow sits, following the phone's tilt within limits. forwardY: look direction's y. */
export function arrowDrop(forwardY) {
  return Math.max(MIN_BELOW_M, Math.min(MAX_BELOW_M, BELOW_M + (-forwardY * AHEAD_M - BELOW_M) * 0.5))
}

/** @param o.color three.js colour number */
export function createGuideArrow(THREE, {color}) {
  // Flat, centred, pointing to -Z when it lies down.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.5)
  shape.lineTo(0.42, 0.02)
  shape.lineTo(0.16, 0.02)
  shape.lineTo(0.16, -0.46)
  shape.lineTo(-0.16, -0.46)
  shape.lineTo(-0.16, 0.02)
  shape.lineTo(-0.42, 0.02)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: DEPTH_M, bevelEnabled: false})
  geometry.rotateX(-Math.PI / 2)
  // Lit faces would need lights in the scene: a brighter top and a darker edge read as solid.
  const top = new THREE.MeshBasicMaterial({color})
  const edge = new THREE.MeshBasicMaterial({color})
  edge.color.multiplyScalar(0.45)
  const arrow = new THREE.Mesh(geometry, [top, edge])

  const ringGeometry = new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M, RING_SEGMENTS, 1, Math.PI / 2)
  ringGeometry.rotateX(-Math.PI / 2)
  const ringMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false})
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.scale.x = -1 // fills clockwise, from the top
  ring.visible = false

  const pinMaterial = new THREE.MeshBasicMaterial({color})
  const pinTip = new THREE.ConeGeometry(0.2, 0.55, 24)
  pinTip.rotateX(Math.PI)
  pinTip.translate(0, 0.28, 0)
  const pinHead = new THREE.SphereGeometry(0.26, 24, 16)
  pinHead.translate(0, 0.72, 0)
  const pin = new THREE.Group()
  pin.add(new THREE.Mesh(pinTip, pinMaterial), new THREE.Mesh(pinHead, pinMaterial))
  pin.visible = false

  // root faces where the camera looks, plate tilts towards the user, the arrow turns on the plate.
  const root = new THREE.Group()
  const plate = new THREE.Group()
  plate.rotation.x = TILT_RAD
  plate.scale.setScalar(SCALE)
  plate.add(arrow, ring)
  root.add(plate, pin)
  root.renderOrder = 20
  for (const part of [arrow, ring]) {
    part.renderOrder = 20
    part.frustumCulled = false
  }
  root.visible = false

  const forward = new THREE.Vector3()
  const at = new THREE.Vector3()
  const look = {x: 0, z: -1}
  let yaw = null // world yaw, so a quick turn of the phone does not make the arrow lag behind the world
  let arrived = false
  let time = 0

  return {
    mesh: root,
    arrow,
    ring,
    pin,
    get yaw() {
      return yaw
    },
    get relativeDeg() {
      return yaw == null ? null : ((arrow.rotation.y * -180) / Math.PI + 540) % 360 - 180
    },
    setColor(value) {
      top.color.set(value)
      edge.color.set(value).multiplyScalar(0.45)
      pinMaterial.color.set(value)
    },
    /** relativeDeg: the way to walk from where the user faces, > 0 to the right. null hides the arrow. */
    update(dt, camera, relativeDeg, ringFill = 0) {
      camera.getWorldPosition(at)
      camera.getWorldDirection(forward)
      const flat = Math.hypot(forward.x, forward.z)
      if (flat >= MIN_LOOK) {
        look.x = forward.x / flat
        look.z = forward.z / flat
      }
      root.position.set(at.x + look.x * AHEAD_M, at.y - arrowDrop(forward.y), at.z + look.z * AHEAD_M)
      const lookYaw = Math.atan2(-look.x, -look.z)
      root.rotation.y = lookYaw
      if (arrived) {
        time += dt
        pin.position.y = Math.sin(time * 2.4) * 0.05
        root.visible = true
        return
      }
      if (relativeDeg == null) {
        root.visible = false
        return
      }
      const want = lookYaw - (relativeDeg * Math.PI) / 180
      yaw = yaw == null ? want : stepYaw(yaw, want, dt)
      arrow.rotation.y = yaw - lookYaw
      const fill = Math.max(0, Math.min(1, ringFill))
      ring.visible = fill > 0
      ringGeometry.setDrawRange(0, Math.round(fill * RING_SEGMENTS) * 6)
      root.visible = true
    },
    /** The walk is over: the arrow becomes a pin. */
    arrive() {
      arrived = true
      arrow.visible = false
      ring.visible = false
      pin.visible = true
      root.visible = true
    },
    dispose() {
      geometry.dispose()
      top.dispose()
      edge.dispose()
      ringGeometry.dispose()
      ringMaterial.dispose()
      pinTip.dispose()
      pinHead.dispose()
      pinMaterial.dispose()
    },
  }
}
