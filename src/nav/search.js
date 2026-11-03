// Destination search: matches names, aliases and buildings, with typo tolerance.
// Pure functions, so they are easy to test and fast enough to run on every key press.

/** Lower-case, strip accents and punctuation: "Students' Union" -> "students union". */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Edit distance with an early exit once it exceeds `max` (we only care about 1 or 2). */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({length: b.length + 1}, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/** How well one text matches the query (0 = no match, 100 = exact). */
function scoreText(text, query) {
  const t = normalize(text)
  if (!t) return 0
  if (t === query) return 100
  if (t.startsWith(query)) return 90
  const words = t.split(' ')
  if (words.some((w) => w.startsWith(query))) return 80
  const qWords = query.split(' ')
  if (qWords.length > 1 && qWords.every((q) => words.some((w) => w.startsWith(q)))) return 72
  if (query.length >= 3 && t.includes(query)) return 60
  // Typos: "cotrell" -> "cottrell", "libary" -> "library" (only for longer words).
  if (query.length >= 4) {
    const allowed = query.length >= 7 ? 2 : 1
    if (words.some((w) => editDistance(w, query, allowed) <= allowed)) return 45
    if (words.some((w) => w.length > query.length && editDistance(w.slice(0, query.length), query, 1) <= 1)) return 40
  }
  return 0
}

/** Score a destination: name counts most, then aliases, then the building. */
export function scoreDestination(dest, rawQuery) {
  const query = normalize(rawQuery)
  if (!query) return 0
  const name = scoreText(dest.name, query)
  const alias = Math.max(0, ...(dest.aliases || []).map((a) => scoreText(a, query))) * 0.92
  const building = scoreText(dest.building, query) * 0.6
  return Math.max(name, alias, building)
}

/** Best matches first. Ties: popular places, then alphabetical. */
export function searchDestinations(list, rawQuery, {limit = 8, popular = []} = {}) {
  if (!normalize(rawQuery)) return []
  return list
    .map((dest) => ({dest, score: scoreDestination(dest, rawQuery)}))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(popular.includes(b.dest.id)) - Number(popular.includes(a.dest.id)) ||
        a.dest.name.localeCompare(b.dest.name),
    )
    .slice(0, limit)
    .map((r) => r.dest)
}

/** "Library · Level 2" style subtitle for a result row. */
export function describeDestination(dest) {
  const parts = []
  if (dest.building && normalize(dest.building) !== normalize(dest.name)) parts.push(dest.building)
  if (dest.floor != null) parts.push(`Level ${dest.floor}`)
  if (!parts.length && dest.category === 'room') parts.push('Room')
  return parts.join(' · ')
}
