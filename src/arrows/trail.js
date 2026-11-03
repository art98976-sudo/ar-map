// Arrow trail on the ground: one chevron every metre along the route.
//
// Performance: ONE InstancedMesh (one draw call) for every arrow on the route. The shader
// draws a soft, glowing chevron and does all per-frame work on the GPU:
//   - visibility window: only the next ~15 m are shown, fading in ahead and out behind
//   - "runway lights": a brighter pulse flows forward along the arrows
// Each frame the CPU only eases one number (how far along the route the user is), so the
// arrows never jump.
import {findTurns, resample} from '../geo/geo.js'

export const TRAIL = {
  spacingM: 1, // one chevron per metre
  aheadM: 15, // how far ahead arrows are visible
  behindM: 1.5, // arrows fade out this far behind the user
  heightM: 0.01, // 1 cm above the ground so they never flicker into it
  sizeM: 0.6, // chevron width
  turnScale: 1.8, // corner arrows are bigger
  easeS: 0.3, // ~300 ms easing of the user's position along the route
  color: 0x0a8a4a, // Stirling green, slightly lifted so it reads on grey paving
}

const vertexShader = /* glsl */ `
  attribute float aS;
  attribute float aTurn;
  uniform float uUserS;
  uniform float uAhead;
  uniform float uBehind;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPulse;
  varying float vTurn;
  void main() {
    vUv = uv;
    vTurn = aTurn;
    float d = aS - uUserS;
    // Fade in from behind the user, full strength nearby, fade out towards the far end.
    float near = smoothstep(-uBehind, 0.6, d);
    float far = 1.0 - smoothstep(uAhead - 5.0, uAhead, d);
    vAlpha = near * far;
    // Runway-light pulse travelling forward at 3 m/s, one every 7 m.
    float phase = fract((aS - uTime * 3.0) / 7.0);
    vPulse = 1.0 - smoothstep(0.0, 0.16, phase);
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // Collapse invisible arrows so the GPU skips them.
    if (vAlpha <= 0.001) world = vec4(0.0, -1000.0, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPulse;
  varying float vTurn;
  // Distance from p to segment a-b.
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    // Chevron "^" pointing forward (towards +v), with rounded ends.
    vec2 p = vUv - vec2(0.5, 0.5);
    float d = min(seg(p, vec2(-0.32, -0.16), vec2(0.0, 0.18)), seg(p, vec2(0.32, -0.16), vec2(0.0, 0.18)));
    float core = 1.0 - smoothstep(0.075, 0.095, d);
    float glow = exp(-d * 16.0) * 0.55;
    float boost = 1.0 + vPulse * 0.9 + vTurn * 0.35;
    vec3 col = mix(uColor, vec3(0.75, 1.0, 0.8), vPulse * 0.55) * boost;
    float a = (core * 0.88 + glow * 0.6) * vAlpha * (0.72 + vPulse * 0.28);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    // Convert from three.js's linear colour space to the screen's sRGB, like built-in
    // materials do. Without this the green comes out much darker than Stirling green.
    #include <colorspace_fragment>
  }
`

/**
 * @param THREE three.js namespace
 * @param route local route points [{x: east, y: north}] (metres)
 */
export function createArrowTrail(THREE, route) {
  const samples = resample(route, TRAIL.spacingM)
  const turns = findTurns(route)
  // Mark the arrow nearest to each corner as a turn arrow.
  const turnAt = new Set(turns.map((t) => Math.round(t.s / TRAIL.spacingM)))

  const geometry = new THREE.PlaneGeometry(TRAIL.sizeM, TRAIL.sizeM)
  geometry.rotateX(-Math.PI / 2) // lie flat; the chevron's tip (uv top) now points to -Z
  const count = Math.max(1, samples.length)
  const aS = new Float32Array(count)
  const aTurn = new Float32Array(count)

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uUserS: {value: 0},
      uAhead: {value: TRAIL.aheadM},
      uBehind: {value: TRAIL.behindM},
      uTime: {value: 0},
      uColor: {value: new THREE.Color(TRAIL.color)},
    },
  })

  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false // instances span the whole route
  mesh.renderOrder = 2
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const scale = new THREE.Vector3()
  const pos = new THREE.Vector3()

  samples.forEach((p, i) => {
    const isTurn = turnAt.has(i)
    aS[i] = p.s
    aTurn[i] = isTurn ? 1 : 0
    // Compass heading h -> rotation about Y of -h (north is -Z, east is +X).
    q.setFromAxisAngle(up, (-p.heading * Math.PI) / 180)
    const k = isTurn ? TRAIL.turnScale : 1
    scale.set(k, 1, k)
    pos.set(p.x, TRAIL.heightM, -p.y)
    m.compose(pos, q, scale)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1))
  geometry.setAttribute('aTurn', new THREE.InstancedBufferAttribute(aTurn, 1))

  let shownS = 0

  return {
    mesh,
    samples,
    turns,
    /** Ease towards the user's distance along the route; returns how many arrows are visible. */
    update(targetS, dt, time) {
      const k = 1 - Math.exp(-dt / TRAIL.easeS)
      shownS += (targetS - shownS) * k
      material.uniforms.uUserS.value = shownS
      material.uniforms.uTime.value = time
      return visibleCount(aS, shownS)
    },
    /** Set without easing (first placement only). */
    reset(s = 0) {
      shownS = s
      material.uniforms.uUserS.value = s
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Arrows inside the visible window (for the debug panel). aS is sorted ascending. */
export function visibleCount(aS, userS) {
  const lo = lowerBound(aS, userS - TRAIL.behindM)
  const hi = lowerBound(aS, userS + TRAIL.aheadM)
  return Math.max(0, hi - lo)
}

function lowerBound(arr, v) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}
