// One ranked list of search results: our own places and MazeMap rooms together.
//
// Order: how well the name matches (exact name or room code, then starts with the query, then a
// word starts with it, then contains it, then a typo match), and within that, what kind of place
// it is (teaching rooms first, exits and stairs last). Temporary event labels, raw internal codes
// and duplicates of the same room are left out. Pure: no network, no DOM.
import {distanceM} from '../geo/geo.js'
import {normalize} from './search.js'

export const MATCH = {exact: 0, starts: 1, word: 2, contains: 3, fuzzy: 4}

/** Kinds of place, in the order they are listed within the same match. */
export const KIND = {teaching: 0, named: 1, office: 2, other: 3, facility: 4, passage: 5}

// Names or types of one-off events laid over a real room ("Lecture Theatre A3 - Offer Holder Day").
const EVENT = /offer holder|open day|applicant day|graduation|welcome week|fresher|\bevent\b|exam venue|pop[- ]?up/i
// An internal code: upper-case letters, a slash, more code ("COTT/A3/EXIT").
const RAW_CODE = /^[A-Z0-9]{2,8}\/\S/

const TEACHING = /lecture|teaching|seminar|learning space|classroom|tutorial|\blab\b|computer|studio|workshop/i
const NAMED = /librar|caf[eé]|coffee|restaurant|food|kitchen|\bbar\b|shop|reception|help ?desk|\bhub\b|centre|gym|sport|chapel|bank|print|student/i
const OFFICE = /office|staff/i
const FACILITY = /toilet|\bwc\b|\blift\b|elevator|shower|changing|baby/i
const PASSAGE = /exit|entrance|corridor|stair|circulation|vestibule|lobby|ramp|passage/i
const OUR_CATEGORIES = new Set(['library', 'food', 'services', 'sport', 'landmark', 'academic', 'living', 'bus', 'town', 'parking'])

/** The searchable code of a room: "A3LT" from "COTT/A3LT", "2B087" from "COTT/2B087". */
export function roomCode(identifier) {
  if (!identifier) return null
  const parts = String(identifier).split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0]
}

/** Is this a temporary event label rather than a room? */
export function isEventLabel(dest) {
  return EVENT.test(dest.name || '') || EVENT.test(dest.kind || '')
}

/** Is this name a raw internal code ("COTT/A3/EXIT 17.04")? */
export function isRawCode(dest) {
  return RAW_CODE.test(String(dest.name || '').trim())
}

/** How well the query matches this place, or null for no match. */
export function matchTier(dest, rawQuery) {
  const q = normalize(rawQuery)
  if (!q) return null
  const name = normalize(dest.name)
  // The room's own code ("A3LT"), not the building prefix every room shares ("COTT/").
  const codes = [roomCode(dest.code)].filter(Boolean).map(normalize)
  // "2B87" is room 2B087: compare codes with leading zeros dropped too.
  const unpad = (s) => s.replace(/([a-z])0+(\d)/g, '$1$2')
  if (name === q || normalize(dest.code) === q || codes.some((c) => c === q || unpad(c) === unpad(q))) return MATCH.exact
  if (name.startsWith(q)) return MATCH.starts
  const words = name.split(' ')
  if (words.some((w) => w.startsWith(q))) return MATCH.word
  if (name.includes(q) || codes.some((c) => c.includes(q))) return MATCH.contains
  for (const alias of dest.aliases || []) {
    const a = normalize(alias)
    if (a === q) return MATCH.exact
    if (a.startsWith(q) || a.split(' ').some((w) => w.startsWith(q))) return MATCH.word
  }
  return null
}

/** What kind of place this is, for ordering within a match. */
export function kindTier(dest) {
  const kind = dest.kind || ''
  const name = dest.name || ''
  if (dest.source !== 'mazemap' && OUR_CATEGORIES.has(dest.category)) return KIND.named
  if (PASSAGE.test(kind) || /\b(exit|entrance|corridor|stairs?|lobby|vestibule)\b/i.test(name)) return KIND.passage
  if (FACILITY.test(kind) || FACILITY.test(name)) return KIND.facility
  if (TEACHING.test(kind) || /lecture theatre|seminar room/i.test(name)) return KIND.teaching
  if (NAMED.test(kind) || NAMED.test(name)) return KIND.named
  if (OFFICE.test(kind) || OFFICE.test(name)) return KIND.office
  return KIND.other
}

const sameSpot = (a, b, metres) =>
  Number.isFinite(a.lat) && Number.isFinite(b.lat) && (a.floor ?? null) === (b.floor ?? null) && distanceM(a, b) <= metres

/**
 * Rank places for a query. `items` may mix our own destinations and MazeMap rooms; fuzzyIds are
 * our own places that matched only with a typo ("libary"). Returns the list to show, best first.
 */
export function rankResults(rawQuery, items, {limit = 12, fuzzyIds = new Set()} = {}) {
  const q = String(rawQuery || '').trim()
  if (!q) return []
  const wantsCode = q.includes('/')
  // A MazeMap room with the same name as one of our own places is that place (the Library).
  const ours = items.filter((d) => d.source !== 'mazemap')
  const oursNamed = new Set(ours.map((d) => normalize(d.name)))
  const scored = []
  for (const dest of items) {
    if (dest.source === 'mazemap' && oursNamed.has(normalize(dest.name))) continue
    // A raw code only when asked for: a slash in the query, or the code itself.
    if (isRawCode(dest) && !wantsCode && normalize(String(dest.name).trim().split(/\s/)[0]) !== normalize(q)) continue
    let tier = matchTier(dest, q)
    if (tier == null && fuzzyIds.has(dest.id)) tier = MATCH.fuzzy
    if (tier == null) continue
    scored.push({dest, tier, kind: kindTier(dest), event: isEventLabel(dest)})
  }
  // An event label goes when a permanent room is in the same place.
  const permanent = scored.filter((r) => !r.event)
  const kept = scored.filter((r) => !r.event || !permanent.some((p) => sameSpot(p.dest, r.dest, 12)))
  kept.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.kind - b.kind ||
      Number(a.event) - Number(b.event) ||
      Number(a.dest.source === 'mazemap') - Number(b.dest.source === 'mazemap') ||
      a.dest.name.localeCompare(b.dest.name),
  )
  // Duplicates: the same MazeMap room, or the same name on the same floor a few metres apart.
  const out = []
  for (const {dest: d} of kept) {
    const dup = out.some((o) => (d.mazemapPoi && o.mazemapPoi === d.mazemapPoi) || (normalize(o.name) === normalize(d.name) && sameSpot(o, d, 3)))
    if (!dup) out.push(d)
    if (out.length >= limit) break
  }
  return out
}
