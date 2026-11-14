// Turn-by-turn for the map trip (item 2): the next-turn banner ("In 80 m, turn left at the
// Cottrell Building") and the list of every step, from the route's own shape (guidance.js) and the
// campus places near each corner. Works from GPS when the walker is on the route, and with no GPS
// at all (a laptop) as the first step and a static list. Pure: no map, no DOM.
import {createGuidance, landmarkPhrase, landmarksFrom, roundDistance} from './guidance.js'
import {projectOntoPolyline, toLocal} from '../geo/geo.js'
import {GUIDE} from '../config.js'

export const NEAR_M = 15 // spoken directions: within this of a turn, "Turn left now"

// Item 2 (round 3): steps for a person, not for arrows. The AR guidance finds every corner of the
// drawn route (Pathfoot to the Library: 14). Campus paths meet at right angles and often step
// sideways at a junction, so for the list, the banner and the voice the corners are merged:
export const STEP_MERGE = {
  minLegM: 12, // a corner this soon after the one before joins it (their turns add up)
  minTurnDeg: 30, // a turn smaller than this, once merged, is not a step: the walker carries on
  pairM: 40, // two turns this close are one step: "Turn right, then left 20 m later"
  wiggleNetDeg: 35, // a left and a right that leave the walker facing nearly the same way...
  wiggleSideM: 8, // ...and move them sideways less than this are the path wiggling: carry on
  bearMaxDeg: 50, // up to this, "bear"; beyond, "turn"
}

const sideOf = (angle) => (angle > 0 ? 'right' : 'left')

/** A merged turn's type from its angle (> 0 right). */
export function turnType(angle, merge = STEP_MERGE) {
  return Math.abs(angle) < merge.bearMaxDeg ? `slight-${sideOf(angle)}` : sideOf(angle)
}

/**
 * Merge the guidance's corners ({s, angle, type, landmark}, ending with 'arrive') into steps. Pure.
 *   1. corners closer than minLegM become one corner, their angles added
 *   2. a left-right wiggle (facing nearly the same way after, hardly a step sideways) goes
 *   3. turns smaller than minTurnDeg go
 *   4. two turns within pairM become one step, {..., endS, then: {type, landmark, gapM}}
 *   5. a turn just before the end is part of arriving
 */
export function simplifySteps(corners, merge = STEP_MERGE) {
  const arrive = corners.at(-1)
  let turns = corners.filter((c) => c.type !== 'arrive').map((c) => ({s: c.s, angle: c.angle, landmark: c.landmark ?? null}))
  let changed = true
  while (changed) {
    changed = false
    const merged = []
    for (const t of turns) {
      const prev = merged.at(-1)
      if (prev && t.s - prev.s <= merge.minLegM) {
        prev.angle += t.angle
        prev.landmark ??= t.landmark
        changed = true
      } else merged.push({...t})
    }
    const kept = []
    for (let i = 0; i < merged.length; i++) {
      const a = merged[i]
      const b = merged[i + 1]
      const sideways = b ? (b.s - a.s) * Math.abs(Math.sin((a.angle * Math.PI) / 180)) : Infinity
      if (b && Math.sign(a.angle) !== Math.sign(b.angle) && Math.abs(a.angle + b.angle) < merge.wiggleNetDeg && sideways < merge.wiggleSideM) {
        i += 1
        changed = true
        continue
      }
      kept.push(a)
    }
    const big = kept.filter((t) => Math.abs(t.angle) >= merge.minTurnDeg)
    if (big.length !== kept.length) changed = true
    turns = big
  }
  if (turns.length && arrive && arrive.s - turns.at(-1).s < merge.minLegM) turns.pop()

  const steps = []
  for (let i = 0; i < turns.length; i++) {
    const a = turns[i]
    const b = turns[i + 1]
    const step = {s: a.s, angle: a.angle, type: turnType(a.angle, merge), landmark: a.landmark}
    if (b && b.s - a.s <= merge.pairM) {
      step.endS = b.s
      step.then = {s: b.s, angle: b.angle, type: turnType(b.angle, merge), landmark: b.landmark, gapM: b.s - a.s}
      i += 1
    }
    steps.push(step)
  }
  if (arrive) steps.push({...arrive, landmark: null})
  return steps
}

const VERB = {left: 'turn left', right: 'turn right', 'slight-left': 'bear left', 'slight-right': 'bear right'}
const THEN = {left: 'left', right: 'right', 'slight-left': 'bear left', 'slight-right': 'bear right'}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const at = (m) => (m?.landmark ? ` at ${landmarkPhrase(m.landmark)}` : '')
/** ", then left 20 m later" for a step of two turns. */
const thenPart = (m) => {
  if (!m.then) return ''
  const again = m.then.type === m.type ? ' again' : '' // "then right again"
  return `, then ${THEN[m.then.type]}${again}${at(m.then)} ${roundDistance(m.then.gapM)} later`
}

/**
 * The banner for the next manoeuvre, distanceM ahead:
 *   "In 80 m, turn left at the Cottrell Building", "In 120 m, bear right",
 *   "In 25 m, turn right at the Pathfoot Building, then left 20 m later",
 *   "Turn left now at the Atrium" (within GUIDE.hapticM), "In 40 m, arrive at Library entrance".
 */
