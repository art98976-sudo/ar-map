// The destination beacon (B5): a tall pillar of light in the University green over the entrance,
// so the user can see where they are going from far away, over and between buildings.
// It is bright at the ground and fades towards the sky, with a slow light rising through it.
// Far away it is drawn wider, so it never shrinks to a hairline; close by, the pin takes over and
// the beacon fades out. Its depth test is on, so the campus occluders hide it behind buildings.
import {BEACON} from '../config.js'

/** How wide to draw the beacon at this distance: real size near, the same on-screen width far. */
export function beaconScale(distanceM) {
  if (!Number.isFinite(distanceM)) return 1
  return Math.max(1, distanceM / BEACON.constantWidthFromM)
}

/** How visible: 0 within hideWithinM (the pin is there), 1 from fadeInM on. */
export function beaconOpacity(distanceM) {
  if (!Number.isFinite(distanceM)) return 0
  const t = (distanceM - BEACON.hideWithinM) / Math.max(1e-6, BEACON.fadeInM - BEACON.hideWithinM)
  return Math.max(0, Math.min(1, t))
}

const VERTEX = /* glsl */ `
  varying float vUp;
  varying float vSide;
  void main() {
    vUp = uv.y;
    vSide = abs(uv.x - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 colour;
  uniform vec3 core;
  uniform float opacity;
  uniform float time;
  varying float vUp;
  varying float vSide;
  void main() {
    // Bright at the ground, fading to nothing at the top.
    float fade = pow(1.0 - vUp, 1.4);
    // The edges seen side-on are softer than the middle.
    float body = 1.0 - smoothstep(0.55, 1.0, vSide);
    // A slow band of light rising through the pillar.
    float band = 0.35 * smoothstep(0.92, 1.0, 1.0 - abs(fract(vUp * 2.0 - time * 0.25) - 0.5) * 2.0);
    vec3 c = mix(colour, core, 0.55 * (1.0 - vSide)) + band;
    gl_FragColor = vec4(c, opacity * fade * body * 0.85);
  }
`

export function createBeacon(THREE) {
  const group = new THREE.Group()
  group.name = 'destination-beacon'
  group.visible = false

  const material = new THREE.ShaderMaterial({
    uniforms: {
      colour: {value: new THREE.Color(BEACON.colour)},
      core: {value: new THREE.Color(BEACON.coreColour)},
      opacity: {value: 1},
      time: {value: 0},
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true, // hidden behind the campus occluders
    side: THREE.DoubleSide,
  })
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(BEACON.radiusM, BEACON.radiusM, BEACON.heightM, 24, 1, true), material)
  pillar.position.y = BEACON.heightM / 2
  pillar.renderOrder = BEACON.renderOrder
  pillar.name = 'beacon-pillar'
  group.add(pillar)

  // A soft glow on the ground at its foot.
  const glowGeo = new THREE.CircleGeometry(BEACON.radiusM * 2.2, 40)
  glowGeo.rotateX(-Math.PI / 2)
  const glowMaterial = new THREE.MeshBasicMaterial({color: BEACON.coreColour, transparent: true, opacity: 0.35, depthWrite: false})
  const glow = new THREE.Mesh(glowGeo, glowMaterial)
  glow.position.y = 0.02
  glow.renderOrder = BEACON.renderOrder
  group.add(glow)

  return {
    group,
    /** Each frame: seconds (0 with reduced motion) and the distance from the user. */
    update(time, distanceM, allowed = true) {
      const opacity = allowed ? beaconOpacity(distanceM) : 0
      group.visible = opacity > 0.01
      if (!group.visible) return
      const k = beaconScale(distanceM)
      pillar.scale.set(k, 1, k)
      glow.scale.set(k, 1, k)
      material.uniforms.opacity.value = opacity
      material.uniforms.time.value = time
      glowMaterial.opacity = 0.35 * opacity
    },
    get opacity() {
      return material.uniforms.opacity.value
    },
    dispose() {
      pillar.geometry.dispose()
      material.dispose()
      glowGeo.dispose()
      glowMaterial.dispose()
    },
  }
}
