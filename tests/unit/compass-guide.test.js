import {describe, expect, it} from 'vitest'
import * as THREE from 'three'
import {arrowDrop, createGuideArrow} from '../../src/arrows/guide-arrow.js'
import {createArrowTrail, TRAIL, visibleWindowEnd} from '../../src/arrows/trail.js'
import {
  arrowTarget,
  arrowYawDeg,
  blendBearing,
  COMPASS_GUIDE,
  createRouteTracker,
  stepBearing,
  turnPrompt,
  walkingCorrection,
} from '../../src/nav/compass-guide.js'
import {buildManoeuvres, createGuidance, instructionFor, landmarkPhrase, landmarksFrom, nearestLandmark, spokenStep, stepIcon} from '../../src/nav/guidance.js'
import {COMPASS_MAP, mapCamera, viewKey} from '../../src/ui/components/compass-map.js'
import {icon} from '../../src/ui/icons.js'

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const nearAngle = (a, b, tol = 1e-6) => expect(Math.abs((((a - b + 540) % 360) + 360) % 360 - 180)).toBeLessThanOrEqual(tol)

// 40 m north, then right (or left) for 40 m.
const rightTurn = [{x: 0, y: 0}, {x: 0, y: 40}, {x: 40, y: 40}]
const leftTurn = [{x: 0, y: 0}, {x: 0, y: 40}, {x: -40, y: 40}]

function targetAt(route, s) {
  const manoeuvres = buildManoeuvres(route)
  const next = manoeuvres.find((m) => m.s + 2 > s) ?? manoeuvres.at(-1)
  return arrowTarget(route, manoeuvres, next, s)
}

describe('the 3D arrow points along the route, from the way the user faces', () => {
  const directions = {N: 0, E: 90, S: 180, W: 270}
  const expected = {
    // Facing north: a segment going north is ahead, east to the right, south behind, west to the left.
    N: {N: 0, E: 90, S: 180, W: -90},
    E: {N: -90, E: 0, S: 90, W: 180},
    S: {N: 180, E: -90, S: 0, W: 90},
    W: {N: 90, E: 180, S: -90, W: 0},
  }
  for (const [facing, heading] of Object.entries(directions)) {
    for (const [going, bearing] of Object.entries(directions)) {
      it(`segment going ${going}, compass ${facing}`, () => {
        near(Math.abs(arrowYawDeg(bearing, heading)), Math.abs(expected[facing][going]))
        if (Math.abs(expected[facing][going]) !== 180) near(arrowYawDeg(bearing, heading), expected[facing][going])
      })
    }
  }
  it('takes the short way across north', () => {
    near(arrowYawDeg(10, 350), 20)
    near(arrowYawDeg(350, 10), -20)
  })
})

describe('blending into a turn from 12 m', () => {
  it('further off than 12 m, it follows the current segment with an empty ring', () => {
    const t = targetAt(rightTurn, 20)
    nearAngle(t.bearingDeg, 0, 0.01)
    near(t.ringFill, 0)
  })
  it('a right turn: starts at 12 m, halfway at 6 m, all the way at the corner', () => {
    nearAngle(targetAt(rightTurn, 28).bearingDeg, 0, 0.01)
    nearAngle(targetAt(rightTurn, 34).bearingDeg, 45, 0.5)
    near(targetAt(rightTurn, 34).ringFill, 0.5, 1e-6)
    nearAngle(targetAt(rightTurn, 40).bearingDeg, 90, 0.5)
    near(targetAt(rightTurn, 40).ringFill, 1)
  })
  it('a left turn curves the other way', () => {
    nearAngle(targetAt(leftTurn, 28).bearingDeg, 0, 0.01)
    nearAngle(targetAt(leftTurn, 34).bearingDeg, -45, 0.5)
    nearAngle(targetAt(leftTurn, 40).bearingDeg, -90, 0.5)
  })
  it('after the corner it settles on the new segment', () => {
    nearAngle(targetAt(rightTurn, 50).bearingDeg, 90, 0.01)
    near(targetAt(rightTurn, 50).ringFill, 0)
  })
  it('blends the short way across north', () => {
    nearAngle(blendBearing(350, 30, 0.5), 10)
    nearAngle(blendBearing(30, 350, 0.5), 10)
  })
  it('at the very end of the route it keeps the last direction', () => {
    nearAngle(targetAt(rightTurn, 80).bearingDeg, 90, 0.01)
  })
})

