// Alignment Phase 3: MazeMap's walls as rules (src/ar/corridor-guard.js), the correction budget
// (route-matcher.js) and "Keep walking" (ar-status.js).
import {describe, expect, it} from 'vitest'
import {arrowsForConfidence, createAlignConfidence, createCorridorGuard, matchPoints, nearestCorridorPoint, wallRules} from '../../src/ar/corridor-guard.js'
import {clampCorrection, createRouteMatcher, fitTrackToRoute, recencyWeights} from '../../src/ar/route-matcher.js'
import {statusMessage} from '../../src/ui/screens/ar-status.js'
import {CORRIDOR, MATCH} from '../../src/config.js'

// Two parallel corridors 4 m apart (y = 0 and y = 4), divided by a wall along y = 2, with a door
// gap in the wall at x = 10 (door line from x = 9.5 to 10.5). The route runs along the lower one
// and turns 90° left at x = 20 up to y = 10.
const wall = (a, b) => ({id: `${a.x},${a.y}`, polygon: [[a, b, {x: b.x, y: b.y + 0.1}, {x: a.x, y: a.y + 0.1}, a]]})
const floor = {
  level: 1,
  walls: [wall({x: -5, y: 2}, {x: 9.5, y: 2}), wall({x: 10.5, y: 2}, {x: 18, y: 2})],
  doors: [{id: 'gap', a: {x: 9.5, y: 2.05}, b: {x: 10.5, y: 2.05}}],
}
const route = [{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 10}]
const identity = ({x, z}) => ({x, y: -z}) // world (x, z) -> route frame with a perfect placement
const cam = (x, y) => ({x, z: -y})

describe('the walls as rules', () => {
  const rules = wallRules(floor)

  it('walking through a wall is caught; through the door gap it is not', () => {
    expect(rules.crosses({x: 5, y: 0}, {x: 5, y: 4})).not.toBeNull()
    expect(rules.crosses({x: 10, y: 0}, {x: 10, y: 4})).toBeNull()
    expect(rules.crosses({x: 2, y: 0}, {x: 8, y: 0})).toBeNull()
  })

  it('no walls loaded: no rules', () => {
    expect(wallRules(null)).toBeNull()
    expect(wallRules({walls: [], doors: []})).toBeNull()
  })

  it('the nearest corridor point is one that can be reached without crossing a wall', () => {
    // From the upper corridor the route below is behind the wall: only via the door (x ~10).
    const p = {x: 5, y: 3.5}
    // The wall is in the way of every route point within 10 m: none can be reached.
    expect(nearestCorridorPoint(route, rules, p, {x: 5, y: 3.5}, 5, {maxM: 10})).toBeNull()
    // Further: only points the straight line reaches through the door gap or past the wall's end.
    const fromAbove = nearestCorridorPoint(route, rules, p, {x: 5, y: 3.5}, 5, {maxM: 20})
    expect(fromAbove).not.toBeNull()
    expect(rules.crosses({x: 5, y: 3.5}, fromAbove)).toBeNull()
    expect(fromAbove.x).toBeGreaterThan(15)
    // From below, the nearest route point straight down is fine.
    const fromBelow = nearestCorridorPoint(route, rules, p, {x: 5, y: 0.5}, 5)
    expect(fromBelow.x).toBeCloseTo(5, 0)
    expect(fromBelow.y).toBe(0)
  })
})

