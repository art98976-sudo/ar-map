// Phase 1: metrics for a replayed trip (replay.js). With ground truth (a synthetic walk) they
// measure the build-plan targets directly; on a phone's log (no truth) only what the trip itself
// reported can be summarised, and those numbers are marked self-reported.
//   targets: heading error < 10° at first arrows, median offset from the path < 3 m outdoors and
//   < 1 m indoors, zero wrong-way moments (arrow > 45° off the path for > 2 s), the right door and
//   the right floor.
import {angleDiff, localBearing, pointAt, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {entranceIndex} from '../ar/entrance-anchor.js'
import {routeToLocal} from '../ar/nav-scene.js'

export const TARGETS = {headingDeg: 10, offsetOutdoorM: 3, offsetIndoorM: 1, wrongWayDeg: 45, wrongWayS: 2, doorM: 3}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const max = (xs) => (xs.length ? Math.max(...xs) : null)
const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)

/** result: from replayTrip. Returns a flat object of metrics, and `pass` per target when truth exists. */
export function tripMetrics(result) {
  const samples = result.samples ?? []
  const hasTruth = samples.some((x) => x.truth)
  const first = samples[0]?.t ?? 0
  const firstArrows = samples.find((x) => x.arrowsShown)
  const walkStart = samples.find((x) => x.truth?.walking)
  const out = {
    truth: hasTruth,
    frames: samples.length,
    durationS: round(((samples.at(-1)?.t ?? 0) - first) / 1000, 1),
    timeToFirstArrowsS: firstArrows ? round((firstArrows.t - first) / 1000, 1) : null,
    arrowsHiddenShare: null,
    reroutes: (result.events ?? []).filter((e) => e.name === 'reroute').length,
    reanchors: (result.events ?? []).filter((e) => e.name === 'entrance-anchor').length,
  }
  const walking = samples.filter((x) => (hasTruth ? x.truth?.walking : x.phase === 'ready'))
  out.arrowsHiddenShare = walking.length ? round(walking.filter((x) => !x.arrowsShown).length / walking.length, 3) : null

  if (!hasTruth) {
    // A phone log: what the trip said about itself.
    const off = walking.map((x) => Math.abs(x.lateralOffsetM)).filter(Number.isFinite)
    out.selfReported = true
    out.selfOffsetMedianM = round(median(off))
    out.selfOffsetMaxM = round(max(off))
    out.positionUncertainShare = walking.length ? round(walking.filter((x) => x.positionUncertain).length / walking.length, 3) : null
    return out
  }

  const origin = result.meta.route.points[0]
  const local = (p) => toLocal(origin, p)
  const pts = [...result.meta.route.points, ...(result.meta.route.indoorPoints ?? []).slice(1)]
  // Heading: the trip's idea of where the camera faces, against where it truly faces.
  const headErr = (x) => (Number.isFinite(x.trackedHeadingDeg) ? Math.abs(angleDiff(x.truth.headingDeg, x.trackedHeadingDeg)) : null)
  out.headingErrorAtFirstArrowsDeg = firstArrows?.truth ? round(headErr(firstArrows), 1) : null
  out.timeToFirstArrowsAfterWalkS = firstArrows && walkStart ? round((firstArrows.t - walkStart.t) / 1000, 1) : null
  const headWalking = walking.map(headErr).filter(Number.isFinite)
  out.headingErrorMedianDeg = round(median(headWalking), 1)
  out.headingErrorMaxDeg = round(max(headWalking), 1)

  // Offset from the path: where the trip puts the user against where they are, across the path
  // (that is how far the drawn path is off to the side), and along it.
  const offsets = {out: [], in: [], along: []}
  for (const x of walking) {
    if (!x.user) continue
    const u = local(x.user)
    const tl = local({lat: x.truth.lat, lng: x.truth.lng})
    const dx = u.x - tl.x
    const dy = u.y - tl.y
    const r = (x.truth.pathDeg * Math.PI) / 180
    const across = Math.abs(dx * Math.cos(r) - dy * Math.sin(r))
    const along = Math.abs(dx * Math.sin(r) + dy * Math.cos(r))
    ;(x.truth.level === 0 ? offsets.out : offsets.in).push(across)
    offsets.along.push(along)
  }
  out.offsetOutdoorMedianM = round(median(offsets.out))
  out.offsetOutdoorMaxM = round(max(offsets.out))
  out.offsetIndoorMedianM = round(median(offsets.in))
  out.offsetIndoorMaxM = round(max(offsets.in))
  out.alongErrorMedianM = round(median(offsets.along))
  out.alongErrorMaxM = round(max(offsets.along))

  // Wrong way: the ground arrows under the user run along the route where the trip thinks the
  // user is (userS), turned in the real world by the trip's heading error. More than 45° off the
  // way the real path goes, for over 2 s, is a wrong-way moment.
  const routeLocal = routeToLocal(origin, pts)
  const routeDeg = (s) => localBearing(pointAt(routeLocal, Math.max(0, s - 0.5)), pointAt(routeLocal, s + 2))
  const chevronErr = (x) => {
    if (!Number.isFinite(x.userS) || !Number.isFinite(x.trackedHeadingDeg)) return null
    const shown = routeDeg(x.userS) + angleDiff(x.trackedHeadingDeg, x.truth.headingDeg) // into the real world
    return Math.abs(angleDiff(x.truth.pathDeg, shown))
  }
  let badSince = null
  let wrongWay = 0
  let wrongWayS = 0
  const chevronErrors = []
  for (const x of walking) {
    const err = x.arrowsShown ? chevronErr(x) : null
    if (err != null) chevronErrors.push(err)
    const bad = err != null && err > TARGETS.wrongWayDeg
    if (bad) {
      if (badSince == null) badSince = x.t
      else if (x.t - badSince > TARGETS.wrongWayS * 1000 && badSince !== -1) {
        wrongWay += 1
        badSince = -1 // counted; wait until it ends
      }
      wrongWayS += 1 / 30
    } else badSince = null
  }
  out.wrongWayMoments = wrongWay
  out.wrongWayS = round(wrongWayS, 1)
  out.arrowErrorMedianDeg = round(median(chevronErrors), 1)
  // For reading only: the single guide arrow aims at the next leg before a corner, by design.
  const guideErr = walking.filter((x) => x.arrowsShown && Number.isFinite(x.guideDeg)).map((x) => Math.abs(angleDiff(x.truth.pathDeg, x.truth.headingDeg + x.guideDeg)))
  out.guideArrowOffPathMedianDeg = round(median(guideErr), 1)

  // The door: when the user truly passes it, does the trip put them there?
  const di = entranceIndex(pts)
  if (di > 0) {
    const doorLocal = local(pts[di])
    const atDoor = walking.find((x) => x.truth.level !== 0 && x.user)
    out.doorErrorM = atDoor ? round(Math.hypot(local(atDoor.user).x - doorLocal.x, local(atDoor.user).y - doorLocal.y)) : null
  }
  // The floor: frames where the trip's floor is not the true one, away from the stairs themselves.
  const changes = walking.filter((x, i) => i > 0 && x.truth.level !== walking[i - 1].truth.level).map((x) => x.truth.s)
  const nearChange = (s) => changes.some((c) => Math.abs(c - s) < 3)
  // Not on the stair or in the lift itself: the floor changes once the climb is most of a floor (Phase 4).
  const floorFrames = walking.filter((x) => x.truth.level !== 0 && !x.truth.vertical && Number.isFinite(x.floorLevel) && !nearChange(x.truth.s))
  out.wrongFloorS = round(floorFrames.filter((x) => x.floorLevel !== x.truth.level).length / 30, 1)

  out.pass = {
    heading: out.headingErrorAtFirstArrowsDeg != null && out.headingErrorAtFirstArrowsDeg < TARGETS.headingDeg,
    offsetOutdoor: out.offsetOutdoorMedianM != null && out.offsetOutdoorMedianM < TARGETS.offsetOutdoorM,
    offsetIndoor: out.offsetIndoorMedianM != null && out.offsetIndoorMedianM < TARGETS.offsetIndoorM,
    wrongWay: out.wrongWayMoments === 0,
    door: out.doorErrorM != null && out.doorErrorM < TARGETS.doorM,
    floor: out.wrongFloorS === 0,
  }
  return out
}

