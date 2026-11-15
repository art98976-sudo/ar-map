// Item 13: the turn-by-turn sentences in British English, the source language. Each language has
// its own set (src/i18n/locales/*.js, DIRECTIONS) with the same functions, built for its own
// grammar rather than from English fragments. Place and road names come in as they are (English).
//
// A manoeuvre m: {type: 'left' | 'right' | 'slight-left' | 'slight-right' | 'arrive',
//   landmark?, ontoInfo?: {road, beside}, towards?, then?: {type, landmark, gapM}}.
// A detail (what a long stretch passes): {kind: 'follow', road, beside, water?} |
//   {kind: 'water', water} | {kind: 'pass', building, side: 'left' | 'right'}.

// Names that read wrongly after "the": "Turn left at Scran", not "at the Scran".
const NO_ARTICLE = new Set(['Campus Central', 'Andrew Stewart Hall', 'Airthrey Loch', 'Airthrey Castle', 'Scran', 'Umami', 'Starbucks'])

/** "the Atrium", "the Bite", "Scran". */
export function landmarkPhrase(name) {
  if (NO_ARTICLE.has(name)) return name
  return name.startsWith('The ') ? `the ${name.slice(4)}` : `the ${name}`
}

/** Metres for a person to read: exact when close, to the nearest 5 m further off, km far off. */
export function roundDistanceEn(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${metres <= 20 ? Math.round(metres) : Math.round(metres / 5) * 5} m`
}

const VERB = {left: 'turn left', right: 'turn right', 'slight-left': 'bear left', 'slight-right': 'bear right'}
const THEN = {left: 'left', right: 'right', 'slight-left': 'bear left', 'slight-right': 'bear right'}
const TURN_WORDS = {left: 'Turn left', right: 'Turn right', 'slight-left': 'Bear left', 'slight-right': 'Bear right'}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const onto = (info) => (info ? (info.beside ? `the path beside ${info.road}` : info.road) : null)
const at = (m) => {
  const road = onto(m?.ontoInfo)
  return (m?.landmark ? ` at ${landmarkPhrase(m.landmark)}` : '') + (road && !m.then ? ` onto ${road}` : '') + (m?.towards && !m.then ? ` towards ${landmarkPhrase(m.towards)}` : '')
}
/** ", then left 20 m later" for a step of two turns. */
const thenPart = (m) => {
  if (!m.then) return ''
  const again = m.then.type === m.type ? ' again' : '' // "then right again"
  const road = onto(m.ontoInfo)
  return `, then ${THEN[m.then.type]}${again}${at(m.then)} ${roundDistanceEn(m.then.gapM)} later${road ? ` onto ${road}` : ''}${m.towards ? ` towards ${landmarkPhrase(m.towards)}` : ''}`
}

export const EN_DIRECTIONS = {
  distance: roundDistanceEn,
  /** A place name inside a sentence: "the Atrium". */
  place: landmarkPhrase,
  /** "the path beside University Road West", or the road itself. */
  onto,
  /**
   * The banner for the next manoeuvre. away: "80 m", or null at the turn itself.
   *   "In 80 m, turn left at the Cottrell Building", "Turn left now at the Atrium",
   *   "In 40 m, arrive at Library entrance", "You’ve arrived at Library entrance".
   */
  banner(m, away, arriveLabel) {
    if (m.type === 'arrive') return away == null ? `You’ve arrived at ${arriveLabel}` : `In ${away}, arrive at ${arriveLabel}`
    const verb = VERB[m.type] ?? 'continue'
    if (away == null) return `${capital(verb)} now${at(m)}${thenPart(m)}`
    return `In ${away}, ${verb}${at(m)}${thenPart(m)}`
  },
  /** One line of the step list: "Turn left at the Atrium", "Turn right, then left 35 m later". */
  stepLine(m, arriveLabel) {
    if (m.type === 'arrive') return `Arrive at ${arriveLabel}`
    return `${capital(VERB[m.type] ?? 'continue')}${at(m)}${thenPart(m)}`
  },
  /** "Follow the path beside University Road West, past Airthrey Loch", "Pass the Sports Centre on your left". */
  detail(d) {
    if (!d) return null
    if (d.kind === 'follow') return `Follow ${d.beside ? `the path beside ${d.road}` : d.road}${d.water ? `, past ${landmarkPhrase(d.water)}` : ''}`
    if (d.kind === 'water') return `Follow the path beside ${landmarkPhrase(d.water)}`
    if (d.kind === 'pass') return `Pass ${landmarkPhrase(d.building)} on your ${d.side}`
    return null
  },
  /** What is said when a step with a long stretch comes up: the stretch, then the turn. */
  spoken: (detail, words) => `${detail}. ${words}`,
  /**
   * The AR screen's card (src/route/guidance.js), with the distance after the words:
   *   {kind: 'continue', away} "Continue straight 40 m", {kind: 'past', place, away},
   *   {kind: 'arrive', label, away}, {kind: 'turn', type, landmark?, away, now}.
   */
  arCard(c) {
    if (c.kind === 'past') return `Continue past ${landmarkPhrase(c.place)} · ${c.away}`
    if (c.kind === 'continue') return `Continue straight ${c.away}`
    if (c.kind === 'arrive') return `${c.label} in ${c.away}`
    const words = TURN_WORDS[c.type]
    if (c.landmark) return `${words} at ${landmarkPhrase(c.landmark)} · ${c.now ? 'now' : c.away}`
    return c.now ? `${words} now` : `${words} in ${c.away}`
  },
  /** The AR step list: "Turn left at the Atrium". */
  arStep(type, landmark) {
    return landmark ? `${TURN_WORDS[type]} at ${landmarkPhrase(landmark)}` : TURN_WORDS[type]
  },
}
