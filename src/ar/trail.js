// Chevrons painted on the ground: one every metre along the route, like road markings.
//
// Performance: ONE InstancedMesh (one draw call) for every chevron on the route. The shader
// draws a flat, glowing chevron and does all per-frame work on the GPU:
//   - visibility window: from 1.5 m ahead of the user to 8 m ahead, fading in and out, so
//     nothing is drawn behind the user or far away; chevrons get smaller into the distance
//   - each chevron points along the route line, turning gradually through a corner
//   - "flow": the chevrons pulse one after another towards the destination; reduced motion
//     turns this off
// Each frame the CPU only eases one number (how far along the route the user is), so the
// chevrons never jump.
import {findTurns, resample, toRad} from '../geo/geo.js'
import {TRAIL} from '../config.js'

const vertexShader = /* glsl */ `
  attribute float aS;
  uniform float uUserS;
  uniform float uStartM;
  uniform float uAheadM;
  uniform float uFadeM;
  uniform float uFarScale;
  uniform float uFlowS;
  uniform float uWaveM;
  uniform float uTime;
  uniform float uSlope;
  uniform float uOpacity;
  uniform float uMotion;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPulse;
  void main() {
    vUv = uv;
    float d = aS - uUserS;
    // Nothing behind the user or right at their feet; fade in from 1.5 m, out by 8 m.
    float near = smoothstep(uStartM - 0.6, uStartM, d);
    float far = 1.0 - smoothstep(uAheadM - uFadeM, uAheadM, d);
    vAlpha = near * far * uOpacity;
    // A pulse travels towards the destination: each chevron lights up once every uFlowS seconds.
    float phase = fract(uTime / uFlowS - d / uWaveM);
    vPulse = (1.0 - smoothstep(0.0, 0.3, phase)) * uMotion;
    // Smaller into the distance, on top of the perspective.
    float t = clamp((d - uStartM) / (uAheadM - uStartM), 0.0, 1.0);
    float size = mix(1.0, uFarScale, t) * (1.0 + 0.08 * vPulse);
    vec4 world = modelMatrix * instanceMatrix * vec4(position * size, 1.0);
    // Follow the slope of the ground ahead.
    world.y += clamp(d * uSlope, -1.5, 1.5);
    // Collapse invisible chevrons so the GPU skips them.
    if (vAlpha <= 0.001) world = vec4(0.0, -1000.0, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlow;
  uniform float uPaint;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPulse;
  // Distance from p to segment a-b.
  float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  void main() {
    vec2 p = vUv - vec2(0.5, 0.5);
    // Chevron "^" pointing forward (towards +v), with rounded ends.
    float d = min(seg(p, vec2(-0.36, -0.12), vec2(0.0, 0.14)), seg(p, vec2(0.36, -0.12), vec2(0.0, 0.14)));
    // Flat paint with a soft outer glow.
    float core = 1.0 - smoothstep(0.06, 0.075, d);
    float glow = 1.0 - smoothstep(0.075, 0.2, d);
    vec3 paint = uColor * (1.0 + vPulse * 0.35);
    vec3 col = mix(uGlow, paint, core);
    float a = max(core * uPaint, glow * (0.3 + vPulse * 0.2)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    // Convert from three.js's linear colour space to the screen's sRGB, like built-in
    // materials do. Without this the green comes out much darker than it should.
    #include <colorspace_fragment>
  }
`

// The faint strip under the chevrons: brighter thin edges, shown over the same stretch of route.
const laneVertexShader = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  uniform float uUserS;
  uniform float uStartM;
  uniform float uAheadM;
  uniform float uFadeM;
  uniform float uSlope;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vSide = aSide;
    float d = aS - uUserS;
    vAlpha = smoothstep(uStartM - 0.6, uStartM, d) * (1.0 - smoothstep(uAheadM - uFadeM, uAheadM, d)) * uOpacity;
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += clamp(d * uSlope, -1.5, 1.5);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const laneFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying float vAlpha;
  varying float vSide;
  void main() {
    float edge = smoothstep(0.88, 0.97, abs(vSide));
    float a = (0.12 + edge * 0.28) * vAlpha;
    if (a < 0.005) discard;
    gl_FragColor = vec4(mix(uColor, uGlow, edge * 0.5), a);
    #include <colorspace_fragment>
  }