/**
 * Phase 3: the ground arrows against the real corridor, indoors, two ways.
 * placement: each frame with arrows shown (and not faded below `fadedBelow`), the chevrons from the
 *   trip's progress to GROUND_ARROWS.aheadM beyond it are where the route placement puts them; carried
 *   into the real world by the trip's errors (the tracked camera position against the true one, and
 *   the heading about it) they are measured against the true route (the corridor centre).
 * progress: how far the trip's progress along the route (where the arrows start) is from where the
 *   user truly is, along the route. Placement can be perfect with progress stuck behind the user.
 * Returns {frames, shownShare, fadedShare, medianM, p95M, maxM, over1mShare, progressP95M, progressMaxM}.
 */
export function arrowCorridorError(result, {aheadM = 10, stepM = 2, fadedBelow = 0.5, indoorOnly = true, fromS = -Infinity, toS = Infinity} = {}) {
  // Not on a stair or in a lift: there the walker is off the route's line by design (floorChanges).
  const samples = (result.samples ?? []).filter((x) => x.truth?.walking && !x.truth.vertical && (!indoorOnly || x.truth.level !== 0) && x.truth.s >= fromS && x.truth.s <= toS)
  const origin = result.meta.route.points[0]
  const pts = [...result.meta.route.points, ...(result.meta.route.indoorPoints ?? []).slice(1)]
  const route = routeToLocal(origin, pts)
  const frameErr = []
  const progressErr = []
  let faded = 0
  for (const x of samples) {
    if (!x.arrowsShown || !x.tracked || !Number.isFinite(x.userS) || !Number.isFinite(x.trackedHeadingDeg)) continue
    if (Number.isFinite(x.arrowOpacity) && x.arrowOpacity < fadedBelow) {
      faded += 1
      continue
    }
    const u = toLocal(origin, x.tracked)
    const t = toLocal(origin, {lat: x.truth.lat, lng: x.truth.lng})
    const d = (angleDiff(x.trackedHeadingDeg, x.truth.headingDeg) * Math.PI) / 180 // trip -> real world
    let worst = 0
    for (let a = 0; a <= aheadM; a += stepM) {
      const r = pointAt(route, x.userS + a)
      const v = {x: r.x - u.x, y: r.y - u.y}
      // Turned clockwise by d (bearings): where the chevron really lies, from where the user really is.
      const p = {x: t.x + v.x * Math.cos(d) + v.y * Math.sin(d), y: t.y - v.x * Math.sin(d) + v.y * Math.cos(d)}
      worst = Math.max(worst, projectOntoPolyline(route, p).offset)
    }
    frameErr.push(worst)
    progressErr.push(Math.abs(x.userS - x.truth.s))
  }
  const q = (list, f) => {
    const sorted = [...list].sort((a, b) => a - b)
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : null
  }
  return {
    frames: samples.length,
    shownShare: samples.length ? round(frameErr.length / samples.length, 3) : null,
    fadedShare: samples.length ? round(faded / samples.length, 3) : null,
    medianM: round(median(frameErr)),
    p95M: round(q(frameErr, 0.95)),
    maxM: round(max(frameErr)),
    over1mShare: frameErr.length ? round(frameErr.filter((e) => e > 1).length / frameErr.length, 3) : null,
    progressP95M: round(q(progressErr, 0.95)),
    progressMaxM: round(max(progressErr)),
  }
}

