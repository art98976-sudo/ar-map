// A small 3D arrow floating low in front of the camera, pointing along the route. The backup for
// when the ground arrows are hard to see: it turns as the route turns.
const MAX_TURN_DEG_PER_S = 120
const AHEAD_M = 1.5
const BELOW_M = 0.55
const MIN_LOOK = 0.2 // below this the camera looks straight up or down: keep the last direction

/** Turn from `current` towards `target` (radians), the short way, at no more than maxDegPerS. */
export function stepYaw(current, target, dt, maxDegPerS = MAX_TURN_DEG_PER_S) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  const max = (maxDegPerS * Math.PI * dt) / 180
  return current + Math.max(-max, Math.min(max, diff))
}

/** @param o.color three.js colour number */
export function createGuideArrow(THREE, {color}) {
  // Flat, pointing to -Z when it lies down.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.2)
  shape.lineTo(0.15, 0)
  shape.lineTo(0.055, 0)
  shape.lineTo(0.055, -0.17)
  shape.lineTo(-0.055, -0.17)
  shape.lineTo(-0.055, 0)
  shape.lineTo(-0.15, 0)
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 20
  mesh.frustumCulled = false
  mesh.visible = false

  const forward = new THREE.Vector3()
  const at = new THREE.Vector3()
  const look = {x: 0, z: -1}
  let yaw = null

  return {
    mesh,
    get yaw() {
      return yaw
    },
    setColor: (value) => material.color.set(value),
    /** target: the world point on the route to point at. */
    update(dt, camera, target) {
      camera.getWorldPosition(at)
      camera.getWorldDirection(forward)
      const flat = Math.hypot(forward.x, forward.z)
      if (flat >= MIN_LOOK) {
        look.x = forward.x / flat
        look.z = forward.z / flat
      }
      mesh.position.set(at.x + look.x * AHEAD_M, at.y - BELOW_M, at.z + look.z * AHEAD_M)
      if (Math.hypot(target.x - at.x, target.z - at.z) > 0.05) {
        const want = Math.atan2(at.x - target.x, at.z - target.z)
        yaw = yaw == null ? want : stepYaw(yaw, want, dt)
      }
      if (yaw != null) mesh.rotation.y = yaw
      mesh.visible = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
