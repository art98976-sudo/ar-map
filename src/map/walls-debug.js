// ?debug=walls: does the MazeMap route walk through any wall away from a door? Lists every such
// place with the floor, the distance along the route and the room(s) either side. Report only:
// the route is never changed.
import {floorToLocal, wallCrossings} from '../ar/building-shell.js'
import {boxAround, fetchFloor} from '../ar/mazemap-floor.js'
import {toLocal} from '../geo/geo.js'
import {html, render} from '../ui/dom.js'

/** The route's stretches on one floor each: [{level, points}], skipping outdoors (level 0). */
export function stretchesByLevel(points) {
  const out = []
  for (const p of points) {
    const level = Number.isFinite(p.z) ? p.z : 0
    if (level === 0) continue
    const last = out.at(-1)
    if (last && last.level === level) last.points.push(p)
    else out.push({level, points: [p]})
  }
  return out.filter((s) => s.points.length >= 2)
}

/** Check a route (all its points, with z) against MazeMap's walls. Resolves to [{level, s, rooms}]. */
export async function checkRouteWalls(points, {fetchImpl} = {}) {
  const found = []
  const origin = points[0]
  for (const stretch of stretchesByLevel(points)) {
    const centre = stretch.points[Math.floor(stretch.points.length / 2)]
    const local = stretch.points.map((p) => toLocal(origin, p))
    const reach = Math.max(...local.map((q) => Math.hypot(q.x - local[0].x, q.y - local[0].y))) + 20
    const floor = floorToLocal(await fetchFloor(stretch.level, boxAround(centre, reach), {fetchImpl}), origin)
    for (const c of wallCrossings(local, floor)) found.push({level: stretch.level, s: c.s, rooms: c.rooms})
  }
  return found
}

/** The panel on the home map. */
export function showWallsReport(host, {name, crossings, error}) {
  let panel = host.querySelector('[data-walls-debug]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'walls-debug'
    panel.dataset.wallsDebug = ''
    panel.setAttribute('aria-label', 'Route check against the walls')
    host.append(panel)
  }
  render(
    panel,
    html`<h2>Walls check: ${name}</h2>
      ${error
        ? html`<p>${error}</p>`
        : crossings.length
          ? html`<ol>
              ${crossings.map((c) => html`<li>Level ${c.level}, ${Math.round(c.s)} m along: through a wall${c.rooms.length ? ` (${c.rooms.join(' / ')})` : ''}</li>`)}
            </ol>`
          : html`<p>No wall crossings away from doors.</p>`}`,
  )
  return panel
}
