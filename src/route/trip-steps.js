// Turn-by-turn for the map trip (item 2): the next-turn banner ("In 80 m, turn left at the
// Cottrell Building") and the list of every step, from the route's own shape (guidance.js) and the
// campus places near each corner. Works from GPS when the walker is on the route, and with no GPS
// at all (a laptop) as the first step and a static list. Pure: no map, no DOM.
import {createGuidance, landmarkPhrase, landmarksFrom, roundDistance} from './guidance.js'
import {projectOntoPolyline, toLocal} from '../geo/geo.js'
import {GUIDE} from '../config.js'

const VERB = {left: 'turn left', right: 'turn right', 'slight-left': 'bear left', 'slight-right': 'bear right'}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The banner for the next manoeuvre, distanceM ahead:
 *   "In 80 m, turn left at the Cottrell Building", "In 120 m, bear right",
 *   "Turn left now at the Atrium" (within GUIDE.hapticM), "In 40 m, arrive at Library entrance".
 */
export function turnBanner(manoeuvre, distanceM, arriveLabel) {
  const at = manoeuvre.landmark ? ` at ${landmarkPhrase(manoeuvre.landmark)}` : ''
  if (manoeuvre.type === 'arrive') return distanceM <= GUIDE.hapticM ? `You’ve arrived at ${arriveLabel}` : `In ${roundDistance(distanceM)}, arrive at ${arriveLabel}`
  const verb = VERB[manoeuvre.type] ?? 'continue'
  if (distanceM <= GUIDE.hapticM) return `${capital(verb)} now${at}`
  return `In ${roundDistance(distanceM)}, ${verb}${at}`
}

/** One line of the step list: "Turn left at the Atrium", "Arrive at Library entrance". */
export function stepLine(manoeuvre, arriveLabel) {
  if (manoeuvre.type === 'arrive') return `Arrive at ${arriveLabel}`
  const at = manoeuvre.landmark ? ` at ${landmarkPhrase(manoeuvre.landmark)}` : ''
  return `${capital(VERB[manoeuvre.type] ?? 'continue')}${at}`
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
  const guidance = createGuidance(local, {arriveLabel, landmarks: landmarksFrom(destinations, origin, destinationId)})
  const {manoeuvres} = guidance
  const walk = (i) => Math.max(0, manoeuvres[i].s - (i ? manoeuvres[i - 1].s : 0))

  return {
    manoeuvres,
    /** Metres along the route for a fix (projected onto it). */
    along(fix) {
      return fix ? projectOntoPolyline(local, toLocal(origin, fix)).s : 0
    },
    /** {icon, text, type, distanceM, manoeuvre} for the next manoeuvre, userS metres along. */
    banner(userS = 0) {
      const next = guidance.getNextManoeuvre(userS)
      const distanceM = Math.max(0, next.s - userS)
      return {icon: next.type === 'arrive' ? 'arrive' : next.type, text: turnBanner(next, distanceM, arriveLabel), type: next.type, distanceM, manoeuvre: next}
    },
    /** Every step: {icon, text, walkText (from the step before), done, current}. */
    list(userS = 0) {
      const current = manoeuvres.indexOf(guidance.getNextManoeuvre(userS))
      return manoeuvres.map((m, i) => ({
        icon: m.type === 'arrive' ? 'arrive' : m.type,
        text: stepLine(m, arriveLabel),
        walkText: roundDistance(walk(i)),
        done: i < current,
        current: i === current,
      }))
    },
  }
}
