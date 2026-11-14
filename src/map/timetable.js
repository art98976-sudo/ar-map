// Item 7: a room typed as it appears on a timetable. "Cottrell 4B49", "COTT 4B49", "4B 49",
// "LT A3", "A3 LT", "Colin Bell 3S29", "Pathfoot LT", "Iris Murdoch 10.2". The building is taken
// off (its rooms are then listed first) and the room part tidied, so MazeMap's search finds it.
// Pure.

// Building names and the short forms timetables use. Longest first, so "cottrell building" wins
// over "cottrell".
export const BUILDINGS = [
  {name: 'Cottrell Building', theatre: null, words: ['cottrell building', 'cottrell', 'cott']},
  {name: 'Colin Bell Building', theatre: null, words: ['colin bell building', 'colin bell', 'cbb', 'cb']},
  {name: 'Pathfoot Building', theatre: 'Pathfoot Lecture Theatre', words: ['pathfoot building', 'pathfoot', 'path', 'pf']},
  {name: 'Iris Murdoch Building', theatre: null, words: ['iris murdoch building', 'iris murdoch', 'imb', 'im']},
  {name: 'Library', theatre: null, words: ['library', 'lib']},
  {name: 'Andrew Miller', theatre: null, words: ['andrew miller building', 'andrew miller', 'atrium', 'amb', 'am']},
  {name: 'Logie', theatre: 'Logie Lecture Theatre', words: ['logie']},
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * {room, building, changed}: room is what to search for, building the building's name (or null).
 * A query with a slash (an internal code, "COTT/4B049") is left as it is.
 */
export function timetableQuery(raw) {
  let q = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!q || q.includes('/')) return {room: q, building: null, changed: false}
  const before = q
  let building = null
  for (const b of BUILDINGS) {
    for (const w of b.words) {
      const at = new RegExp(`^${escape(w)}(?:[\\s,:-]+(.+))?$|^(.+?)[\\s,:-]+${escape(w)}$`, 'i').exec(q)
      if (!at) continue
      const rest = (at[1] ?? at[2] ?? '').trim()
      // "Logie", "Pathfoot" alone are places in their own right: leave them for the place search.
      if (!rest) continue
      building = b
      q = rest
      break
    }
    if (building) break
  }
  // "LT" and "MLT" are a lecture theatre.
  q = q.replace(/\bM?LT\b/gi, 'Lecture Theatre')
  // A building with one named theatre: "Pathfoot LT" is the Pathfoot Lecture Theatre.
  if (building?.theatre && /^(main )?lecture theatre$/i.test(q)) return {room: building.theatre, building: null, changed: true}
  // "Lecture Theatre A3", "A3 Lecture Theatre": MazeMap names it "A3 Lecture Theatre"; "A3" finds it.
  const theatre = /^lecture theatre\s+([a-z]\d{1,2})$/i.exec(q) ?? /^([a-z]\d{1,2})\s+lecture theatre$/i.exec(q)
  if (theatre) q = theatre[1].toUpperCase()
  // A room code typed with a space, dash or dot inside ("4B 49", "4B-49", "3s 29"): one code.
  const code = /^(\d[a-z])[\s.-]+(\d{1,3})$/i.exec(q)
  if (code) q = `${code[1]}${code[2]}`.toUpperCase()
  else if (/^\d[a-z]\d{1,3}$/i.test(q)) q = q.toUpperCase()
  return {room: q, building: building?.name ?? null, changed: q !== before}
}

/** Is this place in the building the query named? */
export function inBuilding(dest, building) {
  if (!building) return false
  const b = building.toLowerCase().replace(/ building$/, '')
  return String(dest.building ?? '').toLowerCase().includes(b) || String(dest.name ?? '').toLowerCase().includes(b)
}
