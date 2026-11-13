// Puts the walking route into the AR world.
//
// Frames:
//   GPS (lat/lng) --toLocal--> route frame: metres, x = east, y = north, origin = trip start
//   route frame   ----------> "geo root" group: three.js x = east, y = up, z = -north
//   geo root      --align---> SLAM world: rotated so its north matches real north (compass),
//                             moved so the user's GPS position sits under the camera,
//                             at ground height y = 0 (8th Wall absolute scale).
import {dedupe, distanceM, findTurns, localBearing, pointAt, projectOntoPolyline, shortestTurn, simplify, toDeg, toLocal, toRad} from '../geo/geo.js'
import {createDestinationPin} from './pin.js'
import {createGroundArrows} from './ground-arrows.js'
import {buildShellMeshes, doorCrossings, wallsNear} from './building-shell.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {COLOURS, NAV_SCENE, PIN, ROUTING, SHELL, TURNS} from '../config.js'

/**
 * Yaw (radians, about +Y) that turns the route frame so that compass heading `headingDeg`
 * lines up with the camera's current forward direction.
 * cameraForward: {x, z} of the camera's look direction in SLAM world space.
 */
export function alignmentYaw(cameraForward, headingDeg) {
  const h = toRad(headingDeg)
  // A direction with compass heading h in the geo root is (sin h, -cos h) in (x, z).
  const geoAngle = Math.atan2(Math.sin(h), -Math.cos(h))
  const camAngle = Math.atan2(cameraForward.x, cameraForward.z)
  return camAngle - geoAngle
}

/** Rotate a geo-root point (x, z) by yaw about +Y, the same way three.js does. */
export function rotateY({x, z}, yaw) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: x * c + z * s, z: -x * s + z * c}
}

/**
 * Route GPS points -> clean local metres (duplicates removed, GPS zig-zags smoothed).
 * The tolerance is small so corners are not cut.
 */
export function routeToLocal(origin, points) {
  return simplify(dedupe(points.map((p) => toLocal(origin, p)), 0.3), 0.25)
}

/** Near the route, the user is ON it: GPS error should not put them beside it. */
export function snapToRoute(route, p) {
  const hit = projectOntoPolyline(route, p)
  return {x: hit.x, y: hit.y}
}

/**
 * Compass bearing of the route from distance s along it, over the next few metres.
 * A chord, because the first short segment of a real path can point anywhere.
 */
export function bearingAlong(route, s, aheadM = NAV_SCENE.startLookAheadM) {
  return localBearing(pointAt(route, s), pointAt(route, s + aheadM))
}

/**
 * @param {object} o
 * @param o.THREE  three.js
 * @param o.scene  three.js scene from 8th Wall
 * @param o.camera three.js camera from 8th Wall
 * @param o.route  {points: [{lat,lng}], lengthM, entrance}
 * @param o.origin {lat,lng} trip start (route frame origin)
 * @param o.name   destination name for the pin label
 * @param o.reducedMotion no flow, pulse or bobbing
 */
