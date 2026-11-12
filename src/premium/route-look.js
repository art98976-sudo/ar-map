// The premium walking route: a 6 px #2F80FF line with a soft outer glow, a white core, and a
// slow light that travels along it. No dashes, no arrows. Draws a list of points it is given;
// planning the route stays where it was.
import {firstAboveGround} from './map-look.js'

export const ROUTE_BLUE = '#2F80FF'
const SRC = 'premium-route'
const GLOW = 'premium-route-glow'
const LINE = 'premium-route-line'
const CORE = 'premium-route-core'
const TRAVEL_MS = 3200 // the light takes this long from start to end

/** line-gradient for the light at `t` (0..1 along the route): white core with a brighter band. */
export function lightGradient(t) {
  const band = 0.08
  const a = Math.max(0, t - band)
  const b = Math.min(1, Math.max(t, 0.0001))
  const c = Math.min(1, t + band)
  const stops = [0, 'rgba(255,255,255,0.55)']
  if (a > 0) stops.push(a, 'rgba(255,255,255,0.55)')
  if (b > (a || 0)) stops.push(b, 'rgba(255,255,255,1)')
  if (c > b && c < 1) stops.push(c, 'rgba(255,255,255,0.55)')
  stops.push(1, 'rgba(255,255,255,0.55)')
  // Stops must rise strictly.
  const clean = []
  for (let i = 0; i < stops.length; i += 2) {
    if (clean.length && stops[i] <= clean[clean.length - 2]) continue
    clean.push(stops[i], stops[i + 1])
  }
  return ['interpolate', ['linear'], ['line-progress'], ...clean]
}

export function clearPremiumRoute(map) {
  for (const id of [CORE, LINE, GLOW]) if (map.getLayer?.(id)) map.removeLayer(id)
  if (map.getSource?.(SRC)) map.removeSource(SRC)
}

/** Draw `points` ([{lat, lng}]) and start the travelling light. Returns stop(). */
export function drawPremiumRoute(map, points, {reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches} = {}) {
  clearPremiumRoute(map)
  const coordinates = points.map((p) => [p.lng, p.lat])
  map.addSource(SRC, {type: 'geojson', lineMetrics: true, data: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}})
  const layout = {'line-cap': 'round', 'line-join': 'round'}
  // On the ground, under the 3D buildings, so a building in front hides it as it would for real.
  const before = ['premium-buildings-other', 'premium-buildings'].find((id) => map.getLayer(id)) ?? firstAboveGround(map)
  map.addLayer({id: GLOW, type: 'line', source: SRC, layout, paint: {'line-color': ROUTE_BLUE, 'line-width': 20, 'line-blur': 12, 'line-opacity': 0.55, 'line-emissive-strength': 1}}, before)
  map.addLayer({id: LINE, type: 'line', source: SRC, layout, paint: {'line-color': ROUTE_BLUE, 'line-width': 6, 'line-emissive-strength': 1}}, before)
  map.addLayer({id: CORE, type: 'line', source: SRC, layout, paint: {'line-width': 2, 'line-gradient': lightGradient(reduceMotion ? 1 : 0), 'line-emissive-strength': 1}}, before)

  let frame = 0
  let start = 0
  let lastPaint = 0
  const tick = (now) => {
    start ||= now
    // About 30 updates a second is smooth for a slow light and half the work of 60.
    if (now - lastPaint > 33) {
      lastPaint = now
      const t = ((now - start) % (TRAVEL_MS + 800)) / TRAVEL_MS
      if (map.getLayer(CORE)) map.setPaintProperty(CORE, 'line-gradient', lightGradient(Math.min(1, t)))
    }
    frame = requestAnimationFrame(tick)
  }
  if (!reduceMotion) frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
