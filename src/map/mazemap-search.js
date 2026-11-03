// Room search on the University MazeMap ("2A73", "seminar room", "toilets").
// Used to extend our own destination list. Fails quietly when offline.
import {MAZEMAP} from '../config.js'

// Things you walk through, not to.
const SKIP_TYPES = /stair|elevator|lift|corridor|hidden|entrance|ramp/i

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').trim()

/** Turn a MazeMap search response into destination objects. Exported for tests. */
export function parseMazeMapResults(json) {
  const seen = new Set()
  const out = []
  for (const r of json?.result || []) {
    const name = strip(r.title)
    const types = (r.dispTypeNames || []).map(strip)
    if (!r.poiId || !r.point?.coordinates || !name || /^null$/i.test(name)) continue
    if (types.some((t) => SKIP_TYPES.test(t))) continue
    const building = strip((r.dispBldNames || [])[0])
    const key = `${name}|${building}|${r.zValue}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `mm-${r.poiId}`,
      name,
      building,
      floor: typeof r.zValue === 'number' ? r.zValue : null,
      category: 'room',
      kind: types.join(', '),
      lat: r.point.coordinates[1],
      lng: r.point.coordinates[0],
      mazemapPoi: r.poiId,
      source: 'mazemap',
    })
  }
  return out
}

/** Search rooms. Pass an AbortSignal so typing fast cancels old requests. */
export async function searchMazeMap(query, {signal, rows = 8} = {}) {
  const q = new URLSearchParams({
    q: query,
    rows: String(rows + 6), // some results are filtered out above
    withpois: 'true',
    withbuilding: 'false',
    withtype: 'true',
    campusid: String(MAZEMAP.campusId),
  })
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
  const signals = [signal, timeout].filter(Boolean)
  const res = await fetch(`https://search.mazemap.com/search/equery/?${q}`, {
    signal: signals.length > 1 && AbortSignal.any ? AbortSignal.any(signals) : signals[0],
  })
  if (!res.ok) throw new Error(`MazeMap search failed (HTTP ${res.status})`)
  return parseMazeMapResults(await res.json()).slice(0, rows)
}