/**
 * Phase 4: each floor change of a synthetic walk (truth.vertical marks the stair or lift), judged:
 *   early    the trip left the old floor before the climb started (in the 5 s before it)
 *   strange  during the change the trip showed a floor that is neither the old nor the new one
 *   late     2 s after stepping off on to the new floor, the trip was not on it
 *   unstable after that, the trip left the new floor before the next change began
 *   landingM where the trip put the user (the tracked position) 2 s after stepping off, vs the truth
 * Returns [{from, to, kind, ok, early, strange, late, unstable, landingM}].
 */
export function floorChanges(result, {settleS = 2, beforeS = 5} = {}) {
  const xs = (result.samples ?? []).filter((x) => x.truth)
  const origin = result.meta.route.points[0]
  // Episodes: runs of frames on one stair or in one lift (back-to-back links are separate).
  const episodes = []
  for (let i = 0; i < xs.length; i++) {
    if (!xs[i].truth.vertical) continue
    let j = i
    while (j + 1 < xs.length && xs[j + 1].truth.vertical && xs[j + 1].truth.linkId === xs[i].truth.linkId) j++
    episodes.push({i0: i, i1: j})
    i = j
  }
  const out = []
  episodes.forEach((ep, k) => {
    const from = xs[ep.i0].truth.level
    const to = xs[ep.i1].truth.level
    if (from === to) return
    const t0 = xs[ep.i0].t
    const tLand = xs[ep.i1].t
    const nextStart = episodes[k + 1] ? xs[episodes[k + 1].i0].t : Infinity
    const at = (t) => xs.find((x) => x.t >= t) ?? xs.at(-1)
    const prevEnd = k > 0 ? xs[episodes[k - 1].i1].t + settleS * 1000 : -Infinity
    const before = xs.filter((x) => x.t >= Math.max(t0 - beforeS * 1000, prevEnd) && x.t < t0)
    const during = xs.slice(ep.i0, ep.i1 + 1)
    const settled = at(tLand + settleS * 1000)
    const after = xs.filter((x) => x.t >= settled.t && x.t < nextStart)
    const early = before.some((x) => x.floorLevel !== from)
    const strange = during.some((x) => x.floorLevel !== from && x.floorLevel !== to)
    const late = settled.floorLevel !== to
    const unstable = after.some((x) => x.floorLevel !== to)
    const tr = settled.tracked ? toLocal(origin, settled.tracked) : null
    const tt = toLocal(origin, {lat: settled.truth.lat, lng: settled.truth.lng})
    const landingM = tr ? round(Math.hypot(tr.x - tt.x, tr.y - tt.y)) : null
    out.push({from, to, kind: xs[ep.i0].truth.vertical, ok: !early && !strange && !late && !unstable, early, strange, late, unstable, landingM})
  })
  return out
}

