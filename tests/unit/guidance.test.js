import {describe, expect, it} from 'vitest'
import {
  buildManoeuvres,
  classifyTurn,
  createGuidance,
  instructionFor,
  roundDistance,
} from '../../src/route/guidance.js'

const near = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const types = (route) => buildManoeuvres(route).map((m) => m.type)

// Walk north, then turn: x east, y north.
const STRAIGHT = [{x: 0, y: 0}, {x: 0, y: 100}]
const RIGHT = [{x: 0, y: 0}, {x: 0, y: 40}, {x: 30, y: 40}]
const LEFT = [{x: 0, y: 0}, {x: 0, y: 40}, {x: -30, y: 40}]

describe('building manoeuvres', () => {
  it('1. a straight route has no turns, only the arrival', () => {
    expect(buildManoeuvres(STRAIGHT)).toEqual([{s: 100, type: 'arrive', angle: 0}])
  })
  it('2. one left turn', () => {
    const [turn, end] = buildManoeuvres(LEFT)
    expect(turn.type).toBe('left')
    near(turn.s, 40, 1e-6)
    near(turn.angle, -90, 1e-6)
    expect(end).toEqual({s: 70, type: 'arrive', angle: 0})
  })
  it('3. one right turn', () => {
    const [turn] = buildManoeuvres(RIGHT)
    expect(turn.type).toBe('right')
    near(turn.s, 40, 1e-6)
    near(turn.angle, 90, 1e-6)
  })
  it('4. several consecutive turns, in order', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}, {x: 30, y: 60}, {x: 60, y: 60}]
    expect(types(route)).toEqual(['right', 'left', 'right', 'arrive'])
    expect(buildManoeuvres(route).map((m) => Math.round(m.s))).toEqual([30, 60, 90, 120])
  })
  it('5. a wiggly path with many small bends reports no turns', () => {
    const route = []
    for (let i = 0; i <= 40; i++) route.push({x: (i % 2) * 0.6, y: i * 3})
    expect(types(route)).toEqual(['arrive'])
  })
  it('5. a curve of many small bends is one turn, not one per bend', () => {
    const route = [{x: 0, y: 0}]
    let heading = 0
    for (let i = 0; i < 9; i++) {
      heading += (10 * Math.PI) / 180
      const last = route.at(-1)
      route.push({x: last.x + Math.sin(heading) * 2.5, y: last.y + Math.cos(heading) * 2.5})
    }
    route.push({x: route.at(-1).x + 40, y: route.at(-1).y})
    expect(types(route)).toEqual(['right', 'arrive'])
    near(buildManoeuvres(route)[0].angle, 80, 6)
  })
  it('groups a rounded corner, drawn with a few vertices, into one turn', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 1, y: 32}, {x: 3, y: 33}, {x: 30, y: 33}]
    expect(types(route)).toEqual(['right', 'arrive'])
  })
  it('keeps two real corners close together apart when they turn opposite ways', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 4, y: 30}, {x: 4, y: 60}]
    expect(types(route)).toEqual(['right', 'left', 'arrive'])
  })
  it('ignores a little sidestep in the path, like the real routes have', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 50}, {x: 1.5, y: 50}, {x: 1.5, y: 100}]
    expect(types(route)).toEqual(['arrive'])
  })
  it('keeps a real corner that follows a sidestep', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 50}, {x: 1.5, y: 50}, {x: 1.5, y: 100}, {x: 40, y: 100}]
    expect(types(route)).toEqual(['right', 'arrive'])
  })
  it('6. a route of 10+ waypoints stays in order and ends with the arrival', () => {
    const route = []
    for (let i = 0; i < 14; i++) route.push({x: i % 2 === 0 ? i * 10 : (i - 1) * 10, y: i % 2 === 0 ? i * 10 : (i + 1) * 10})
    const all = buildManoeuvres(route)
    expect(all.length).toBeGreaterThan(10)
    expect(all.every((m, i) => !i || m.s > all[i - 1].s)).toBe(true)
    expect(all.at(-1).type).toBe('arrive')
  })
  it('names turns by how sharp they are', () => {
    expect(classifyTurn(20)).toBe('straight')
    expect(classifyTurn(30)).toBe('slight-right')
    expect(classifyTurn(-30)).toBe('slight-left')
    expect(classifyTurn(90)).toBe('right')
    expect(classifyTurn(-90)).toBe('left')
  })
})

