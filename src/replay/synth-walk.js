// Phase 1: a synthetic walk along a planned route, written as a trip record (trip-recorder.js) with
// the ground truth in it. It stands in for a field log where the truth is known: the camera's
// SLAM pose drifts (heading drift per metre, scale error), the compass has a bias, noise and swings
// near buildings, GPS is metres off near buildings and worse indoors. Seeded, so it repeats.
import {fromLocal, localBearing, pointAt, polylineLength, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {routeToLocal} from '../ar/nav-scene.js'
import {levelAt, levelsAlong} from '../route/nav-pose.js'
import {createHeightProfile} from '../scene/route-height.js'
import {entranceIndex} from '../ar/entrance-anchor.js'
import {createTripRecorder} from './trip-recorder.js'

/** mulberry32: a small seeded random generator, 0..1. */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rad = (d) => (d * Math.PI) / 180
const wrap = (d) => ((d % 360) + 360) % 360

/** A camera quaternion facing world bearing `bearingDeg` (clockwise from -Z), pitched `pitchDeg`. */
export function cameraQuaternion(bearingDeg, pitchDeg = -10) {
  const yaw = -rad(bearingDeg) / 2
  const pitch = rad(pitchDeg) / 2
  const [ys, yc, ps, pc] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch)]
  // q = qYaw (about Y) * qPitch (about X)
  return {x: yc * ps, y: ys * pc, z: -ys * ps, w: yc * pc}
}

export const DEFAULT_DRIFT = {
  headingDegPerM: 0.35, // SLAM heading drift, degrees per metre walked (sign from the seed)
  scale: 0.03, // SLAM scale error, up to this (sign from the seed)
  compassBiasDeg: 8, // a steady compass error, up to this
  compassNoiseDeg: 3,
  buildingSwingDeg: 25, // near (within 15 m of the door) and inside buildings the compass swings this much
  gpsOutdoorM: 6, // typical GPS error in the open
  gpsBuildingM: 13, // next to buildings
  gpsIndoorM: 30, // inside
  heightDriftPerM: 0.004, // SLAM's height drifts this much per metre walked (sign from the seed)
}

// Phase 4: a floor change the route draws as a vertical link (a stair core or a lift shaft, under
// 1 m of horizontal run) is walked as it really is: a lift is a wait and then a ride in place; a
// stair is a switchback, out and back while climbing, landing near where it started.
export const VERTICAL = {
  maxRunM: 1, // a level change with less horizontal run than this is a vertical link
  liftWaitS: 4,
  liftMps: 1, // the ride, vertical metres per second
  liftOutS: 2,
  flightM: 3.5, // a switchback stair: this far out, and back
  stairMps: 0.6, // along the stair, slower than walking
}

/**
 * route: a planned route ({points, indoorPoints, entrance, lengthM, totalM, source}).
 * startPoint: a chosen start (manual), or null for a GPS start. facing: 'path' or 'away' at the start.
 * Returns the record as JSON (what a phone would download), with truth events.
 */