export function createNavScene({THREE, scene, camera, route, origin, name = null, reducedMotion = false}) {
  let local = routeToLocal(origin, route.points)
  let entranceLocal = toLocal(origin, route.entrance || route.points.at(-1))
  const lengthOf = (pts) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0)
  let totalM = lengthOf(local)

  const geoRoot = new THREE.Group()
  geoRoot.name = 'geo-root'
  geoRoot.visible = false
  scene.add(geoRoot)

  let turns = findTurns(local, TURNS.minDeg)
  const pin = createDestinationPin(THREE, {name})
  // The pin stands at the entrance, or at the room itself once setMarker() knows where it is.
  // Arrival is always judged at the entrance (entranceAnchor): a room can be indoors, upstairs.
  let markerLocal = null
  const pinAt = () => markerLocal ?? entranceLocal
  pin.group.position.set(pinAt().x, 0, -pinAt().y)
  geoRoot.add(pin.group)
  const entranceAnchor = new THREE.Object3D()
  entranceAnchor.position.set(entranceLocal.x, 0, -entranceLocal.y)
  geoRoot.add(entranceAnchor)
  // The way to walk: chevrons on the floor, built from this same route polyline.
  const arrows = createGroundArrows(THREE)
  arrows.setRoute(local, turns)
  geoRoot.add(arrows.group)
  let pinAllowed = true
  // The building's walls and doors (building-shell.js): an invisible occluder, a debug wireframe,
  // wall base lines for the line-up, and green outlines across the doorways on the route.
  const shellGroup = new THREE.Group()
  shellGroup.name = 'building-shell'
  geoRoot.add(shellGroup)
  let shell = null // {floor, meshes, doors}
  let occluderOn = false
  let wireOn = false
  let baseLines = null
  const doorMarks = Array.from({length: 3}, (_, i) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(15), 3))
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({color: 0x4ade80, transparent: true, opacity: 0.85, depthTest: false}))
    line.name = `doorway-${i}`
    line.renderOrder = 40
    line.visible = false
    geoRoot.add(line)
    return line
  })
  // Debug: the floor as the app sees it, a faint 10 m grid under the user.
  const floorGrid = new THREE.GridHelper(10, 20, COLOURS.arrowGreen, COLOURS.arrowGreen)
  floorGrid.material.transparent = true
  floorGrid.material.opacity = 0.35
  floorGrid.material.depthWrite = false
  floorGrid.visible = false
  scene.add(floorGrid)

  const forward = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  let aligned = false
  let yaw = 0
  let ease = null
  let groundY = 0
  let entranceS = projectOntoPolyline(local, entranceLocal).s
  let last = {s: 0, offset: 0, remainingM: totalM}

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
  }

  /** Where a GPS fix falls on the route, and which way the route heads from there. */
  function startInfo(userFix = origin) {
    const fix = toLocal(origin, userFix)
    const hit = projectOntoPolyline(local, fix)
    return {
      s: hit.s,
      offset: hit.offset,
      bearingDeg: bearingAlong(local, hit.s),
      pathBearingDeg: localBearing(fix, hit),
      onPath: hit.offset <= ROUTING.snapToPathM,
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
    if (Math.abs(delta) <= toRad(minDeg)) return false
    camera.getWorldPosition(camPos)
    const pivot = geoRoot.worldToLocal(camPos.clone())
    const here = {x: pivot.x, z: pivot.z}
    ease = {yaw, delta, t: 0, seconds: NAV_SCENE.realignEaseS, world: {x: camPos.x, z: camPos.z}, from: here, to: here}
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
      seconds: NAV_SCENE.matchEaseS,
      world: {x: geoRoot.position.x + rotated.x, z: geoRoot.position.z + rotated.z},
      from,
      to: {x: pivot.x + dx, z: -(pivot.y + dy)},
    }
    return true
  }

  /**
   * Turn the whole route about where the user stands, straight away (the line-up drag).
   * deltaRad > 0 turns it anticlockwise seen from above, < 0 clockwise.
   */
  function rotateAboutUser(deltaRad) {
    if (!aligned || !Number.isFinite(deltaRad)) return false
    ease = null
    camera.getWorldPosition(camPos)
    const pivot = geoRoot.worldToLocal(camPos.clone())
    yaw += deltaRad
    const rotated = rotateY({x: pivot.x, z: pivot.z}, yaw)
    geoRoot.rotation.set(0, yaw, 0)
    geoRoot.position.set(camPos.x - rotated.x, geoRoot.position.y, camPos.z - rotated.z)
    geoRoot.updateMatrixWorld(true)
    return true
  }

  /**
   * "I'm here" (or "I'm on Level n"): move the whole route so the user stands at route-frame point
   * p, straight away, keeping its direction. The line-up step then sets the direction.
   */
  function placeUserAt(p) {
    if (!aligned || !p) return false
    ease = null
    camera.getWorldPosition(camPos)
    const rotated = rotateY({x: p.x, z: -p.y}, yaw)
    geoRoot.position.set(camPos.x - rotated.x, geoRoot.position.y, camPos.z - rotated.z)
    geoRoot.updateMatrixWorld(true)
    return true
  }

  /** A new route, from a reroute. The placement stays, so the walk so far still lines up. */
  function setRoute(next) {
    local = routeToLocal(origin, next.points)
    if (shell) shell.doors = doorCrossings(local, shell.floor.doors)
    entranceLocal = toLocal(origin, next.entrance || next.points.at(-1))
    totalM = lengthOf(local)
    entranceS = projectOntoPolyline(local, entranceLocal).s
    turns = findTurns(local, TURNS.minDeg)
    arrows.setRoute(local, turns)
    pin.group.position.set(pinAt().x, pin.group.position.y, -pinAt().y)
    entranceAnchor.position.set(entranceLocal.x, 0, -entranceLocal.y)
  }

  /** Stand the pin at this {lat, lng} (the destination room), or back at the entrance with null. */
  function setMarker(point) {
    markerLocal = point ? toLocal(origin, point) : null
    pin.group.position.set(pinAt().x, pin.group.position.y, -pinAt().y)
  }

  /** Lay the route on the ground: its height at the user, and its slope along the route. */
  function setGround(height, slope, userS = last.s) {
    groundY = height
    geoRoot.position.y = height
    geoRoot.updateMatrixWorld(true)
    pin.group.position.y = Math.max(-PIN.maxLiftM, Math.min(PIN.maxLiftM, (entranceS - userS) * slope))
  }

  /** Step 3: the pin stands on the scene's floor at the destination (another level: higher or lower). */
  function setPinLift(h) {
    if (Number.isFinite(h)) pin.group.position.y = h
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
    if (floorGrid.visible) {
      camera.getWorldPosition(tmp)
      floorGrid.position.set(tmp.x, groundY, tmp.z)
    }
    if (!aligned) return last
    stepEase(dt)
    const p = whereAmI()
    // Straight-line distance from the camera to the entrance (arrival), and to the pin (its label).
    camera.getWorldPosition(tmp)
    const entranceWorld = entranceAnchor.getWorldPosition(new THREE.Vector3())
    const toPinM = Math.hypot(entranceWorld.x - tmp.x, entranceWorld.z - tmp.z)
    const pinWorld = pin.group.getWorldPosition(new THREE.Vector3())
    pin.update(reducedMotion ? 0 : time, Math.hypot(pinWorld.x - tmp.x, pinWorld.z - tmp.z), tmp)
    if (!pinAllowed) pin.group.visible = false
    const turn = nextTurn(turns, p.s)
    last = {
      s: p.s,
      offset: p.offset,
      remainingM: Math.max(0, totalM - p.s),
      toPinM,
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
    nextTurnAt: (s = whereAmI().s) => nextTurn(turns, s),
    realign,
    rotateAboutUser,
    placeUserAt,
    setPinLift,
    applyCorrection,
    worldToRoute,
    /** Route frame {x, y} -> a new world position on the ground. */
    routeToWorld: ({x, y}) => geoRoot.localToWorld(new THREE.Vector3(x, 0, -y)),
    setGround,
    routePosition,
    update,
    /** Show the floor the chevrons lie on as a grid (debug). */
    setFloorGrid(show) {
      floorGrid.visible = show
    },
    /**
     * Allow or hide the destination pin (not until the direction is known, and not while the
     * position is unsure). The ground arrows have their own rule: see updateArrows().
     */
    setVisible(show) {
      pinAllowed = show
      if (!show) pin.group.visible = false
    },
    /**
     * Lay the chevrons for this frame: userS from the pose, the ground slope, whether to show,
     * and their opacity (half while the floor is still a guess).
     */
    updateArrows({userS, slope, show, opacity = 1, dt = 0, time = 0, lift = null}) {
      return arrows.update({userS, slope, show: show && aligned, opacity, dt, time: reducedMotion ? 0 : time, camera, lift})
    },
    /**
     * The walls and doors of the floor in use (route frame, from floorToLocal). Replaces the
     * floor before. near: optional point and radius to keep only walls near the user (low fps).
     */
    setShellFloor(floor, {near = null} = {}) {
      if (shell) {
        shell.meshes.dispose()
        shellGroup.clear()
      }
      if (!floor) {
        shell = null
        return
      }
      const walls = near ? wallsNear(floor, near.point, near.metres) : floor.walls
      const meshes = buildShellMeshes(THREE, mergeGeometries, floor, {walls})
      meshes.occluder.visible = occluderOn
      meshes.wire.visible = wireOn
      meshes.baseLines.visible = false
      shellGroup.add(meshes.occluder, meshes.wire)
      shell = {floor, meshes, doors: doorCrossings(local, floor.doors)}
    },
    /** The occluder hides arrows behind walls. Off until the route is confirmed by the user or by walking. */
    setOccluder(on) {
      occluderOn = Boolean(on)
      if (shell) shell.meshes.occluder.visible = occluderOn
      arrows.setDepthTest(occluderOn && Boolean(shell))
    },
    /** ?debug=1: the shell as a see-through wireframe. */
    setWireframe(on) {
      wireOn = Boolean(on)
      if (shell) shell.meshes.wire.visible = wireOn
    },
    /** During the line-up: the base lines of the walls near the user, faint on the floor. */
    showWallLines(on, userPoint) {
      if (baseLines) {
        geoRoot.remove(baseLines.baseLines)
        baseLines.dispose()
        baseLines = null
      }
      if (!on || !shell || !userPoint) return 0
      const walls = wallsNear(shell.floor, userPoint, SHELL.lineUpWallsM)
      baseLines = buildShellMeshes(THREE, mergeGeometries, shell.floor, {walls})
      baseLines.baseLines.visible = true
      geoRoot.add(baseLines.baseLines)
      return walls.length
    },
    /** Green outlines across the doorways the route goes through within SHELL.doorMarkerAheadM. */
    updateDoorways(userS) {
      const ahead = shell ? shell.doors.filter((d) => d.s >= userS - 0.5 && d.s <= userS + SHELL.doorMarkerAheadM) : []
      doorMarks.forEach((line, i) => {
        const d = ahead[i]
        line.visible = Boolean(d)
        if (!d) return
        // A rectangle across the doorway, as wide as the door, flat on the floor.
        const ux = (d.b.x - d.a.x) / (d.widthM || 1)
        const uy = (d.b.y - d.a.y) / (d.widthM || 1)
        const half = SHELL.doorMarkerDepthM / 2
        const nx = -uy * half
        const ny = ux * half
        const pts = [
          [d.a.x + nx, d.a.y + ny],
          [d.b.x + nx, d.b.y + ny],
          [d.b.x - nx, d.b.y - ny],
          [d.a.x - nx, d.a.y - ny],
          [d.a.x + nx, d.a.y + ny],
        ]
        const pos = line.geometry.attributes.position
        pts.forEach(([x, y], k) => pos.setXYZ(k, x, 0.012, -y))
        pos.needsUpdate = true
        line.geometry.computeBoundingSphere()
      })
      return ahead.length
    },
    /** A slow phone: shorter arrows without shadows. */
    setLowPower(on) {
      arrows.setLowPower(on)
    },
    get shellLoaded() {
      return Boolean(shell)
    },
    get shellLevel() {
      return shell?.floor.level ?? null
    },
    /** Which way the arrows are when none is in view (screen angle), or null. */
    arrowsOffscreen: () => arrows.offscreenHint(camera),
    get turnRingsShown() {
      return arrows.ringsShown
    },
    /** How many chevrons are inside the camera's view. */
    arrowsInView: () => arrows.countInView(camera),
    /** Chevron i on screen (0..1) and its distance, for the blocked test; null if not testable. */
    arrowScreenSpot: (i) => arrows.screenSpot(i, camera),
    setArrowBlocked: (s, isBlocked) => arrows.setBlocked(s, isBlocked),
    get arrowsCreated() {
      return arrows.created
    },
    get arrowsShown() {
      return arrows.active
    },
    get arrowsVisible() {
      return arrows.visible
    },
    get arrowsBlocked() {
      return arrows.blockedCount
    },
    setRoute,
    setMarker,
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
      return toDeg(yaw)
    },
    get totalM() {
      return totalM
    },
    get turns() {
      return turns.length
    },
    dispose() {
      scene.remove(geoRoot)
      scene.remove(floorGrid)
      floorGrid.geometry.dispose()
      floorGrid.material.dispose()
      pin.dispose()
      shell?.meshes.dispose()
      baseLines?.dispose()
      for (const line of doorMarks) {
        line.geometry.dispose()
        line.material.dispose()
      }
      arrows.dispose()
    },
  }
}

/** The next corner the user has not passed yet, or null. turns: sorted by s. */
export function nextTurn(turns, s) {
  return turns.find((t) => t.s + TURNS.passedM > s) ?? null
}

/** Distance from a GPS fix to the route's entrance (for the debug panel). */
export function gpsDistanceToEntrance(fix, route) {
  return fix ? distanceM(fix, route.entrance || route.points.at(-1)) : null
}
