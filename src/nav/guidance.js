// Turn-by-turn guidance, off-route detection and arrival. Pure logic: no GPS, no three.js.
// Positions are distances along the route, from projecting the SLAM position onto it, so GPS
// noise cannot reach them.
import {findTurns, polylineLength} from '../geo/geo.js'

export const GUIDE = {
  noticeDeg: 3, // smaller bends are drawing noise
  turnDeg: 25, // a group of bends must add up to this to be a manoeuvre
  fullTurnDeg: 45, // below this it is only a "slight" turn
  groupGapM: 8, // bends the same way this close together are one turn
  groupSpanM: 30, // ...but a long sweep is not one corner
  jogM: 3, // two opposite bends this close that cancel out are a sidestep in the path, not turns
  passedM: 2, // a corner counts as passed this far beyond it
  backtrackM: 10, // this far back before a passed corner, it is ahead again
  announceM: 30, // further off than this, say "continue straight"
  hapticM: 10,
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
    .map((g) => ({s: (g.first + g.last) / 2, type: classifyTurn(g.angle), angle: g.angle}))
  manoeuvres.push({s: polylineLength(route), type: 'arrive', angle: 0})
  return manoeuvres
}

/** Metres for a person to read: exact when close, to the nearest 5 m further off, km far off. */
export function roundDistance(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${metres <= 20 ? Math.round(metres) : Math.round(metres / 5) * 5} m`
}

const TURN_WORDS = {left: 'Turn left', right: 'Turn right', 'slight-left': 'Bear left', 'slight-right': 'Bear right'}

/** "Turn left in 12 m", "Continue straight 40 m", "Pathfoot entrance in 8 m". */
export function instructionFor(manoeuvre, distanceM, arriveLabel = 'Destination') {
  if (distanceM > GUIDE.announceM) return `Continue straight ${roundDistance(distanceM)}`
  if (manoeuvre.type === 'arrive') return `${arriveLabel} in ${roundDistance(distanceM)}`
  const words = TURN_WORDS[manoeuvre.type]
  return distanceM < 2 ? `${words} now` : `${words} in ${roundDistance(distanceM)}`
}

/** What to do next, for one route. Remembers progress, so jitter cannot skip or repeat a turn. */
export function createGuidance(route, {arriveLabel = 'Destination'} = {}) {
  const manoeuvres = buildManoeuvres(route)
  let index = 0
  const warned = new Set()

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
      return instructionFor(next, Math.max(0, next.s - userS), arriveLabel)
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

/**
 * Over offM for forS means off route: reroute. Back within backM before that cancels it. At most
 * one reroute per cooldownS. update() returns true on the moment a reroute should start.
 */
export function createOffRouteMonitor({offM = 15, backM = 8, forS = 5, cooldownS = 20} = {}) {
  let since = null
  let lastFiredAt = -Infinity
  return {
    update(offsetM, time) {
      if (offsetM <= backM) since = null
      else if (offsetM > offM) since ??= time
      if (since == null || time - since < forS || time - lastFiredAt < cooldownS) return false
      lastFiredAt = time
      since = null
      return true
    },
  }
}

/**
 * Arrived: within remainingM along the route, or pinM in a straight line from the entrance, for a
 * moment, so a correction easing past cannot end the trip. update() is true once only.
 */
export function createArrivalDetector({remainingM = 8, pinM = 6, forS = 1} = {}) {
  let held = 0
  let done = false
  return {
    update(dt, remaining, toPin) {
      if (done) return false
      const close = remaining <= remainingM || (toPin != null && toPin <= pinM)
      held = close ? held + dt : 0
      if (held < forS) return false
      done = true
      return true
    },
  }
}
