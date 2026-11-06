// Arrow trail on the ground: one chevron every 2 m along the route.
//
// Performance: ONE InstancedMesh (one draw call) for every arrow on the route. The shader
// draws a soft, glowing chevron and does all per-frame work on the GPU:
//   - visibility window: arrows reach 30 m ahead, or to the next corner if that is closer, so
//     they never run into a building; the next leg fades in after the turn
//   - corner arrows pulse gently; reduced motion turns this and the flow off
//   - "runway lights": a brighter pulse flows forward along the arrows
// Each frame the CPU only eases one number (how far along the route the user is), so the
// arrows never jump.
import {findTurns, resample} from '../geo/geo.js'

export const TRAIL = {
  spacingM: 2,
  aheadM: 30, // arrows are never drawn further ahead than this
  fadeInM: 6, // they fade in over this much, as the user comes closer
  turnDeg: 30, // a bend this sharp gets a corner arrow
  behindM: 1.5, // arrows fade out this far behind the user
  heightM: 0.01, // 1 cm above the ground so they never flicker into it
  sizeM: 0.85, // chevron width
  maxLiftM: 1.5, // the slope raises or lowers arrows ahead by at most this
  laneWidthM: 1.1,
  laneHeightM: 0.005,
  fadeS: 0.5, // fading out when the compass is poor, and back in
  turnPassedM: 1, // a corner counts as passed this far beyond it
  windowEaseS: 0.6, // the next leg fades in rather than appearing all at once
  turnScale: 1.6, // corner arrows are bigger
  easeS: 0.3, // ~300 ms easing of the user's position along the route
  color: 0x0a8a4a, // Stirling green, slightly lifted so it reads on grey paving
  glow: 0xbfffcc,
  approxColor: 0xe09a00, // amber: a straight-line fallback that may cross buildings
  approxGlow: 0xffebaa,
}

const vertexShader = /* glsl */ `
  attribute float aS;
  attribute float aTurn;
  uniform float uUserS;
  uniform float uAheadEnd;
  uniform float uAheadM;
  uniform float uBehind;
  uniform float uTime;
  uniform float uSlope;
  uniform float uOpacity;
  uniform float uMotion;
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
    // ...and nothing past the corner, whose own arrow stays. The window edge fades softly.
    float far = (1.0 - smoothstep(uAheadM - ${TRAIL.fadeInM.toFixed(1)}, uAheadM, d)) * (1.0 - smoothstep(uAheadEnd, uAheadEnd + 0.5, aS));
    vAlpha = near * far * uOpacity;
    // Runway-light pulse travelling forward at 3 m/s, one every 7 m.
    float phase = fract((aS - uTime * 3.0) / 7.0);
    vPulse = (1.0 - smoothstep(0.0, 0.16, phase)) * uMotion;
    // A corner arrow breathes between 1.0 and 1.15, every 1.2 s.
    float grow = abs(aTurn) > 0.5 ? 1.0 + 0.075 * uMotion * (1.0 - cos(uTime * 5.236)) : 1.0;
    vec4 world = modelMatrix * instanceMatrix * vec4(position * grow, 1.0);
    // Follow the slope of the ground ahead.
    world.y += clamp(d * uSlope, -1.5, 1.5);
    // Collapse invisible arrows so the GPU skips them.
    if (vAlpha <= 0.001) world = vec4(0.0, -1000.0, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlow;
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
  // Arrow coming up from behind and bending to the right, with an arrowhead.
  float turnArrow(vec2 p) {
    vec2 c = vec2(0.14, -0.2);
    float r = 0.3;
    vec2 q = p - c;
    float bend = (q.x <= 0.0 && q.y >= 0.0)
      ? abs(length(q) - r)
      : min(length(q - vec2(-r, 0.0)), length(q - vec2(0.0, r)));
    float tail = seg(p, vec2(c.x - r, -0.46), vec2(c.x - r, c.y));
    vec2 tip = vec2(0.42, c.y + r);
    float shaft = seg(p, vec2(c.x, c.y + r), tip);
    float head = min(seg(p, tip, tip + vec2(-0.17, 0.17)), seg(p, tip, tip + vec2(-0.17, -0.17)));
    return min(min(bend, tail), min(shaft, head));
  }
  void main() {
    vec2 p = vUv - vec2(0.5, 0.5);
    float d;
    if (abs(vTurn) > 0.5) {
      // Corner: a curved arrow, mirrored for a left turn.
      p.x *= sign(vTurn);
      d = turnArrow(p);
    } else {
      // Chevron "^" pointing forward (towards +v), with rounded ends.
      d = min(seg(p, vec2(-0.40, -0.13), vec2(0.0, 0.15)), seg(p, vec2(0.40, -0.13), vec2(0.0, 0.15)));
    }
    // Like road paint: a solid shape with a soft dark rim, not a glow.
    float core = 1.0 - smoothstep(0.055, 0.072, d);
    float rim = 1.0 - smoothstep(0.072, 0.115, d);
    vec3 paint = mix(uColor, uGlow, vPulse * 0.35) * (1.0 + vPulse * 0.25 + abs(vTurn) * 0.15);
    vec3 col = mix(vec3(0.008, 0.05, 0.03), paint, core);
    float a = max(core * 0.8, rim * 0.4) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    // Convert from three.js's linear colour space to the screen's sRGB, like built-in
    // materials do. Without this the green comes out much darker than Stirling green.
    #include <colorspace_fragment>
  }
`

