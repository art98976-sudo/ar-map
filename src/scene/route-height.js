// Step 3: the height of the floor along the route, from the 3D scene (fit-route.js gives each
// fitted point an h: its floor's height, or a point on a stair's slope). The AR arrows read it, so
// they lie on the scene's floors: flat along a corridor, climbing ahead on a stair.
import {projectOntoPolyline, toLocal} from '../geo/geo.js'
import {floorIndex, OUTDOOR} from './scene-data.js'
import {INDOOR} from '../config.js'

/**
 * Heights for points that came without one (a route saved before Step 2): each floor counted in
 * order from the floor the walk is first indoors on, outdoors at 0.
 */
export function heightsFromLevels(points, floorHeightM = INDOOR.floorHeightM) {
  let ground = null
  return points.map((p) => {
    if (!Number.isFinite(p.z) || p.z === OUTDOOR) {
      ground = null
      return 0
    }
    ground ??= p.z
    return (floorIndex(p.z) - floorIndex(ground)) * floorHeightM
  })
}

/**
 * h(s): the floor's height at distance s along `navRoute` (the AR route, route-frame metres), from
 * the fitted points [{lat, lng, z, h}]. Linear between the points; flat past either end.
 */
export function createHeightProfile(points, navRoute, origin) {
  if (!points?.length || !navRoute?.length) return () => 0
  const hs = points.every((p) => Number.isFinite(p.h)) ? points.map((p) => p.h) : heightsFromLevels(points)
  // Each fitted point's place along the AR route; kept in walking order.
  const profile = []
  let lastS = -Infinity
  points.forEach((p, i) => {
    const s = projectOntoPolyline(navRoute, toLocal(origin, p)).s
    if (s >= lastS) {
      profile.push({s, h: hs[i]})
      lastS = s
    }
  })
  return (s) => {
    if (!profile.length) return 0
    if (s <= profile[0].s) return profile[0].h
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1]
      const b = profile[i]
      if (s <= b.s) return b.s > a.s ? a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s) : b.h
    }
    return profile.at(-1).h
  }
}
