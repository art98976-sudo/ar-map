// Puts the walking route into the AR world.
//
// Frames:
//   GPS (lat/lng) --toLocal--> route frame: metres, x = east, y = north, origin = trip start
//   route frame   ----------> "geo root" group: three.js x = east, y = up, z = -north
//   geo root      --align---> SLAM world: rotated so its north matches real north (compass),
//                             moved so the user's GPS position sits under the camera,
//                             at ground height y = 0 (8th Wall absolute scale).
import {dedupe, distanceM, projectOntoPolyline, simplify, toLocal} from '../geo/geo.js'
import {SNAP_TO_PATH_M} from '../nav/route.js'
import {createArrowTrail, nextTurn, TRAIL} from '../arrows/trail.js'
import {createGuideArrow} from '../arrows/guide-arrow.js'
import {createDestinationPin} from '../arrows/pin.js'

const START_LOOK_AHEAD_M = 8
const GUIDE_LOOK_AHEAD_M = 4

/**
 * Yaw (radians, about +Y) that turns the route frame so that compass heading `headingDeg`
 * lines up with the camera's current forward direction.
 * cameraForward: {x, z} of the camera's look direction in SLAM world space.
 */
export function alignmentYaw(cameraForward, headingDeg) {
  const h = (headingDeg * Math.PI) / 180
  // A direction with compass heading h in the geo root is (sin h, -cos h) in (x, z).
  const geoAngle = Math.atan2(Math.sin(h), -Math.cos(h))
  const camAngle = Math.atan2(cameraForward.x, cameraForward.z)
  return camAngle - geoAngle
}

/** Smallest signed turn (radians, -PI..PI) from yaw `from` to yaw `to`. */
export function shortestTurn(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** Rotate a geo-root point (x, z) by yaw about +Y, the same way three.js does. */
export function rotateY({x, z}, yaw) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: x * c + z * s, z: -x * s + z * c}
}

/**
 * Route GPS points -> clean local metres (duplicates removed, GPS zig-zags smoothed).
 * The tolerance is small so corners are not cut. The trail then resamples this to 1 m.
 */
export function routeToLocal(origin, points) {
  return simplify(dedupe(points.map((p) => toLocal(origin, p)), 0.3), 0.25)
}

/** Near the route, the user is ON it: GPS error should not put them beside it. */
export function snapToRoute(route, p, maxM = SNAP_TO_PATH_M) {
  void maxM
  const hit = projectOntoPolyline(route, p)
  return {x: hit.x, y: hit.y}
}

/**
 * Compass bearing of the route from distance s along it, over the next few metres.
 * A chord, because the first short segment of a real path can point anywhere.
 */
export function bearingAlong(route, s, aheadM = START_LOOK_AHEAD_M) {
  const a = pointAt(route, s)
  const b = pointAt(route, s + aheadM)
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI
  return (deg + 360) % 360
}

/** The point at distance s along a polyline, clamped to its ends. */
export function pointAt(route, s) {
  let walked = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + len >= s) {
      const t = len ? Math.max(0, (s - walked) / len) : 0
      return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}
    }
    walked += len
  }
  return route.at(-1)
}

const REALIGN_EASE_S = 0.5
const MATCH_EASE_S = 1

/**
 * @param {object} o
 * @param o.THREE  three.js
 * @param o.scene  three.js scene from 8th Wall
 * @param o.camera three.js camera from 8th Wall
 * @param o.route  {points: [{lat,lng}], lengthM, entrance}
 * @param o.origin {lat,lng} trip start (route frame origin)
 * @param o.name   destination name for the pin label
 */