describe('the guard', () => {
  it('a tracked position that goes through a wall is snapped back to the corridor', () => {
    const g = createCorridorGuard(route)
    g.setFloor(floor)
    expect(g.step({cam: cam(5, 0.5), toRoute: identity, s: 5}).snap).toBeNull()
    // The placement drifts: the tracked position is now beyond the wall, in the other corridor.
    const r = g.step({cam: cam(5.3, 2.6), toRoute: identity, s: 5})
    expect(r.snap).not.toBeNull()
    expect(r.snap.to.y).toBe(0) // back on the route, on the user's side of the wall
    expect(Math.abs(r.snap.to.x - 5.3)).toBeLessThan(0.6)
  })

  it('through the door gap there is no snap', () => {
    const g = createCorridorGuard(route)
    g.setFloor(floor)
    g.step({cam: cam(10, 0.5), toRoute: identity, s: 10})
    expect(g.step({cam: cam(10, 3), toRoute: identity, s: 10}).snap).toBeNull()
  })

  it('a correction moving the placement is never taken for walking through a wall', () => {
    const g = createCorridorGuard(route)
    g.setFloor(floor)
    g.step({cam: cam(5, 0.5), toRoute: identity, s: 5})
    // The same camera position read through a placement shifted 0.2 m: still the same side.
    const shifted = ({x, z}) => ({x: x + 0.2, y: -z - 0.2})
    expect(g.step({cam: cam(5, 0.6), toRoute: shifted, s: 5}).snap).toBeNull()
  })

  it('the progress follows the tracked position: a lag at a corner no longer stalls it', () => {
    const g = createCorridorGuard(route)
    g.setFloor(floor)
    // The trip's progress is stuck at 18 m, but the user is already 4 m up the next leg (s = 24).
    const r = g.step({cam: cam(20, 4), toRoute: identity, s: 18})
    expect(r.progressS).toBeCloseTo(24, 0)
  })

  it('path matching re-runs at every door crossing and every turn of 35° or more, once each', () => {
    const points = matchPoints(route, wallRules(floor).doors)
    expect(points.map((m) => m.kind)).toEqual(['turn']) // the route does not go through the gap
    // A bend of 30° (no re-match), then one of 50° (a re-match, 4 m after it).
    const leg = (from, deg, m) => ({x: from.x + m * Math.sin((deg * Math.PI) / 180), y: from.y + m * Math.cos((deg * Math.PI) / 180)})
    const a = {x: 0, y: 0}
    const b = leg(a, 90, 10)
    const c = leg(b, 120, 10)
    const d = leg(c, 170, 10)
    const turns = matchPoints([a, b, c, d]).filter((m) => m.kind === 'turn')
    expect(turns).toHaveLength(1)
    expect(Math.abs(turns[0].angle)).toBeCloseTo(50, 0)
    expect(turns[0].at).toBeCloseTo(turns[0].s + CORRIDOR.turnArmM, 6)

    const through = [{x: 10, y: -3}, {x: 10, y: 8}] // straight through the door gap
    const doors = matchPoints(through, wallRules(floor).doors)
    expect(doors.map((m) => m.kind)).toEqual(['door'])
    const g = createCorridorGuard(through)
    g.setFloor(floor)
    const events = []
    for (let y = -3; y <= 8; y += 0.25) events.push(...g.step({cam: cam(10, y), toRoute: identity, s: y + 3}).events)
    expect(events.map((e) => e.kind)).toEqual(['door'])
  })

  it('the walk crossing the route door line near the route crossing is a door anchor', () => {
    const through = [{x: 10, y: -3}, {x: 10, y: 8}]
    const g = createCorridorGuard(through)
    g.setFloor(floor)
    let anchor = null
    // The walk crosses the door line 0.3 m to the side of where the route crosses it.
    for (let y = -3; y <= 8 && !anchor; y += 0.25) anchor = g.step({cam: cam(10.3, y), toRoute: identity, s: y + 3}).doorAnchor
    expect(anchor).not.toBeNull()
    expect(anchor.by.dx).toBeCloseTo(-0.3, 1)
  })
})

describe('the correction budget', () => {
  it('no correction bigger than MATCH.maxTotalM in total before an anchor; an anchor starts it again', () => {
    const total = {dx: 0, dy: 0, yaw: 0}
    let moved = 0
    for (let i = 0; i < 20; i++) {
      const c = clampCorrection({dx: 5, dy: 0, yaw: 0, pivot: {x: 0, y: 0}}, total)
      total.dx += c.dx
      moved += c.dx
    }
    expect(moved).toBeCloseTo(MATCH.maxTotalM, 6)
    const m = createRouteMatcher(route)
    m.spend({dx: MATCH.maxTotalM})
    expect(m.roomM).toBe(0)
    m.resetBudget()
    expect(m.roomM).toBe(MATCH.maxTotalM)
  })
})

