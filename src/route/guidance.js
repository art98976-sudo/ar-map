// Turn-by-turn guidance. Pure logic: no GPS, no three.js. (Off route and arrival: trip-monitors.js.)
// Positions are distances along the route, from projecting the SLAM position onto it, so GPS
// noise cannot reach them.
import {findTurns, pointAt, polylineLength, projectOntoPolyline, toLocal} from '../geo/geo.js'
import {GUIDE} from '../config.js'
import {getDirections} from '../i18n/i18n.js'
import {landmarkPhrase} from '../i18n/directions-en.js'

// "the Atrium", "Scran": the English phrasing lives with the English directions (item 13).
export {landmarkPhrase}

/** Places in the route frame, each measured from its centre and its entrance. */
export function landmarksFrom(destinations, origin, excludeId = null) {
  return destinations
    .filter((d) => d.id !== excludeId)
    .map((d) => ({name: d.name, points: [d, d.entrance].filter(Boolean).map((p) => toLocal(origin, p))}))
}

/** The name of the nearest place within withinM of a point, or null. */
export function nearestLandmark(point, landmarks, withinM = GUIDE.landmarkM) {
  let best = null
  let bestM = withinM
  for (const {name, points} of landmarks) {
    for (const p of points) {
      const d = Math.hypot(p.x - point.x, p.y - point.y)
      if (d <= bestM) {
        best = name
        bestM = d
      }
    }
  }
  return best
}

/** left, right, slight-left, slight-right or straight. angle: degrees, > 0 for right. */
export function classifyTurn(angle) {
  const size = Math.abs(angle)
  if (size < GUIDE.turnDeg) return 'straight'
  const side = angle > 0 ? 'right' : 'left'
  return size < GUIDE.fullTurnDeg ? `slight-${side}` : side
}

/** Remove right-then-left sidesteps: nobody needs telling to turn twice in one stride. */
function dropJogs(groups) {
  const kept = []
  for (const group of groups) {
    const before = kept.at(-1)
    if (before && group.first - before.last <= GUIDE.jogM && Math.abs(before.angle + group.angle) < GUIDE.turnDeg) kept.pop()
    else kept.push(group)
  }
  return kept
}

/**
 * Ordered manoeuvres along a route polyline [{x, y}]: {s, type, angle}, ending with 'arrive'.
 * Bends the same way close together count as one turn. Small bends that do not add up are dropped.
 */
export function buildManoeuvres(route) {
  const groups = []
  for (const bend of findTurns(route, GUIDE.noticeDeg)) {
    const group = groups.at(-1)
    const sameWay = group && Math.sign(group.angle) === Math.sign(bend.angle)
    if (sameWay && bend.s - group.last <= GUIDE.groupGapM && bend.s - group.first <= GUIDE.groupSpanM) {
      group.angle += bend.angle
      group.last = bend.s
    } else {
      groups.push({angle: bend.angle, first: bend.s, last: bend.s})
    }
  }
  const manoeuvres = dropJogs(groups.filter((g) => Math.abs(g.angle) >= GUIDE.turnDeg))
    .map((g) => ({s: (g.first + g.last) / 2, type: classifyTurn(g.angle), angle: g.angle, first: g.first, last: g.last}))
  manoeuvres.push({s: polylineLength(route), type: 'arrive', angle: 0})
  return manoeuvres
}

/** Metres for a person to read: exact when close, to the nearest 5 m further off, km far off. */
export const roundDistance = (metres) => getDirections().distance(metres)

/** "Turn left at the Atrium · 12 m", "Turn left in 12 m", "Continue past the Library · 40 m". */
export function instructionFor(manoeuvre, distanceM, arriveLabel = 'Destination', past = null) {
  const away = roundDistance(distanceM)
  const say = getDirections().arCard
  if (distanceM > GUIDE.announceM) return past ? say({kind: 'past', place: past, away}) : say({kind: 'continue', away})
  if (manoeuvre.type === 'arrive') return say({kind: 'arrive', label: arriveLabel, away})
  return say({kind: 'turn', type: manoeuvre.type, landmark: manoeuvre.landmark ?? null, away, now: distanceM < GUIDE.nowM})
}

