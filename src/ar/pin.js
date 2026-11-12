// Destination marker at the entrance: a map pin standing on the ground, its tip touching the floor,
// with a pulsing ring and a disc where to stand. No beam into the sky and no label in the air: it
// shows only within PIN.showWithinM of the destination, at its real size, so it reads as an object
// on the ground and not as a sign floating over the campus.
import {PIN} from '../config.js'

/** Format a distance for people: "8 m", "120 m", "1.2 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return ''
  if (m < 10) return `${Math.max(1, Math.round(m))} m`
  if (m < 1000) return `${Math.round(m / 5) * 5} m`
  return `${(m / 1000).toFixed(1)} km`
}

/** Is the pin drawn at this distance (metres from the user)? */
export function pinVisible(distanceM) {
  return Number.isFinite(distanceM) && distanceM <= PIN.showWithinM
}

const HEAD_Y = 1.0 // ball centre: the cone's tip then just touches the ground

export function createDestinationPin(THREE) {
  const group = new THREE.Group()
  group.name = 'destination-pin'
  group.visible = false

  const solid = new THREE.MeshBasicMaterial({color: PIN.green, depthTest: false})

  // Head: a classic map pin (sphere + cone pointing down to the ground), with a white dot.
  const head = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), solid)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.65, 32), solid)
  tip.rotation.x = Math.PI
  tip.position.y = -0.33 - 0.325 + 0.02
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 12), new THREE.MeshBasicMaterial({color: 0xffffff, depthTest: false}))
  dot.position.z = 0.25
  head.add(ball, tip, dot)
  head.traverse((part) => {
    part.renderOrder = part === dot ? PIN.onTop + 1 : PIN.onTop
  })
  head.position.y = HEAD_Y
  group.add(head)

  // Pulsing rings on the ground (two, offset in time).
  const ringGeo = new THREE.RingGeometry(0.75, 0.95, 64)
  ringGeo.rotateX(-Math.PI / 2)
  const rings = [0, 0.5].map((offset) => {
    const mat = new THREE.MeshBasicMaterial({color: PIN.lightGreen, transparent: true, depthWrite: false})
    const ring = new THREE.Mesh(ringGeo, mat)
    ring.position.y = 0.015
    ring.userData.offset = offset
    group.add(ring)
    return ring
  })
  // A solid disc where to stand.
  const discGeo = new THREE.CircleGeometry(0.7, 48)
  discGeo.rotateX(-Math.PI / 2)
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({color: PIN.green, transparent: true, opacity: 0.45, depthWrite: false}))
  disc.position.y = 0.012
  group.add(disc)

  return {
    group,
    /** Animate (time in seconds); shown only within PIN.showWithinM of the user. */
    update(time, distanceM) {
      group.visible = pinVisible(distanceM)
      if (!group.visible) return
      for (const ring of rings) {
        const t = (time * 0.6 + ring.userData.offset) % 1
        const s = 1 + t * 2.4
        ring.scale.set(s, 1, s)
        ring.material.opacity = 0.85 * (1 - t)
      }
      head.position.y = HEAD_Y + Math.sin(time * 2) * 0.04 // the slightest bob, staying on the ground
      head.rotation.y = time * 0.6 // slow turn
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.()
        o.material?.dispose?.()
      })
    },
  }
}