describe('path matching weights the latest metres', () => {
  it('a sample 10 m back counts e^-(10 / recentWeightM) as much as the newest', () => {
    const track = Array.from({length: 11}, (_, i) => ({x: i, y: 0}))
    const w = recencyWeights(track)
    expect(w.at(-1)).toBe(1)
    expect(w[0]).toBeCloseTo(Math.exp(-10 / MATCH.recentWeightM), 6)
  })

  it('a track bent by heading drift is matched to where the user faces now, not its average', () => {
    // 20 m walked along x, SLAM turning it 0.3° per metre: the newest leg is ~6° off the corridor.
    const track = []
    let x = 0
    let y = 0
    for (let i = 0; i <= 40; i++) {
      const a = (-0.3 * i * 0.5 * Math.PI) / 180
      track.push({x, y})
      x += 0.5 * Math.cos(a)
      y += 0.5 * Math.sin(a)
    }
    const corridor = [{x: -5, y: 0}, {x: 40, y: 0}]
    const recent = Math.abs(fitTrackToRoute(track, corridor).yaw)
    const even = Math.abs(fitTrackToRoute(track, corridor, {recentM: 0}).yaw)
    expect(recent).toBeGreaterThan(even) // turns further: towards the drift at the user, ~6°
  })
})

describe('confidence, fading and "Keep walking"', () => {
  it('falls with metres walked since the last anchor or confident match, and an anchor restores it', () => {
    const c = createAlignConfidence()
    expect(c.update({walkedM: 0, time: 0})).toBe(1)
    expect(c.update({walkedM: CORRIDOR.decayM, time: 1})).toBe(0)
    c.confirm(CORRIDOR.decayM)
    expect(c.update({walkedM: CORRIDOR.decayM, time: 2})).toBe(1)
  })

  it('big corrections mean the arrows were off: low until the walk has gone on', () => {
    const c = createAlignConfidence()
    c.corrected({dx: 0, dy: 0, yaw: (15 * Math.PI) / 180}, 10) // 6 m out, 1.55 m
    expect(c.update({walkedM: 10, time: 0})).toBeLessThan(CORRIDOR.fadeBelow)
    const later = 10 + 4 * CORRIDOR.innovationHalfM
    c.confirm(later) // a confident match since: only the correction's own memory is left
    expect(c.update({walkedM: later, time: 1})).toBeGreaterThan(CORRIDOR.fadeBelow)
  })

  it('the along error matters at a turn: far from the last matched corner, fade before it', () => {
    const c = createAlignConfidence()
    c.alongFixed(0)
    const far = (CORRIDOR.fadeErrorM / CORRIDOR.alongDriftPerM) * 1.2
    expect(c.update({walkedM: far, time: 0, turnSin: 1})).toBeLessThan(CORRIDOR.fadeBelow)
    expect(c.update({walkedM: far, time: 0, turnSin: 0})).toBeGreaterThan(CORRIDOR.fadeBelow - 0.5) // straight ahead: no along effect
  })

  it('a wall crossing that could not be put right holds it low; so does lost tracking', () => {
    const c = createAlignConfidence()
    c.blocked(0)
    expect(c.update({walkedM: 0, time: 1})).toBeLessThan(CORRIDOR.fadeBelow)
    expect(c.update({walkedM: 0, time: CORRIDOR.violationHoldS + 1})).toBe(1)
    expect(c.update({walkedM: 0, time: 99, tracking: 'LIMITED'})).toBeLessThan(CORRIDOR.fadeBelow)
  })

  it('low: faded arrows and "Keep walking"; middling: dimmer; high: full', () => {
    expect(arrowsForConfidence(0.2)).toEqual({opacity: CORRIDOR.fadedOpacity, keepWalking: true})
    expect(arrowsForConfidence(0.6)).toEqual({opacity: CORRIDOR.dimOpacity, keepWalking: false})
    expect(arrowsForConfidence(0.9)).toEqual({opacity: 1, keepWalking: false})
  })

  it('the pill says "Keep walking" instead of the arrows being trusted', () => {
    const ready = {phase: 'ready', arrived: false, tracking: 'NORMAL'}
    expect(statusMessage({...ready, keepWalking: true})).toMatchObject({key: 'keep-walking', text: 'Keep walking. Lining up the arrows'})
    expect(statusMessage({...ready, keepWalking: true, lookUp: true}).key).toBe('look-up') // safety first
    expect(statusMessage({...ready, keepWalking: false})).toBeNull()
  })
})