describe('what the pill says', () => {
  it('rounds distances for reading', () => {
    expect(roundDistance(12.4)).toBe('12 m')
    expect(roundDistance(38)).toBe('40 m')
    expect(roundDistance(1234)).toBe('1.2 km')
  })
  it('says the three kinds of instruction', () => {
    expect(instructionFor({type: 'left'}, 12.2)).toBe('Turn left in 12 m')
    expect(instructionFor({type: 'right'}, 41)).toBe('Continue straight 40 m')
    expect(instructionFor({type: 'arrive'}, 8, 'Pathfoot entrance')).toBe('Pathfoot entrance in 8 m')
    expect(instructionFor({type: 'slight-left'}, 9)).toBe('Bear left in 9 m')
    expect(instructionFor({type: 'right'}, 1)).toBe('Turn right now')
  })
  it('follows a walk along the route', () => {
    const guide = createGuidance(RIGHT, {arriveLabel: 'Pathfoot entrance'})
    expect(guide.instruction(0)).toBe('Continue straight 40 m')
    expect(guide.instruction(28)).toBe('Turn right in 12 m')
    expect(guide.instruction(39.5)).toBe('Turn right now')
    expect(guide.instruction(62)).toBe('Pathfoot entrance in 8 m')
  })
})

describe('the next manoeuvre', () => {
  it('stays on a corner until the user is 2 m past it', () => {
    const guide = createGuidance(RIGHT)
    expect(guide.getNextManoeuvre(39).type).toBe('right')
    expect(guide.getNextManoeuvre(41.9).type).toBe('right')
    expect(guide.getNextManoeuvre(42).type).toBe('arrive')
  })
  it('7. jitter near a corner neither skips a turn nor flip-flops', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 40}, {x: 30, y: 40}, {x: 30, y: 70}]
    const guide = createGuidance(route)
    const seen = []
    // ±1.5 m of noise walking through the first corner, then on to the next.
    for (let s = 34; s <= 75; s += 0.5) {
      const noise = Math.sin(s * 17) * 1.5
      seen.push(guide.getNextManoeuvre(s + noise).s)
    }
    const changes = seen.filter((value, i) => i && value !== seen[i - 1])
    expect(changes).toEqual([70, 100]) // each once, in order: no skipping, no going back
    expect(seen[0]).toBe(40)
  })
  it('jitter sitting right on the corner keeps the same turn', () => {
    const guide = createGuidance(RIGHT)
    for (const s of [39, 41, 39.5, 41.5, 39, 41.9, 40]) expect(guide.getNextManoeuvre(s).type).toBe('right')
  })
  it('goes back to a corner if the user really walks back past it', () => {
    const guide = createGuidance(RIGHT)
    expect(guide.getNextManoeuvre(50).type).toBe('arrive')
    expect(guide.getNextManoeuvre(35).type).toBe('arrive') // small step back: stays
    expect(guide.getNextManoeuvre(25).type).toBe('right')
  })
  it('ticks once, 5 m before each turn, and not for the arrival', () => {
    const route = [{x: 0, y: 0}, {x: 0, y: 40}, {x: 30, y: 40}, {x: 30, y: 70}]
    const guide = createGuidance(route)
    const ticks = []
    for (let s = 0; s <= 100; s += 0.5) if (guide.turnIsClose(s)) ticks.push(s)
    expect(ticks).toEqual([35, 65])
  })
})
