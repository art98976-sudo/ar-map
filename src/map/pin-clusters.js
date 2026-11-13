// The home map's pins, kept readable (7.3): at campus zoom one pin per building, and pins whose
// icons would overlap on screen merge into one numbered cluster. Pure: screen points in, groups out.

/**
 * At campus zoom, a building shows one pin: the first place listed in it (the building itself
 * comes first in destinations.json). Places with no building keep their own pin.
 * @returns the ids to draw
 */
export function onePerBuilding(dests) {
  const seen = new Set()
  const ids = []
  for (const d of dests) {
    const name = d.building?.trim().toLowerCase()
    const key = name && name !== 'outdoors' ? name : null
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    ids.push(d.id)
  }
  return ids
}

/**
 * Greedy screen-space clustering. points: [{id, x, y, keep?}] in pixels; a point with keep (the
 * selected place) is never merged away. Each cluster is centred on its first point.
 * @returns [{ids, x, y}]
 */
export function clusterPoints(points, radiusPx) {
  const order = [...points].sort((a, b) => Number(Boolean(b.keep)) - Number(Boolean(a.keep)))
  const clusters = []
  for (const p of order) {
    const near = p.keep ? null : clusters.find((c) => !c.keep && Math.hypot(c.x - p.x, c.y - p.y) < radiusPx)
    if (near) near.ids.push(p.id)
    else clusters.push({ids: [p.id], x: p.x, y: p.y, keep: Boolean(p.keep)})
  }
  return clusters.map(({ids, x, y}) => ({ids, x, y}))
}

/** A size from a Mapbox zoom-stops table ({stops: [[zoom, value], ...]}), linear between stops. */
export function sizeAtZoom(stops, zoom) {
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i]
    const [z0, v0] = stops[i - 1]
    if (zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0)
  }
  return stops.at(-1)[1]
}

/**
 * Where a building name is drawn on screen: under its point (text-anchor top, offset 1.6 em),
 * wrapped at 10 em. An estimate from the text length, a little generous so a pin never touches it.
 * @returns {left, top, right, bottom} in pixels
 */
export function labelBox({x, y, text}, sizePx, {offsetEm = 1.6, maxWidthEm = 10, charEm = 0.62, padPx = 4} = {}) {
  const textEm = String(text ?? '').length * charEm
  const widthEm = Math.min(textEm, maxWidthEm)
  const lines = Math.max(1, Math.ceil(textEm / maxWidthEm))
  const top = y + offsetEm * sizePx - padPx
  const half = (widthEm * sizePx) / 2 + padPx
  return {left: x - half, right: x + half, top, bottom: top + lines * 1.2 * sizePx + 2 * padPx}
}

/**
 * Building names and the screen's own bars come first: any pin whose dot would cover one is
 * hidden. pins: [{id, x, y, keep?}]; a pin with keep (the selected place) always shows.
 * @returns the set of ids to hide
 */
export function blockedPins(pins, boxes, dotRadiusPx) {
  const hidden = new Set()
  for (const p of pins) {
    if (p.keep) continue
    const hit = boxes.some((b) => p.x + dotRadiusPx > b.left && p.x - dotRadiusPx < b.right && p.y + dotRadiusPx > b.top && p.y - dotRadiusPx < b.bottom)
    if (hit) hidden.add(p.id)
  }
  return hidden
}
