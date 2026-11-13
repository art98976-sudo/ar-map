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