export function createNavScene({THREE, scene, camera, route, origin, name}) {
  let local = routeToLocal(origin, route.points)
  let entranceLocal = toLocal(origin, route.entrance || route.points.at(-1))
  const lengthOf = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0)
  let totalM = lengthOf(local)
  const guideColor = (r) => (r.source === 'direct' ? TRAIL.approxColor : TRAIL.color)

  const geoRoot = new THREE.Group()
  geoRoot.name = 'geo-root'
  geoRoot.visible = false
  scene.add(geoRoot)

  let trail = createArrowTrail(THREE, local, {approximate: route.source === 'direct'})
  geoRoot.add(trail.lane)
  geoRoot.add(trail.mesh)
  const pin = createDestinationPin(THREE, {name})
  pin.group.position.set(entranceLocal.x, 0, -entranceLocal.y)
  geoRoot.add(pin.group)
  const guide = createGuideArrow(THREE, {color: guideColor(route)})
  scene.add(guide.mesh)

  const forward = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  let aligned = false
  let yaw = 0
  let ease = null
  let groundY = 0
  let finished = false
  let entranceS = projectOntoPolyline(local, entranceLocal).s
  const guideTarget = new THREE.Vector3()
  let last = {s: 0, offset: 0, remainingM: totalM, arrows: 0}

  /**
   * Place the route. headingDeg: the bearing the camera is taken to be facing right now.
   * userFix: best current GPS fix (where the user is standing), falls back to the origin.
   */
  function align(headingDeg, userFix = origin) {
    camera.getWorldDirection(forward)
    camera.getWorldPosition(camPos)
    yaw = alignmentYaw({x: forward.x, z: forward.z}, headingDeg)
    // Where the user stands in the route frame (geo root coordinates: x east, z = -north).
    const u = snapToRoute(local, toLocal(origin, userFix))
    const rotated = rotateY({x: u.x, z: -u.y}, yaw)
    geoRoot.rotation.set(0, yaw, 0)
    // Put the user's position under the camera, on the ground as tracked so far.
    geoRoot.position.set(camPos.x - rotated.x, groundY, camPos.z - rotated.z)
    geoRoot.updateMatrixWorld(true)
    ease = null
    aligned = true
    geoRoot.visible = true
    const s = whereAmI().s
    trail.reset(s)
  }

  /** Where a GPS fix falls on the route, and which way the route heads from there. */
  function startInfo(userFix = origin) {
    const fix = toLocal(origin, userFix)
    const hit = projectOntoPolyline(local, fix)
    const pathBearing = (Math.atan2(hit.x - fix.x, hit.y - fix.y) * 180) / Math.PI
    return {
      s: hit.s,
      offset: hit.offset,
      bearingDeg: bearingAlong(local, hit.s),
      pathBearingDeg: (pathBearing + 360) % 360,
      onPath: hit.offset <= SNAP_TO_PATH_M,
    }
  }

  /**
   * Correct the heading without a snap: ease the yaw over ~0.5 s, turning the route about the
   * point where the user stands, so their place on the route does not move.
   * Returns false (and does nothing) if the difference is not more than minDeg, or if another
   * correction is still easing: the next compass window gets another go.
   */
  function realign(headingDeg, minDeg = 0) {
    if (!aligned || ease) return false
    camera.getWorldDirection(forward)
    const delta = shortestTurn(yaw, alignmentYaw({x: forward.x, z: forward.z}, headingDeg))
    if (Math.abs(delta) <= (minDeg * Math.PI) / 180) return false
    camera.getWorldPosition(camPos)
    const pivot = geoRoot.worldToLocal(camPos.clone())
    const here = {x: pivot.x, z: pivot.z}
    ease = {yaw, delta, t: 0, seconds: REALIGN_EASE_S, world: {x: camPos.x, z: camPos.z}, from: here, to: here}
    return true
  }

  /**
   * Apply a map-matching correction (route-matcher.js), easing it over ~1 s. The correction moves
   * the walked track within the route frame, so the route moves the opposite way in the world
   * while the user's own spot in the world stays put.
   */
  function applyCorrection({dx, dy, yaw: turn, pivot}) {
    if (!aligned || ease) return false
    const from = {x: pivot.x, z: -pivot.y}
    const rotated = rotateY(from, yaw)
    ease = {
      yaw,
      delta: -turn,
      t: 0,
      seconds: MATCH_EASE_S,
      world: {x: geoRoot.position.x + rotated.x, z: geoRoot.position.z + rotated.z},
      from,
      to: {x: pivot.x + dx, z: -(pivot.y + dy)},
    }
    return true
  }

  /** A new route, from a reroute. The placement stays, so the walk so far still lines up. */
  function setRoute(next) {
    geoRoot.remove(trail.lane)
    geoRoot.remove(trail.mesh)
    trail.dispose()
    local = routeToLocal(origin, next.points)
    entranceLocal = toLocal(origin, next.entrance || next.points.at(-1))
    totalM = lengthOf(local)
    entranceS = projectOntoPolyline(local, entranceLocal).s
    trail = createArrowTrail(THREE, local, {approximate: next.source === 'direct'})
    geoRoot.add(trail.lane)
    geoRoot.add(trail.mesh)
    pin.group.position.set(entranceLocal.x, pin.group.position.y, -entranceLocal.y)
    guide.setColor(guideColor(next))
    if (aligned) trail.reset(whereAmI().s)
  }

  /** Arrived: no more arrows. The pin stays. */
  function finish() {
    finished = true
    trail.mesh.visible = false
    trail.lane.visible = false
    guide.mesh.visible = false
  }

  /** Lay the route on the ground: its height at the user, and its slope along the route. */
  function setGround(height, slope, userS = last.s) {
    groundY = height
    geoRoot.position.y = height
    geoRoot.updateMatrixWorld(true)
    trail.setSlope(slope)
    pin.group.position.y = Math.max(-TRAIL.maxLiftM, Math.min(TRAIL.maxLiftM, (entranceS - userS) * slope))
  }

  /** How far along the route a world point is, and how far off to the side. */
  function routePosition(point) {
    const hit = projectOntoPolyline(local, worldToRoute(point))
    return {s: hit.s, offset: hit.offset}
  }

  /** SLAM world (x, z) -> route frame (x east, y north) with the current placement. */
  function worldToRoute({x, z}) {
    const p = geoRoot.worldToLocal(tmp.set(x, 0, z))
    return {x: p.x, y: -p.z}
  }

  function stepEase(dt) {
    if (!ease) return
    ease.t = Math.min(1, ease.t + dt / ease.seconds)
    const k = ease.t * ease.t * (3 - 2 * ease.t)
    yaw = ease.yaw + ease.delta * k
    const rotated = rotateY({x: ease.from.x + (ease.to.x - ease.from.x) * k, z: ease.from.z + (ease.to.z - ease.from.z) * k}, yaw)
    geoRoot.rotation.set(0, yaw, 0)
    geoRoot.position.set(ease.world.x - rotated.x, groundY, ease.world.z - rotated.z)
    geoRoot.updateMatrixWorld(true)
    if (ease.t >= 1) ease = null
  }

  /** The user's position projected onto the route. */
  function whereAmI() {
    camera.getWorldPosition(tmp)
    geoRoot.worldToLocal(tmp)
    return projectOntoPolyline(local, {x: tmp.x, y: -tmp.z})
  }

  function userRoutePoint() {
    const p = whereAmI()
    return {x: p.x, y: p.y}
  }

  function routePointForFix(userFix = origin) {
    const p = projectOntoPolyline(local, toLocal(origin, userFix))
    return {x: p.x, y: p.y}
  }

  /** Call every frame. Returns stats for the UI and the debug panel. */
  function update(dt, time) {
    if (!aligned) return last
    stepEase(dt)
    const p = whereAmI()
    const arrows = trail.update(p.s, dt, time)
    // Straight-line distance from the camera to the entrance (what the pin shows).
    camera.getWorldPosition(tmp)
    const pinWorld = pin.group.getWorldPosition(new THREE.Vector3())
    const toPinM = Math.hypot(pinWorld.x - tmp.x, pinWorld.z - tmp.z)
    pin.update(time, toPinM, camera)
    if (!finished) {
      const ahead = pointAt(local, p.s + GUIDE_LOOK_AHEAD_M)
      geoRoot.localToWorld(guideTarget.set(ahead.x, 0, -ahead.y))
      guide.update(dt, camera, guideTarget)
    }
    const turn = nextTurn(trail.turns, p.s)
    last = {
      s: p.s,
      offset: p.offset,
      remainingM: Math.max(0, totalM - p.s),
      toPinM,
      arrows,
      nextTurnM: turn ? Math.max(0, turn.s - p.s) : null,
      nextTurnDir: turn ? (turn.angle > 0 ? 'right' : 'left') : null,
    }
    return last
  }

  return {
    align,
    startInfo,
    userRoutePoint,
    routePointForFix,
    nextTurnAt: (s = whereAmI().s) => nextTurn(trail.turns, s),
    realign,
    applyCorrection,
    worldToRoute,
    setGround,
    routePosition,
    update,
    setRoute,
    finish,
    get route() {
      return local
    },
    get easing() {
      return ease != null
    },
    get aligned() {
      return aligned
    },
    get yawDeg() {
      return (yaw * 180) / Math.PI
    },
    get totalM() {
      return totalM
    },
    get turns() {
      return trail.turns.length
    },
    get arrowCount() {
      return trail.samples.length
    },
    dispose() {
      scene.remove(geoRoot)
      scene.remove(guide.mesh)
      guide.dispose()
      trail.dispose()
      pin.dispose()
    },
  }
}

/** Distance from a GPS fix to the route's entrance (for the debug panel). */
export function gpsDistanceToEntrance(fix, route) {
  return fix ? distanceM(fix, route.entrance || route.points.at(-1)) : null
}