/**
 * Phase 5: going in through the building door. doorS: the route's door (its first point on a
 * floor). Judged:
 *   anchored        the trip re-anchored at the entrance ('entrance-anchor')
 *   anchorOffM      how far the user truly was from the door, along the route, when it did
 *   rulesBefore     a wall rule acted (a snap) before the anchor: indoor walls before the door
 *   inside          the arrows from 2 m to 20 m inside: arrowCorridorError (visible arrows, 0-6 m)
 *   floorOk         2 m inside, the trip was on the door's floor
 */
export function doorSwitch(result, {insideFromM = 2, insideToM = 20} = {}) {
  const pts = [...result.meta.route.points, ...(result.meta.route.indoorPoints ?? []).slice(1)]
  const di = entranceIndex(pts)
  if (di <= 0) return null
  const origin = pts[0]
  const local = pts.map((p) => toLocal(origin, p))
  let doorS = 0
  for (let i = 1; i <= di; i++) doorS += Math.hypot(local[i].x - local[i - 1].x, local[i].y - local[i - 1].y)
  const events = result.events ?? []
  const anchor = events.find((e) => e.name === 'entrance-anchor')
  const truthAt = (t) => (result.samples ?? []).find((x) => x.t >= t && x.truth)?.truth
  const atAnchor = anchor ? truthAt(anchor.t) : null
  const rulesBefore = events.some((e) => e.name === 'wall-snap' && (!anchor || e.t < anchor.t))
  const inside = arrowCorridorError(result, {aheadM: 6, fromS: doorS + insideFromM, toS: doorS + insideToM})
  const twoIn = (result.samples ?? []).find((x) => x.truth && x.truth.s >= doorS + insideFromM)
  const floorOk = Boolean(twoIn) && twoIn.floorLevel === pts[di].z
  return {doorS: round(doorS, 1), anchored: Boolean(anchor), anchorOffM: atAnchor ? round(Math.abs(atAnchor.s - doorS)) : null, rulesBefore, inside, floorOk}
}

/** One line per metric, for the console and the replay panel. */
export function formatMetrics(m) {
  const rows = Object.entries(m).filter(([k]) => k !== 'pass')
  const lines = rows.map(([k, v]) => `${k}: ${v}`)
  if (m.pass) lines.push(`targets: ${Object.entries(m.pass).map(([k, ok]) => `${k} ${ok ? 'PASS' : 'FAIL'}`).join(', ')}`)
  return lines
}
