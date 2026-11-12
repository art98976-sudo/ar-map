// Destination marker at the entrance: a tall pin, slowly bobbing and turning, with a label under it
// ("Library · 120 m") and a pulsing ring on the ground. It is drawn on top of everything, and grows
// with distance, so it can be seen from far away and never becomes tiny.
import {PIN} from '../config.js'

/** Label drawn on a canvas (crisp text, re-drawn only when the distance changes). */
function makeLabel(THREE) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 200
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // fog: false keeps the label crisp in scenes with fog (the arrow preview tool).
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, transparent: true, depthTest: false, fog: false}))
  sprite.renderOrder = PIN.onTop + 1
  sprite.scale.set(3.6, 1.125, 1) // metres
  let last = ''

  function draw(name, distanceText) {
    const key = `${name}|${distanceText}`
    if (key === last) return
    last = key
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Rounded green card with a soft shadow.
    const r = 44
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 18
    ctx.fillStyle = 'rgba(0, 87, 52, 0.92)'
    ctx.beginPath()
    ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, r)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 58px Inter, system-ui, sans-serif'
    ctx.fillText(fit(ctx, distanceText ? `${name} · ${distanceText}` : name, canvas.width - 64), canvas.width / 2, canvas.height / 2)
    texture.needsUpdate = true
  }
  return {sprite, draw, dispose: () => (texture.dispose(), sprite.material.dispose())}
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 3 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** Format a distance for people: "8 m", "120 m", "1.2 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return ''
  if (m < 10) return `${Math.max(1, Math.round(m))} m`
  if (m < 1000) return `${Math.round(m / 5) * 5} m`
  return `${(m / 1000).toFixed(1)} km`
}

/** How much bigger the pin is drawn at a distance. */
export function pinScale(distanceM) {
  return Math.max(1, (distanceM || 0) / PIN.growFromM)
}

export function createDestinationPin(THREE, {name}) {
  const group = new THREE.Group()
  group.name = 'destination-pin'
  const tmp = new THREE.Vector3()

  const glow = new THREE.MeshBasicMaterial({color: PIN.lightGreen, transparent: true, opacity: 0.9, depthTest: false})
  const solid = new THREE.MeshBasicMaterial({color: PIN.green, depthTest: false})
  const floating = new THREE.Group()
  group.add(floating)

  // Pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 5, 16), glow)
  pole.position.y = 2.5
  pole.renderOrder = PIN.onTop
  floating.add(pole)

  // Head: a classic map pin (sphere + cone), with a white dot.
  const head = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), solid)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.75, 32), solid)
  tip.rotation.x = Math.PI
  tip.position.y = -0.55
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12), new THREE.MeshBasicMaterial({color: 0xffffff, depthTest: false}))
  dot.position.z = 0.36
  head.add(ball, tip, dot)
  head.traverse((part) => {
    part.renderOrder = part === dot ? PIN.onTop + 1 : PIN.onTop
  })
  head.position.y = 5.6
  floating.add(head)

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

  const label = makeLabel(THREE)
  label.sprite.position.y = 4
  floating.add(label.sprite)
  label.draw(name, '')

  return {
    group,
    /** Animate (time in seconds) and update the distance text. */
    update(time, distanceM, camera) {
      for (const ring of rings) {
        const t = (time * 0.6 + ring.userData.offset) % 1
        const s = 1 + t * 2.4
        ring.scale.set(s, 1, s)
        ring.material.opacity = 0.85 * (1 - t)
      }
      head.position.y = 5.6 + Math.sin(time * 2) * 0.12 // gentle bob
      head.rotation.y = time * 0.6 // slow turn
      floating.scale.setScalar(pinScale(distanceM))
      // Past the camera's far limit, draw it nearer in the same direction, without its pole.
      const tooFar = distanceM > PIN.maxDrawnM
      pole.visible = !tooFar
      floating.position.set(0, 0, 0)
      if (tooFar && camera) {
        const p = camera.getWorldPosition(tmp)
        group.worldToLocal(p)
        const pull = 1 - PIN.maxDrawnM / distanceM
        floating.position.set(p.x * pull, 0, p.z * pull)
        floating.scale.setScalar(pinScale(PIN.maxDrawnM))
      }
      label.draw(name, distanceM == null ? '' : formatDistance(distanceM))
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.()
        if (o.material && o.material !== label.sprite.material) o.material.dispose?.()
      })
      label.dispose()
    },
  }
}