`

/** A flat ribbon along the 1 m samples: left and right vertices, x east, z = -north. */
export function laneGeometryData(samples, widthM = TRAIL.laneWidthM, heightM = TRAIL.laneHeightM) {
  const positions = []
  const aS = []
  const aSide = []
  const index = []
  samples.forEach((p, i) => {
    const before = samples[Math.max(0, i - 1)]
    const after = samples[Math.min(samples.length - 1, i + 1)]
    const dx = after.x - before.x
    const dy = after.y - before.y
    const len = Math.hypot(dx, dy) || 1
    // To the right of travel, in x east / y north.
    const rx = (dy / len) * (widthM / 2)
    const ry = (-dx / len) * (widthM / 2)
    positions.push(p.x - rx, heightM, -(p.y - ry), p.x + rx, heightM, -(p.y + ry))
    aS.push(p.s, p.s)
    aSide.push(-1, 1)
    if (i) {
      const v = i * 2
      index.push(v - 2, v - 1, v, v, v - 1, v + 1)
    }
  })
  return {positions, aS, aSide, index}
}

/** The next corner the user has not passed yet, or null. turns: sorted by s. */
export function nextTurn(turns, s) {
  return turns.find((t) => t.s + TRAIL.turnPassedM > s) ?? null
}

/** Route distance where the visible chevrons end. */
export function visibleWindowEnd(s) {
  return s + TRAIL.aheadM
}

/**
 * The way each chevron points: the route's direction there, averaged over the samples within
 * TRAIL.bendM, so at a corner the chevrons turn one after another instead of all at once.
 * Returns compass headings in degrees.
 */
export function bentHeadings(samples, bendM = TRAIL.bendM, spacingM = TRAIL.spacingM) {
  const k = Math.max(0, Math.round(bendM / spacingM))
  return samples.map((_, i) => {
    let x = 0
    let y = 0
    for (let j = Math.max(0, i - k); j <= Math.min(samples.length - 1, i + k); j++) {
      x += Math.sin(toRad(samples[j].heading))
      y += Math.cos(toRad(samples[j].heading))
    }
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  })
}

/**
 * @param THREE three.js namespace
 * @param route local route points [{x: east, y: north}] (metres)
 * @param o.approximate straight-line fallback: draw the chevrons in amber
 * @param o.reducedMotion no flow along the chevrons
 */
export function createArrowTrail(THREE, route, {approximate = false, reducedMotion = false} = {}) {
  const samples = resample(route, TRAIL.spacingM)
  const turns = findTurns(route, TRAIL.turnDeg)
  const headings = bentHeadings(samples)

  const geometry = new THREE.PlaneGeometry(TRAIL.sizeM, TRAIL.sizeM)
  geometry.rotateX(-Math.PI / 2) // lie flat, like paint; the chevron's tip (uv top) now points to -Z
  const count = Math.max(1, samples.length)
  const aS = new Float32Array(count)

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // Drawn just in front of the ground, so it never flickers against it.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    uniforms: {
      uUserS: {value: 0},
      uStartM: {value: TRAIL.startM},
      uAheadM: {value: TRAIL.aheadM},
      uFadeM: {value: TRAIL.fadeM},
      uFarScale: {value: TRAIL.farScale},
      uFlowS: {value: TRAIL.flowS},
      uWaveM: {value: TRAIL.waveM},
      uOpacity: {value: 1},
      uPaint: {value: TRAIL.paintOpacity},
      uMotion: {value: reducedMotion ? 0 : 1},
      uTime: {value: 0},
      uSlope: {value: 0},
      uColor: {value: new THREE.Color(approximate ? TRAIL.approxColor : TRAIL.color)},
      uGlow: {value: new THREE.Color(approximate ? TRAIL.approxGlow : TRAIL.glow)},
    },
  })

  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false // instances span the whole route
  mesh.renderOrder = 2
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const scale = new THREE.Vector3(1, 1, 1)
  const pos = new THREE.Vector3()

  samples.forEach((p, i) => {
    aS[i] = p.s
    // Compass heading h -> rotation about Y of -h (north is -Z, east is +X).
    q.setFromAxisAngle(up, toRad(-headings[i]))
    pos.set(p.x, TRAIL.heightM, -p.y)
    m.compose(pos, q, scale)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1))

  const lane = laneGeometryData(samples)
  const laneGeometry = new THREE.BufferGeometry()
  laneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lane.positions, 3))
  laneGeometry.setAttribute('aS', new THREE.Float32BufferAttribute(lane.aS, 1))
  laneGeometry.setAttribute('aSide', new THREE.Float32BufferAttribute(lane.aSide, 1))
  laneGeometry.setIndex(lane.index)
  const {uUserS, uStartM, uAheadM, uFadeM, uOpacity, uSlope, uColor, uGlow} = material.uniforms
  const laneMaterial = new THREE.ShaderMaterial({
    vertexShader: laneVertexShader,
    fragmentShader: laneFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false, // nothing solid is drawn over a camera feed, and it lies on the ground anyway
    side: THREE.DoubleSide,
    uniforms: {uUserS, uStartM, uAheadM, uFadeM, uOpacity, uSlope, uColor, uGlow},
  })
  const laneMesh = new THREE.Mesh(laneGeometry, laneMaterial)
  laneMesh.frustumCulled = false
  laneMesh.renderOrder = 1

  let shownS = 0
  let wantOpacity = 1

  return {
    mesh,
    lane: laneMesh,
    samples,
    turns,
    get windowEnd() {
      return visibleWindowEnd(shownS)
    },
    get opacity() {
      return uOpacity.value
    },
    /** Fade all the chevrons out (0) or in (1). */
    setOpacity(value) {
      wantOpacity = value
    },
    /** The ground's rise per metre along the route. */
    setSlope(slope) {
      material.uniforms.uSlope.value = slope
    },
    /** Ease towards the user's distance along the route; returns how many chevrons are visible. */
    update(targetS, dt, time) {
      const k = 1 - Math.exp(-dt / TRAIL.easeS)
      shownS += (targetS - shownS) * k
      uOpacity.value += (wantOpacity - uOpacity.value) * (1 - Math.exp(-dt / TRAIL.fadeS))
      uUserS.value = shownS
      material.uniforms.uTime.value = time
      return visibleCount(aS, shownS)
    },
    /** Set without easing (first placement only). */
    reset(s = 0) {
      shownS = s
      uUserS.value = s
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      laneGeometry.dispose()
      laneMaterial.dispose()
    },
  }
}

/** Chevrons inside the visible window (for the debug panel). aS is sorted ascending. */
export function visibleCount(aS, userS) {
  const lo = lowerBound(aS, userS + TRAIL.startM - 0.3)
  const hi = lowerBound(aS, visibleWindowEnd(userS))
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