describe('the arrow in the scene', () => {
  function setup() {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(2, 1.5, 3)
    camera.lookAt(2, 1.5, -10)
    camera.updateMatrixWorld(true)
    return {camera, arrow: createGuideArrow(THREE, {color: 0x00ff00})}
  }
  it('floats 2 m ahead, below the eye, tilted 20° towards the user', () => {
    const {camera, arrow} = setup()
    arrow.update(0.016, camera, 0)
    near(arrow.mesh.position.x, 2)
    near(arrow.mesh.position.z, 1)
    expect(arrow.mesh.position.y).toBeLessThan(1.5)
    near(arrow.mesh.children[0].rotation.x, (20 * Math.PI) / 180)
    near(arrow.relativeDeg, 0)
    arrow.dispose()
  })
  it('sits about 0.4 m below the eye for a phone tilted down, and rides up for a level one', () => {
    near(arrowDrop(-0.2), 0.4)
    expect(arrowDrop(0)).toBeLessThan(0.4)
    expect(arrowDrop(-0.5)).toBeLessThanOrEqual(0.6)
  })
  it('turns at no more than 120°/s, whichever way is shortest', () => {
    const {camera, arrow} = setup()
    arrow.update(0.016, camera, 0)
    arrow.update(0.1, camera, 90)
    near(arrow.relativeDeg, 12, 1e-6)
    for (let i = 0; i < 20; i++) arrow.update(0.1, camera, 90)
    near(arrow.relativeDeg, 90, 1e-6)
    arrow.dispose()
  })
  it('stays pointing the same way in the world when the phone turns quickly', () => {
    const {camera, arrow} = setup()
    arrow.update(0.016, camera, 0)
    const yaw = arrow.yaw
    camera.lookAt(102, 1.5, 3) // the user turns to face east, and the route now lies to their left
    camera.updateMatrixWorld(true)
    arrow.update(0.016, camera, -90)
    near(arrow.yaw, yaw, 1e-6)
    arrow.dispose()
  })
  it('fills the ring as the corner comes up', () => {
    const {camera, arrow} = setup()
    arrow.update(0.016, camera, 0, 0)
    expect(arrow.ring.visible).toBe(false)
    arrow.update(0.016, camera, 0, 0.5)
    expect(arrow.ring.visible).toBe(true)
    expect(arrow.ring.geometry.drawRange.count).toBe(32 * 6)
    arrow.dispose()
  })
  it('hides with no direction to show, and becomes a pin on arrival', () => {
    const {camera, arrow} = setup()
    arrow.update(0.016, camera, null)
    expect(arrow.mesh.visible).toBe(false)
    arrow.arrive()
    arrow.update(0.016, camera, null)
    expect(arrow.mesh.visible).toBe(true)
    expect(arrow.arrow.visible).toBe(false)
    expect(arrow.pin.visible).toBe(true)
    arrow.dispose()
  })
})