export function synthWalk({route, destination, startPoint = null, seed = 1, facing = 'path', drift = {}, fps = 30, speedMps = 1.3, standS = 3, endPauseS = 3}) {
  const d = {...DEFAULT_DRIFT, ...drift}
  const rand = seeded(seed)
  const gauss = () => {
    const u = Math.max(1e-9, rand())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const sign = () => (rand() < 0.5 ? -1 : 1)
  const points = [...route.points, ...(route.indoorPoints ?? []).slice(1)]
  const truthOrigin = points[0]
  const local = routeToLocal(truthOrigin, points)
  const lengthM = polylineLength(local)
  const heightAt = createHeightProfile(points, local, truthOrigin)
  const levels = levelsAlong(points, truthOrigin)
  const door = entranceIndex(points)
  const doorS = door > 0 ? projectOntoPolyline(local, toLocal(truthOrigin, points[door])).s : null
  const trueBearing = (s) => localBearing(pointAt(local, Math.max(0, s - 0.5)), pointAt(local, Math.min(lengthM, s + 2)))
  // Vertical links along the route, and each indoor level's floor height (for the true level).
  // Per point (routeToLocal drops repeated points, so it cannot be indexed like `points`).
  const pl = points.map((p) => toLocal(truthOrigin, p))
  const sAt = []
  pl.forEach((q, i) => sAt.push(i ? sAt[i - 1] + Math.hypot(q.x - pl[i - 1].x, q.y - pl[i - 1].y) : 0))
  // The true height at s: each point's own h (or its floor's), linear along a walked segment, a
  // step at a vertical link. (createHeightProfile places points by projection, which smears a
  // vertical link with no run into a ramp: right for the arrows, wrong for the walker's height.)
  const ownH = points.every((p) => Number.isFinite(p.h)) ? points.map((p) => p.h) : null
  const exactH = (sq) => {
    if (!ownH) return heightAt(sq)
    let k = 0
    while (k + 1 < sAt.length && sAt[k + 1] <= sq) k++
    if (k + 1 >= sAt.length) return ownH.at(-1)
    const span = sAt[k + 1] - sAt[k]
    return span > 1e-6 ? ownH[k] + ((ownH[k + 1] - ownH[k]) * (sq - sAt[k])) / span : ownH[k + 1]
  }
  const links = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a.z || !b.z || a.z === b.z) continue
    if (Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y) >= VERTICAL.maxRunM) continue
    const kind = b.edgeType === 'lift' || a.edgeType === 'lift' ? 'lift' : 'stairs'
    links.push({id: i, s: sAt[i - 1], sTop: sAt[i], hFoot: ownH ? ownH[i - 1] : heightAt(sAt[i - 1]), kind, rise: (ownH ? ownH[i] - ownH[i - 1] : heightAt(sAt[i] + 0.01) - heightAt(sAt[i - 1])), done: false})
  }
  // A level change walked along a sloped stretch (a MazeMap stair drawn with its run): which one at s.
  const slopedAt = (sq) => {
    for (let i = 1; i < points.length; i++) {
      if (!points[i - 1].z || !points[i].z || points[i - 1].z === points[i].z) continue
      if (sAt[i] - sAt[i - 1] < VERTICAL.maxRunM) continue
      if (sq >= sAt[i - 1] && sq < sAt[i]) return i
    }
    return null
  }
  const levelH = new Map()
  // Each level's floor height: the height most of its points have (a fitted stair puts its first
  // point on the next level halfway up the flight, which is not the floor).
  const byLevel = new Map()
  points.forEach((p, i) => {
    if (!p.z) return
    const h = Math.round((ownH ? ownH[i] : heightAt(sAt[i] + 0.001)) * 10) / 10
    if (!byLevel.has(p.z)) byLevel.set(p.z, new Map())
    byLevel.get(p.z).set(h, (byLevel.get(p.z).get(h) ?? 0) + 1)
  })
  for (const [z, counts] of byLevel) levelH.set(z, [...counts].sort((a, b) => b[1] - a[1])[0][0])
  /** Indoors, the level whose floor is nearest the user's height; outdoors, the route's. */
  const trueLevel = (s, h) => {
    const z = levelAt(levels, s)
    if (!z || !levelH.size) return z
    let best = z
    for (const [level, lh] of levelH) if (Math.abs(lh - h) < Math.abs((levelH.get(best) ?? Infinity) - h)) best = level
    return best
  }

  // The steady errors of this walk.
  const driftPerM = sign() * d.headingDegPerM * (0.5 + 0.5 * rand())
  const scale = 1 + sign() * d.scale * rand()
  const compassBias = sign() * d.compassBiasDeg * rand()
  const heightDrift = sign() * d.heightDriftPerM
  const gpsBias = {x: gauss() * d.gpsOutdoorM * 0.7, y: gauss() * d.gpsOutdoorM * 0.7}

  // GPS: the fix the location step would have used becomes the trip origin (as in the app).
  const gpsError = (s, indoors) => {
    const nearDoor = doorS != null && Math.abs(s - doorS) < 15
    const m = indoors ? d.gpsIndoorM : nearDoor ? d.gpsBuildingM : d.gpsOutdoorM
    const k = m / d.gpsOutdoorM
    return {x: gpsBias.x * k + gauss() * m * 0.35, y: gpsBias.y * k + gauss() * m * 0.35, acc: Math.max(4, m * (0.8 + 0.4 * rand()))}
  }
  const firstErr = gpsError(0, false)
  const firstFix = {...fromLocal(truthOrigin, {x: firstErr.x, y: firstErr.y}), accuracy: firstErr.acc}
  const origin = startPoint ?? {lat: firstFix.lat, lng: firstFix.lng}

  let clockMs = 0
  const rec = createTripRecorder({clock: () => clockMs, maxEvents: 500000})
  rec.meta({
    synthetic: {seed, facing, drift: d, driftPerM, scale, compassBias},
    destination,
    route,
    origin,
    startPoint,
    autoStart: !startPoint,
    allowDesktop: false,
  })

  const h0 = wrap(trueBearing(0) + (facing === 'away' ? 180 : 0)) // where the user faces at the start
  let worldYawOffset = h0 // world bearing = true bearing - this (the SLAM world starts facing -Z)
  const world = {x: 0, z: 0}
  let s = 0
  let walked = 0
  let facingDeg = h0
  let lastCompassAt = -Infinity
  let lastGpsAt = -Infinity
  const dt = 1 / fps
  const walkStartS = standS
  const totalS = standS + lengthM / (speedMps * 0.8) + endPauseS + 30
  let started = false
  let episode = null // a vertical link being climbed: {link, t0, v (m above the link's foot), out {x, y}}

  rec.tracking('LIMITED', 'INITIALIZING')
  for (let time = 0; time < totalS; time += dt) {
    clockMs = Math.round(time * 1000)
    if (time >= 0.8 && time - dt < 0.8) rec.tracking('NORMAL')
    if (startPoint && !started && time >= standS - 0.5) {
      started = true
      rec.action('start', [])
    }
    // Walk: slower on stairs, and only once facing the path.
    const want = trueBearing(s)
    const walking = time >= walkStartS && s < lengthM
    const link = !episode && walking ? links.find((l) => !l.done && s >= l.s) : null
    if (link) {
      s = link.s
      episode = {link, t0: time, v: 0, out: {x: 0, y: 0}, outDeg: facingDeg}
    }
    if (episode) {
      const {link: L} = episode
      const t = time - episode.t0
      const up = Math.abs(L.rise)
      if (L.kind === 'lift') {
        const ride = up / VERTICAL.liftMps
        episode.v = Math.sign(L.rise) * Math.min(up, Math.max(0, t - VERTICAL.liftWaitS) * VERTICAL.liftMps)
        if (t >= VERTICAL.liftWaitS + ride + VERTICAL.liftOutS) episode.done = true
      } else {
        // Out and back along a switchback: the way the user faced, then turned round at the landing.
        const total = 2 * VERTICAL.flightM
        const along = Math.min(total, t * VERTICAL.stairMps)
        const outM = along <= VERTICAL.flightM ? along : total - along
        const dir = along <= VERTICAL.flightM ? episode.outDeg : wrap(episode.outDeg + 180)
        const before = {...episode.out}
        episode.out = {x: Math.sin(rad(episode.outDeg)) * outM, y: Math.cos(rad(episode.outDeg)) * outM}
        episode.v = L.rise * (along / total)
        facingDeg = wrap(facingDeg + Math.max(-120 * dt, Math.min(120 * dt, ((dir - facingDeg + 540) % 360) - 180)))
        const m = Math.hypot(episode.out.x - before.x, episode.out.y - before.y)
        if (m > 0) {
          const bearing = localBearing(before, episode.out) - worldYawOffset
          world.x += Math.sin(rad(bearing)) * m * scale
          world.z -= Math.cos(rad(bearing)) * m * scale
          walked += m
          worldYawOffset = h0 - driftPerM * walked
        }
        if (along >= total) episode.done = true
      }
      if (episode.done) {
        L.done = true
        s = Math.min(lengthM, L.sTop + 0.02) // on the landing: past the link's top, the next floor
        episode = null
      }
    } else if (walking) {
      const turn = ((want - facingDeg + 540) % 360) - 180
      facingDeg = wrap(facingDeg + Math.max(-120 * dt, Math.min(120 * dt, turn)))
      if (Math.abs(turn) < 40) {
        const slope = Math.abs(exactH(s + 1) - exactH(s))
        const step = (slope > 0.15 ? speedMps * 0.5 : speedMps) * dt
        const before = pointAt(local, s)
        s = Math.min(lengthM, s + step)
        const after = pointAt(local, s)
        // The SLAM world sees the true step turned by the accumulated drift, and scaled.
        const bearing = localBearing(before, after) - worldYawOffset
        const m = Math.hypot(after.x - before.x, after.y - before.y)
        world.x += Math.sin(rad(bearing)) * m * scale
        world.z -= Math.cos(rad(bearing)) * m * scale
        walked += m
        worldYawOffset = h0 - driftPerM * walked
      }
    }
    // On a link the height is its foot's plus the climb so far; after it, the next floor's.
    const h = episode ? episode.link.hFoot + episode.v : exactH(s)
    const level = trueLevel(s, h)
    const indoors = level !== 0
    const core = pointAt(local, s)
    const truePos = episode ? {x: core.x + episode.out.x, y: core.y + episode.out.y} : core
    // The camera: its SLAM position and orientation (heading drifts with the world).
    const camBearing = wrap(facingDeg - worldYawOffset)
    rec.frame({dt, time, camera: {position: {x: world.x, y: 1.5 + h * scale + heightDrift * walked, z: world.z}, quaternion: cameraQuaternion(camBearing)}})
    const ll = fromLocal(truthOrigin, truePos)
    const sloped = episode ? null : slopedAt(s)
    rec.truth({s, x: truePos.x, y: truePos.y, lat: ll.lat, lng: ll.lng, level, headingDeg: facingDeg, pathDeg: want, walking: walking || Boolean(episode), vertical: episode ? episode.link.kind : sloped != null ? 'stairs' : null, linkId: episode ? episode.link.id : sloped, heightM: h})
    // Compass at 20 Hz: bias, noise, and a swing near and inside buildings.
    if (time - lastCompassAt >= 0.05) {
      lastCompassAt = time
      const nearDoor = doorS != null && Math.abs(s - doorS) < 15
      const swing = indoors || nearDoor ? d.buildingSwingDeg * Math.sin(time * 2 * Math.PI * 0.3) : 0
      rec.compass({heading: wrap(facingDeg + compassBias + swing + gauss() * d.compassNoiseDeg), accuracy: indoors || nearDoor ? 25 : 10, source: 'webkitCompassHeading', beta: 80})
    }
    // GPS at 1 Hz.
    if (time - lastGpsAt >= 1) {
      lastGpsAt = time
      const e = time === 0 ? firstErr : gpsError(s, indoors)
      const fix = fromLocal(truthOrigin, {x: truePos.x + e.x, y: truePos.y + e.y})
      rec.gps({latitude: fix.lat, longitude: fix.lng, accuracy: e.acc}, clockMs)
    }
    if (s >= lengthM && !episode && links.every((l) => l.done) && time > walkStartS + lengthM / speedMps + endPauseS) break
  }
  return rec.toJSON()
}
