// Phase 1: metrics for a replayed trip (replay.js). With ground truth (a synthetic walk) they
// measure the build-plan targets directly; on a phone's log (no truth) only what the trip itself
// reported can be summarised, and those numbers are marked self-reported.
//   targets: heading error < 10° at first arrows, median offset from the path < 3 m outdoors and
//   < 1 m indoors, zero wrong-way moments (arrow > 45° off the path for > 2 s), the right door and
//   the right floor.
import {angleDiff, localBearing, pointAt, toLocal} from '../geo/geo.js'
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
  const floorFrames = walking.filter((x) => x.truth.level !== 0 && Number.isFinite(x.floorLevel) && !nearChange(x.truth.s))
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

/** One line per metric, for the console and the replay panel. */
export function formatMetrics(m) {
  const rows = Object.entries(m).filter(([k]) => k !== 'pass')
  const lines = rows.map(([k, v]) => `${k}: ${v}`)
  if (m.pass) lines.push(`targets: ${Object.entries(m.pass).map(([k, ok]) => `${k} ${ok ? 'PASS' : 'FAIL'}`).join(', ')}`)
  return lines
}