describe('naming turns after places', () => {
  const places = [
    {name: 'Far Hall', points: [{x: 29, y: 40}]},
    {name: 'Atrium', points: [{x: 500, y: 500}, {x: 10, y: 40}]},
    {name: 'Too Far', points: [{x: 40, y: 80}]},
  ]
  it('picks the nearest place within 30 m, by its centre or its entrance', () => {
    expect(nearestLandmark({x: 0, y: 40}, places)).toBe('Atrium')
    expect(nearestLandmark({x: 0, y: 40}, [places[0]])).toBe('Far Hall')
  })
  it('names nothing further off than 30 m', () => {
    expect(nearestLandmark({x: 0, y: 40}, [places[2]])).toBeNull()
    expect(nearestLandmark({x: 0, y: 40}, [{name: 'Just out', points: [{x: 30.5, y: 40}]}])).toBeNull()
  })
  it('reads naturally', () => {
    expect(landmarkPhrase('Atrium')).toBe('the Atrium')
    expect(landmarkPhrase('The Bite')).toBe('the Bite')
    expect(landmarkPhrase('Scran')).toBe('Scran')
  })
  it('says "at the Atrium · 12 m" with a place, and "in 12 m" without', () => {
    const turn = {type: 'left', s: 40}
    expect(instructionFor({...turn, landmark: 'Atrium'}, 12)).toBe('Turn left at the Atrium · 12 m')
    expect(instructionFor({...turn, landmark: 'Atrium'}, 1)).toBe('Turn left at the Atrium · now')
    expect(instructionFor(turn, 12)).toBe('Turn left in 12 m')
    expect(instructionFor(turn, 40, 'x', 'Library')).toBe('Continue past the Library · 40 m')
    expect(instructionFor(turn, 40)).toBe('Continue straight 40 m')
  })
  it('leaves the destination itself out', () => {
    const list = [{id: 'a', name: 'A', lat: 1, lng: 1}, {id: 'b', name: 'B', lat: 1, lng: 1}]
    expect(landmarksFrom(list, {lat: 1, lng: 1}, 'a').map((l) => l.name)).toEqual(['B'])
  })
  it('guidance uses the places along the whole route', () => {
    const guidance = createGuidance(rightTurn, {landmarks: [{name: 'Library', points: [{x: 10, y: 20}]}, {name: 'Atrium', points: [{x: 5, y: 45}]}]})
    expect(guidance.instruction(0)).toBe('Continue past the Library · 40 m')
    expect(guidance.instruction(30)).toBe('Turn right at the Atrium · 10 m')
  })
})

describe('the step list and turn events', () => {
  it('ticks the steps already done', () => {
    const guidance = createGuidance(rightTurn, {arriveLabel: 'Pathfoot entrance'})
    const before = guidance.steps(10)
    expect(before.map((s) => s.text)).toEqual(['Turn right', 'Pathfoot entrance'])
    expect(before[0]).toMatchObject({current: true, done: false, distanceM: 40})
    const after = guidance.steps(50)
    expect(after[0]).toMatchObject({current: false, done: true})
    expect(after[1]).toMatchObject({current: true, done: false, distanceM: 40})
  })
  it('fires 10 m before a turn, at it, and once it is passed, each only once', () => {
    const guidance = createGuidance(rightTurn)
    const log = []
    for (let s = 20; s < 50; s += 0.5) {
      if (guidance.turnPassed(s)) log.push(['passed', s])
      if (guidance.turnIsClose(s)) log.push(['close', s])
      if (guidance.turnIsNow(s)) log.push(['now', s])
    }
    expect(log).toEqual([['close', 30], ['now', 38], ['passed', 42]])
  })
  it('reads a step aloud without the distance, so it is spoken once', () => {
    expect(spokenStep('Turn left at the Atrium · 12 m')).toBe('Turn left at the Atrium')
    expect(spokenStep('Turn left at the Atrium · now')).toBe('Turn left at the Atrium')
    expect(spokenStep('Turn left in 12 m')).toBe('Turn left')
    expect(spokenStep('Turn left now')).toBe('Turn left')
    expect(spokenStep('Continue straight 1.2 km')).toBe('Continue straight')
    expect(spokenStep('Continue past the Library · 40 m')).toBe('Continue past the Library')
    expect(spokenStep('Pathfoot entrance in 8 m')).toBe('Pathfoot entrance')
    expect(spokenStep('Turn around')).toBe('Turn around')
  })
  it('has an icon for everything the card can show', () => {
    const types = ['left', 'right', 'slight-left', 'slight-right', 'arrive', 'straight', 'uturn']
    for (const name of types) expect(() => icon(name)).not.toThrow()
    expect(stepIcon({type: 'left'}, 12)).toBe('left')
    expect(stepIcon({type: 'left'}, 40)).toBe('straight')
    expect(stepIcon({type: 'arrive'}, 5)).toBe('arrive')
  })
})