/** What to read aloud: the step without its distance, so a screen reader speaks once per step. */
export function spokenStep(text) {
  return text.replace(/\s*(·|in)?\s*(now|[\d.]+ (m|km))$/, '').trim()
}

/** The icon name for what the user does next. */
export function stepIcon(manoeuvre, distanceM) {
  if (distanceM > GUIDE.announceM) return 'straight'
  return manoeuvre.type === 'arrive' ? 'arrive' : manoeuvre.type
}

/** What to do next, for one route. Remembers progress, so jitter cannot skip or repeat a turn. */
export function createGuidance(route, {arriveLabel = 'Destination', landmarks = []} = {}) {
  const manoeuvres = buildManoeuvres(route)
  for (const m of manoeuvres) {
    if (m.type !== 'arrive') m.landmark = nearestLandmark(pointAt(route, m.s), landmarks)
  }
  // Places along the way, for "Continue past...".
  const beside = landmarks
    .map((l) => {
      const hits = l.points.map((p) => projectOntoPolyline(route, p))
      const hit = hits.reduce((a, b) => (b.offset < a.offset ? b : a), hits[0])
      return {name: l.name, s: hit?.s, offset: hit?.offset ?? Infinity}
    })
    .filter((l) => l.offset <= GUIDE.landmarkM)
    .sort((a, b) => a.s - b.s)
  let index = 0
  let lastIndex = 0
  const warned = new Set()
  const reached = new Set()

  function pastLandmark(userS, next) {
    return beside.find((l) => l.s > userS + GUIDE.pastAfterM && l.s < next.s)?.name ?? null
  }

  function getNextManoeuvre(userS) {
    while (index < manoeuvres.length - 1 && userS >= manoeuvres[index].s + GUIDE.passedM) index += 1
    while (index > 0 && userS < manoeuvres[index - 1].s - GUIDE.backtrackM) index -= 1
    return manoeuvres[index]
  }

  return {
    manoeuvres,
    getNextManoeuvre,
    instruction(userS) {
      const next = getNextManoeuvre(userS)
      const distanceM = Math.max(0, next.s - userS)
      return instructionFor(next, distanceM, arriveLabel, pastLandmark(userS, next))
    },
    /** The instruction card: {icon, text, distanceM}. */
    step(userS) {
      const next = getNextManoeuvre(userS)
      const distanceM = Math.max(0, next.s - userS)
      return {icon: stepIcon(next, distanceM), text: instructionFor(next, distanceM, arriveLabel, pastLandmark(userS, next)), distanceM}
    },
    /** Every step of the route, for the list: {icon, text, distanceM, done, current}. */
    steps(userS) {
      const nextIndex = manoeuvres.indexOf(getNextManoeuvre(userS))
      return manoeuvres.map((m, i) => ({
        icon: stepIcon(m, 0),
        text: m.type === 'arrive' ? arriveLabel : getDirections().arStep(m.type, m.landmark ?? null),
        distanceM: m.s - (i ? manoeuvres[i - 1].s : 0),
        done: i < nextIndex,
        current: i === nextIndex,
      }))
    },
    /** True once per turn, as the user reaches it. */
    turnIsNow(userS) {
      const next = getNextManoeuvre(userS)
      if (next.type === 'arrive' || reached.has(next) || next.s - userS > GUIDE.nowM) return false
      reached.add(next)
      return true
    },
    /** True once, on the moment a corner has been passed. */
    turnPassed(userS) {
      const i = manoeuvres.indexOf(getNextManoeuvre(userS))
      const passed = i > lastIndex
      lastIndex = i
      return passed
    },
    /** True once per turn, as the user comes within 10 m of it. */
    turnIsClose(userS) {
      const next = getNextManoeuvre(userS)
      if (next.type === 'arrive' || warned.has(next) || next.s - userS > GUIDE.hapticM) return false
      warned.add(next)
      return true
    },
  }
}