export function turnBanner(manoeuvre, distanceM, arriveLabel) {
  if (manoeuvre.type === 'arrive') return distanceM <= GUIDE.hapticM ? `You’ve arrived at ${arriveLabel}` : `In ${roundDistance(distanceM)}, arrive at ${arriveLabel}`
  const verb = VERB[manoeuvre.type] ?? 'continue'
  if (distanceM <= GUIDE.hapticM) return `${capital(verb)} now${at(manoeuvre)}${thenPart(manoeuvre)}`
  return `In ${roundDistance(distanceM)}, ${verb}${at(manoeuvre)}${thenPart(manoeuvre)}`
}

/** One line of the step list: "Turn left at the Atrium", "Turn right, then left 35 m later". */
export function stepLine(manoeuvre, arriveLabel) {
  if (manoeuvre.type === 'arrive') return `Arrive at ${arriveLabel}`
  return `${capital(VERB[manoeuvre.type] ?? 'continue')}${at(manoeuvre)}${thenPart(manoeuvre)}`
}

/**
 * Steps for one route ({points: [{lat, lng}]}).
 * @param o.arriveLabel how the end is named ("Library entrance")
 * @param o.destinations campus places, to name corners by
 * @param o.destinationId left out of the corner names
 */
export function createTripSteps(route, {arriveLabel, destinations = [], destinationId = null}) {
  const points = route?.points ?? []
  const origin = points[0]
  const local = points.map((p) => toLocal(origin, p))
  // The AR guidance's corners (fine-grained, for arrows), merged into steps a person can follow.
  const corners = createGuidance(local, {arriveLabel, landmarks: landmarksFrom(destinations, origin, destinationId)}).manoeuvres
  const manoeuvres = simplifySteps(corners)
  const endOf = (m) => m.endS ?? m.s
  const walk = (i) => Math.max(0, manoeuvres[i].s - (i ? endOf(manoeuvres[i - 1]) : 0))
  // Progress along the steps: a step of two turns is done after its second one. Jitter cannot
  // skip a step or bring one back.
  let index = 0
  function nextStep(userS) {
    while (index < manoeuvres.length - 1 && userS >= endOf(manoeuvres[index]) + GUIDE.passedM) index += 1
    while (index > 0 && userS < endOf(manoeuvres[index - 1]) - GUIDE.backtrackM) index -= 1
    return manoeuvres[index]
  }

  return {
    manoeuvres,
    /** Metres along the route for a fix (projected onto it). */
    along(fix) {
      return fix ? projectOntoPolyline(local, toLocal(origin, fix)).s : 0
    },
    /**
     * {icon, text, type, distanceM, manoeuvre, index} for what comes next, userS metres along.
     * Past the first turn of a two-turn step, it is the second turn on its own.
     */
    banner(userS = 0) {
      const step = nextStep(userS)
      const second = step.then && userS > step.s + GUIDE.passedM
      const next = second ? step.then : step
      const distanceM = Math.max(0, next.s - userS)
      return {icon: next.type === 'arrive' ? 'arrive' : next.type, text: turnBanner(next, distanceM, arriveLabel), type: next.type, distanceM, manoeuvre: next, index}
    },
    /** Every step: {icon, text, walkText (from the step before), done, current, fromS, toS}. */
    list(userS = 0) {
      const current = manoeuvres.indexOf(nextStep(userS))
      return manoeuvres.map((m, i) => ({
        icon: m.type === 'arrive' ? 'arrive' : m.type,
        text: stepLine(m, arriveLabel),
        walkText: roundDistance(walk(i)),
        done: i < current,
        current: i === current,
        fromS: i ? endOf(manoeuvres[i - 1]) : 0, // the stretch this step covers, for the map
        toS: endOf(m),
      }))
    },
  }
}

/**
 * What to say for the next manoeuvre, once per stage: when it becomes the next one ("In 80 m,
 * turn left at the Atrium") and again close to it ("Turn left now at the Atrium"). Pure: feed it
 * the next manoeuvre and how far it is; it returns the words, or null when nothing new.
 */
export function createTurnAnnouncer({arriveLabel, nearM = NEAR_M}) {
  const said = new Map() // manoeuvre -> 'ahead' | 'near'
  return {
    next(manoeuvre, distanceM) {
      if (!manoeuvre || !Number.isFinite(distanceM)) return null
      const stage = said.get(manoeuvre)
      if (manoeuvre.type === 'arrive') {
        if (stage) return null
        said.set(manoeuvre, 'ahead')
        return turnBanner(manoeuvre, distanceM, arriveLabel)
      }
      if (distanceM <= nearM) {
        if (stage === 'near') return null
        said.set(manoeuvre, 'near')
        return turnBanner(manoeuvre, 0, arriveLabel) // "Turn left now at the Atrium[, then ...]"
      }
      if (stage) return null
      said.set(manoeuvre, 'ahead')
      return turnBanner(manoeuvre, distanceM, arriveLabel)
    },
  }
}
