import {describe, expect, it} from 'vitest'
import {fromLocal} from '../../src/geo/geo.js'
import {createTripSteps, stepLine, turnBanner} from '../../src/route/trip-steps.js'

// Item 2: turn-by-turn on the map trip, from the route's own shape and the places beside it.
const ORIGIN = {lat: 56.1487, lng: -3.927}
const at = (x, y) => fromLocal(ORIGIN, {x, y})
// North 100 m, a left turn by Cottrell, west 80 m, a right turn (no place near), north 60 m.
const ROUTE = {points: [at(0, 0), at(0, 100), at(-80, 100), at(-80, 160)]}
const PLACES = [
  {id: 'cottrell', name: 'Cottrell Building', ...at(8, 108)},
  {id: 'library', name: 'Library', ...at(-80, 170)},
]
const steps = () => createTripSteps(ROUTE, {arriveLabel: 'Library entrance', destinations: PLACES, destinationId: 'library'})

describe('turnBanner', () => {
  it('says the distance first, then the turn and the place', () => {
    expect(turnBanner({type: 'left', landmark: 'Cottrell Building'}, 80, 'X')).toBe('In 80 m, turn left at the Cottrell Building')
    expect(turnBanner({type: 'slight-right'}, 123, 'X')).toBe('In 125 m, bear right')
  })
  it('says "now" at the corner, and names the end', () => {
    expect(turnBanner({type: 'right', landmark: 'Atrium'}, 3, 'X')).toBe('Turn right now at the Atrium')
    expect(turnBanner({type: 'arrive'}, 40, 'Library entrance')).toBe('In 40 m, arrive at Library entrance')
    expect(turnBanner({type: 'arrive'}, 2, 'Library entrance')).toBe('You’ve arrived at Library entrance')
  })
  it('stepLine is the list wording', () => {
    expect(stepLine({type: 'left', landmark: 'Scran'}, 'X')).toBe('Turn left at Scran')
    expect(stepLine({type: 'right'}, 'X')).toBe('Turn right')
    expect(stepLine({type: 'arrive'}, 'Library entrance')).toBe('Arrive at Library entrance')
  })
})

describe('createTripSteps', () => {
  it('finds the two turns and the end, naming the corner beside a place', () => {
    const s = steps()
    expect(s.manoeuvres.map((m) => m.type)).toEqual(['left', 'right', 'arrive'])
    expect(s.manoeuvres[0].landmark).toBe('Cottrell Building')
    expect(s.manoeuvres[1].landmark ?? null).toBeNull() // the destination itself is not a corner name
  })

  it('with no GPS (a laptop): the first step, and a static list from the start', () => {
    const s = steps()
    expect(s.banner().text).toBe('In 100 m, turn left at the Cottrell Building')
    expect(s.list().map(({fromS: _from, toS: _to, ...rest}) => rest)).toEqual([
      {icon: 'left', text: 'Turn left at the Cottrell Building', walkText: '100 m', done: false, current: true},
      {icon: 'right', text: 'Turn right', walkText: '80 m', done: false, current: false},
      {icon: 'arrive', text: 'Arrive at Library entrance', walkText: '60 m', done: false, current: false},
    ])
  })

  it('updates as the walker moves along', () => {
    const s = steps()
    expect(s.banner(s.along(at(0, 20))).text).toBe('In 80 m, turn left at the Cottrell Building')
    expect(s.banner(s.along(at(0, 98))).text).toBe('Turn left now at the Cottrell Building')
    const later = s.along(at(-40, 100))
    expect(s.banner(later).text).toBe('In 40 m, turn right')
    expect(s.list(later).map((x) => [x.done, x.current])).toEqual([[true, false], [false, true], [false, false]])
    expect(s.banner(s.along(at(-80, 120))).text).toBe('In 40 m, arrive at Library entrance')
  })
})

describe('item 2: steps a newcomer can follow (merged)', async () => {
  const {readFileSync} = await import('node:fs')
  const {simplifySteps, STEP_MERGE} = await import('../../src/route/trip-steps.js')
  const {DESTINATIONS} = await import('../../src/map/destinations.js')
  const turn = (s, angle, landmark = null) => ({s, angle, type: angle > 0 ? 'right' : 'left', landmark})
  const arrive = (s) => ({s, angle: 0, type: 'arrive'})

  it('thresholds', () => {
    expect(STEP_MERGE).toEqual({minLegM: 12, minTurnDeg: 30, pairM: 40, wiggleNetDeg: 35, wiggleSideM: 8, bearMaxDeg: 50})
  })
  it('a corner 12 m or less after another joins it; a merged turn under 30° is no step', () => {
    expect(simplifySteps([turn(100, 70), turn(108, 40), arrive(300)]).map((m) => [m.type, Math.round(m.angle)])).toEqual([['right', 110], ['arrive', 0]])
    expect(simplifySteps([turn(100, 27), turn(111, -47), arrive(300)]).map((m) => m.type)).toEqual(['arrive']) // net 20°
  })
  it('a wiggle on the same path goes; a real step sideways at a junction stays, as one step', () => {
    expect(simplifySteps([turn(100, 20), turn(115, -20), arrive(300)]).map((m) => m.type)).toEqual(['arrive']) // small, under 30° each
    const jog = simplifySteps([turn(100, 90), turn(130, -88), arrive(300)])
    expect(jog.map((m) => m.type)).toEqual(['right', 'arrive'])
    expect(jog[0]).toMatchObject({endS: 130, then: {type: 'left', gapM: 30}})
  })
  it('two turns further apart than 40 m are two steps', () => {
    expect(simplifySteps([turn(100, 90), turn(150, -90), arrive(300)]).map((m) => m.type)).toEqual(['right', 'left', 'arrive'])
  })
  it('a turn just before the end is part of arriving', () => {
    expect(simplifySteps([turn(100, 90), turn(290, -90), arrive(300)]).map((m) => m.type)).toEqual(['right', 'arrive'])
  })

  it('Pathfoot main entrance to the Library: 15 corners read as 5 to 7 clear steps', () => {
    const route = JSON.parse(readFileSync('tests/fixtures/route-pathfoot-library.json', 'utf8'))
    const s = createTripSteps(route, {arriveLabel: 'Library entrance', destinations: DESTINATIONS, destinationId: 'library'})
    const lines = s.list().map((x) => `${x.text} · ${x.walkText}`)
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines.length).toBeLessThanOrEqual(7)
    expect(lines.some((l) => / · (1|5|11) m$/.test(l))).toBe(false) // no tiny steps
    expect(lines).toMatchSnapshot()
  })

  it('a step of two turns: the banner says both, then the second on its own once past the first', () => {
    const route = JSON.parse(readFileSync('tests/fixtures/route-pathfoot-library.json', 'utf8'))
    const s = createTripSteps(route, {arriveLabel: 'Library entrance', destinations: DESTINATIONS, destinationId: 'library'})
    const first = s.manoeuvres[0]
    expect(s.banner(0).text).toMatch(/^In 25 m, turn right at the Pathfoot Building, then left 20 m later$/)
    expect(s.banner(first.s + 5).text).toMatch(/^In 1\d m, turn left$/)
  })
})