describe('facing the route before guidance starts', () => {
  it('asks for a turn only when more than 60° off', () => {
    expect(turnPrompt(60)).toBeNull()
    expect(turnPrompt(-59)).toBeNull()
    expect(turnPrompt(61)).toBe('Turn right')
    expect(turnPrompt(-61)).toBe('Turn left')
    expect(turnPrompt(170)).toBe('Turn around')
    expect(turnPrompt(-170)).toBe('Turn around')
  })
  it('keeps prompting down to the 30° where guidance starts', () => {
    expect(turnPrompt(45, 0)).toBe('Turn right')
    expect(COMPASS_GUIDE.facingOkDeg).toBe(30)
  })
})

describe('the heading-up map', () => {
  const user = {lat: 56.14, lng: -3.92}
  it('turns so the way the user faces is up, tilted 45°', () => {
    const view = mapCamera({user, bearing: 123, height: 320})
    expect(view.bearing).toBe(123)
    expect(view.pitch).toBe(45)
    expect(view.center).toEqual([-3.92, 56.14])
  })
  it('keeps the dot low in the middle', () => {
    const {padding} = mapCamera({user, bearing: 0, height: 300})
    expect((padding.top + 300) / 2 / 300).toBeCloseTo(COMPASS_MAP.dotFromTop, 6)
    expect(padding.left).toBe(padding.right)
  })
  it('only counts as a new view when something has visibly moved', () => {
    const view = (lat, bearing, height = 300, expanded = false) => viewKey(mapCamera({user: {lat, lng: -3.92}, bearing, height, expanded}))
    expect(view(56.14, 10)).toBe(view(56.14, 10.01))
    expect(view(56.14, 10)).not.toBe(view(56.14, 10.5))
    expect(view(56.14, 10)).not.toBe(view(56.14001, 10))
    expect(view(56.14, 10)).not.toBe(view(56.14, 10, 800, true))
  })
  it('shows more of the campus when expanded', () => {
    expect(mapCamera({user, bearing: 0, height: 800, expanded: true}).zoom).toBeLessThan(mapCamera({user, bearing: 0, height: 300}).zoom)
  })
  it('eases at no more than 90°/s, the short way across north', () => {
    near(stepBearing(0, 90, 0.1), 9)
    near(stepBearing(350, 10, 0.1), 359)
    near(stepBearing(10, 350, 0.1), 1)
    near(stepBearing(0, 3, 0.1), 3)
    let bearing = 0
    for (let i = 0; i < 80; i++) bearing = stepBearing(bearing, 200, 0.05)
    nearAngle(bearing, 200, 1e-6)
  })
})

describe('where the dot is on the route', () => {
  it('moves by the distance SLAM measures', () => {
    const t = createRouteTracker(rightTurn, 10)
    t.walk({x: 0, z: 0})
    t.walk({x: 0, z: -6})
    near(t.s, 10) // a 6 m jump in one step is SLAM recovering, not walking
    for (let z = 6.5; z <= 11; z += 0.5) t.walk({x: 0, z: -z})
    near(t.s, 15)
  })
  it('does not creep while the user stands still', () => {
    const t = createRouteTracker(rightTurn, 10)
    for (let i = 0; i < 100; i++) t.walk({x: Math.sin(i) * 0.05, z: Math.cos(i) * 0.05})
    near(t.s, 10)
  })
  it('walking across the route does not move it along, walking back moves it back', () => {
    const toRoute = ({x, z}) => ({x, y: -z})
    const t = createRouteTracker(rightTurn, 10)
    t.walk({x: 0, z: 0}, toRoute)
    t.walk({x: 2, z: 0}, toRoute)
    near(t.s, 10)
    t.walk({x: 2, z: 2}, toRoute)
    near(t.s, 8)
  })
  it('each good fix only nudges it, and poor ones are ignored', () => {
    const t = createRouteTracker(rightTurn, 10)
    t.fix({x: 3, y: 20}, 5)
    near(t.s, 13.5)
    t.fix({x: 3, y: 40}, 60)
    near(t.s, 13.5)
  })
  it('ignores a fix far off the route', () => {
    const t = createRouteTracker(rightTurn, 10)
    t.fix({x: 200, y: 10}, 5)
    near(t.s, 10)
  })
  it('a route that doubles back cannot snap the dot to the other side', () => {
    const hairpin = [{x: 0, y: 0}, {x: 0, y: 100}, {x: 5, y: 100}, {x: 5, y: 0}]
    const t = createRouteTracker(hairpin, 10)
    t.fix({x: 5, y: 10}, 5) // nearest overall is on the way back, 195 m along
    expect(t.s).toBeLessThan(15)
  })
  it('the dot eases towards the estimate', () => {
    const t = createRouteTracker(rightTurn, 10)
    t.fix({x: 0, y: 25}, 5)
    t.tick(0.05)
    expect(t.shownS).toBeGreaterThan(10)
    expect(t.shownS).toBeLessThan(t.s)
    for (let i = 0; i < 100; i++) t.tick(0.05)
    near(t.shownS, t.s, 0.01)
  })
})