// The faint strip under the arrows: brighter thin edges, shown over the same stretch of route.
const laneVertexShader = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  uniform float uUserS;
  uniform float uAheadEnd;
  uniform float uAheadM;
  uniform float uBehind;
  uniform float uSlope;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vSide = aSide;
    float d = aS - uUserS;
    vAlpha = smoothstep(-uBehind, 0.6, d) * (1.0 - smoothstep(uAheadM - ${TRAIL.fadeInM.toFixed(1)}, uAheadM, d)) * (1.0 - smoothstep(uAheadEnd - 0.5, uAheadEnd, aS)) * uOpacity;
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
    float a = (0.22 + edge * 0.38) * vAlpha;
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

/** Route distance where the visible arrows end: 30 m ahead, or the next corner if that is closer. */
export function visibleWindowEnd(turns, s) {
  const turn = nextTurn(turns, s)
  return Math.min(s + TRAIL.aheadM, turn ? turn.s : Infinity)
}

/**
 * @param THREE three.js namespace
 * @param route local route points [{x: east, y: north}] (metres)
 * @param o.approximate straight-line fallback: draw the arrows in amber
 * @param o.reducedMotion no flow along the arrows, and no pulse at the corners
 */
export function createArrowTrail(THREE, route, {approximate = false, reducedMotion = false} = {}) {
  const samples = resample(route, TRAIL.spacingM)
  const turns = findTurns(route, TRAIL.turnDeg)
  // The arrow nearest to each corner becomes the turn arrow; it replaces its two neighbours.
  const turnAt = new Map(turns.map((t) => [Math.round(t.s / TRAIL.spacingM), t]))

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
      uAheadEnd: {value: visibleWindowEnd(turns, 0)},
      uAheadM: {value: TRAIL.aheadM},
      uOpacity: {value: 1},
      uMotion: {value: reducedMotion ? 0 : 1},
      uBehind: {value: TRAIL.behindM},
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
  const scale = new THREE.Vector3()
  const pos = new THREE.Vector3()

  samples.forEach((p, i) => {
    const turn = turnAt.get(i)
    const besideTurn = !turn && (turnAt.has(i - 1) || turnAt.has(i + 1))
    aS[i] = p.s
    aTurn[i] = turn ? Math.sign(turn.angle) : 0
    // A corner arrow faces the way the user comes in, whichever side of the corner it falls.
    const heading = turn ? incomingHeading(route, turn) : p.heading
    // Compass heading h -> rotation about Y of -h (north is -Z, east is +X).
    q.setFromAxisAngle(up, (-heading * Math.PI) / 180)
    const k = turn ? TRAIL.turnScale : besideTurn ? 0 : 1
    scale.set(k, 1, k)
    pos.set(p.x, TRAIL.heightM, -p.y)
    m.compose(pos, q, scale)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1))
  geometry.setAttribute('aTurn', new THREE.InstancedBufferAttribute(aTurn, 1))

  const lane = laneGeometryData(samples)
  const laneGeometry = new THREE.BufferGeometry()
  laneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lane.positions, 3))
  laneGeometry.setAttribute('aS', new THREE.Float32BufferAttribute(lane.aS, 1))
  laneGeometry.setAttribute('aSide', new THREE.Float32BufferAttribute(lane.aSide, 1))
  laneGeometry.setIndex(lane.index)
  const {uUserS, uAheadEnd, uAheadM, uOpacity, uBehind, uSlope, uColor, uGlow} = material.uniforms
  const laneMaterial = new THREE.ShaderMaterial({
    vertexShader: laneVertexShader,
    fragmentShader: laneFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false, // nothing solid is drawn over a camera feed, and it lies on the ground anyway
    side: THREE.DoubleSide,
    uniforms: {uUserS, uAheadEnd, uAheadM, uOpacity, uBehind, uSlope, uColor, uGlow},
  })
  const laneMesh = new THREE.Mesh(laneGeometry, laneMaterial)
  laneMesh.frustumCulled = false
  laneMesh.renderOrder = 1

  let shownS = 0
  let shownEnd = material.uniforms.uAheadEnd.value
  let wantOpacity = 1

  return {
    mesh,
    lane: laneMesh,
    samples,
    turns,
    get windowEnd() {
      return shownEnd
    },
    get opacity() {
      return uOpacity.value
    },
    /** Fade all the arrows out (0) or in (1). */
    setOpacity(value) {
      wantOpacity = value
    },
    /** The ground's rise per metre along the route. */
    setSlope(slope) {
      material.uniforms.uSlope.value = slope
    },
    /** Ease towards the user's distance along the route; returns how many arrows are visible. */
    update(targetS, dt, time) {
      const k = 1 - Math.exp(-dt / TRAIL.easeS)
      shownS += (targetS - shownS) * k
      // Grows gently after a corner, but never lags past the limit when it shrinks.
      const end = visibleWindowEnd(turns, shownS)
      shownEnd = Math.min(end, shownEnd + (end - shownEnd) * (1 - Math.exp(-dt / TRAIL.windowEaseS)))
      uOpacity.value += (wantOpacity - uOpacity.value) * (1 - Math.exp(-dt / TRAIL.fadeS))
      material.uniforms.uUserS.value = shownS
      material.uniforms.uAheadEnd.value = shownEnd
      material.uniforms.uTime.value = time
      return visibleCount(aS, shownS, shownEnd)
    },
    /** Set without easing (first placement only). */
    reset(s = 0) {
      shownS = s
      shownEnd = visibleWindowEnd(turns, s)
      material.uniforms.uUserS.value = s
      material.uniforms.uAheadEnd.value = shownEnd
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      laneGeometry.dispose()
      laneMaterial.dispose()
    },
  }
}

function incomingHeading(route, turn) {
  const a = route[turn.index - 1]
  const b = route[turn.index]
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI
}

/** Arrows inside the visible window (for the debug panel). aS is sorted ascending. */
export function visibleCount(aS, userS, windowEnd = userS + TRAIL.aheadM) {
  const lo = lowerBound(aS, userS - TRAIL.behindM)
  const hi = lowerBound(aS, windowEnd)
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
