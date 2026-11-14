// Live probe (item 7): runs each timetable string through the app's own search (our places plus
// MazeMap rooms, ranked as the search box ranks them) and prints the top result. Network needed:
//   SEARCH_PROBE=1 npx vitest run tests/unit/search-probe.live.test.js
import {it} from 'vitest'
import {searchMazeMap} from '../../src/map/mazemap-search.js'
import {rankResults} from '../../src/map/search-rank.js'
import {searchDestinations} from '../../src/map/search.js'
import {DESTINATIONS, POPULAR} from '../../src/map/destinations.js'
import {TIMETABLE_CASES} from '../search/timetable-cases.js'
import {timetableQuery} from '../../src/map/timetable.js'

it.skipIf(!process.env.SEARCH_PROBE)('timetable strings, live', async () => {
  const lines = []
  let ok = 0
  for (const c of TIMETABLE_CASES) {
    // The same steps as the search box (destination-search.js runSearch and draw).
    const t = timetableQuery(c.q)
    let local = searchDestinations(DESTINATIONS, c.q, {popular: POPULAR.map((d) => d.id), limit: 6})
    if (t.changed && !local.length) local = searchDestinations(DESTINATIONS, t.room, {popular: POPULAR.map((d) => d.id), limit: 6})
    let rooms
    try {
      rooms = await searchMazeMap(t.room || c.q, {rows: 14})
    } catch {
      rooms = []
    }
    const top = rankResults(t.room || c.q, [...local, ...rooms], {building: t.building})[0]
    const pass = Boolean(top && c.expect.test(top.name) && (c.floor == null || top.floor === c.floor))
    if (pass) ok++
    lines.push(`${pass ? 'PASS' : 'FAIL'} | ${c.q} | ${top ? `${top.name} (${top.building || '-'}, L${top.floor ?? '-'})` : '(nothing)'}`)
  }
  console.log(`PROBE ${ok}/${TIMETABLE_CASES.length}\n` + lines.join('\n'))
}, 180000)