describe('reading the direction from walking', () => {
  const track = Array.from({length: 13}, (_, i) => ({x: i * 0.5, y: 0})) // walked 6 m east
  it('turns the walk on to the route once 6 m of straight walking shows it', () => {
    const fix = walkingCorrection(track, rightTurn, 6, 6) // the route runs north here
    near((fix.yaw * 180) / Math.PI, 90, 1e-6) // from east to north is counter-clockwise
    near(fix.pivot.x + fix.dx, 0)
    near(fix.pivot.y + fix.dy, 6)
  })
  it('waits for 6 m', () => {
    expect(walkingCorrection(track.slice(0, 11), rightTurn, 5, 5)).toBeNull()
  })
  it('a wandering walk shows no direction', () => {
    const wander = [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 4}, {x: 0, y: 4}, {x: 0, y: 1}]
    expect(walkingCorrection(wander, rightTurn, 6, 15)).toBeNull()
  })
})

describe('ground arrows', () => {
  const route = [{x: 0, y: 0}, {x: 0, y: 30}, {x: 30, y: 30}, {x: 30, y: 60}]
  const turns = [{s: 30, angle: 90}, {s: 60, angle: -90}]
  it('reach no more than 30 m ahead', () => {
    expect(TRAIL.aheadM).toBe(30)
    expect(TRAIL.spacingM).toBe(2)
    expect(visibleWindowEnd(turns, 0)).toBe(30)
    expect(visibleWindowEnd([], 40)).toBe(70)
    expect(visibleWindowEnd([{s: 100, angle: 90}], 35)).toBe(65)
  })
  it('stop at the next corner when that is closer', () => {
    expect(visibleWindowEnd(turns, 25)).toBe(30)
    expect(visibleWindowEnd(turns, 29)).toBe(30)
    expect(visibleWindowEnd(turns, 55)).toBe(60)
  })
  it('never show past the corner at any point on the walk', () => {
    for (let s = 0; s < 29; s += 0.25) {
      const end = visibleWindowEnd(turns, s)
      expect(end).toBeLessThanOrEqual(30)
      expect(end - s).toBeLessThanOrEqual(30)
    }
  })
  it('after walking round the corner, the next leg eases in without overshooting', () => {
    const trail = createArrowTrail(THREE, route)
    trail.reset(25)
    expect(trail.windowEnd).toBe(30)
    for (let i = 0; i < 40; i++) {
      trail.update(32, 0.1, i)
      expect(trail.windowEnd).toBeLessThanOrEqual(60 + 1e-6)
    }
    near(trail.windowEnd, 60, 0.5)
    trail.dispose()
  })
  it('fade out, and come back', () => {
    const trail = createArrowTrail(THREE, route)
    trail.setOpacity(0)
    for (let i = 0; i < 40; i++) trail.update(0, 0.1, i)
    expect(trail.opacity).toBeLessThan(0.01)
    expect(trail.lane.material.uniforms.uOpacity.value).toBe(trail.opacity)
    trail.setOpacity(1)
    for (let i = 0; i < 40; i++) trail.update(0, 0.1, i)
    expect(trail.opacity).toBeGreaterThan(0.99)
    trail.dispose()
  })
})
