import {describe, expect, it} from 'vitest'
import {blockerRects, creditsLift} from '../../src/map/label-blockers.js'
import {indoorLabelFilter} from '../../src/map/mazemap.js'

const host = {left: 0, top: 0, right: 400, bottom: 800}

describe('indoor labels on the home map', () => {
  it('shows everything from indoor zoom up, and only outdoor places without stairs or lifts below it', () => {
    const filter = indoorLabelFilter({indoorZoom: 17, outdoorFloorId: 1, stairLiftIcons: [833, 834]})
    expect(filter[0]).toBe('any')
    expect(filter[1]).toEqual(['>=', ['zoom'], 17])
    const [, onGround, notStairs] = filter[2]
    expect(onGround).toEqual(['==', ['get', 'floorId'], 1])
    expect(notStairs).toEqual(['match', ['coalesce', ['get', 'icon'], -1], [833, 834], false, true])
  })
})

describe('logos and credits', () => {
  it('sit just above a sheet or card lying over their corner', () => {
    const card = {left: 0, top: 560, right: 400, bottom: 800}
    expect(creditsLift(host, [card], 'left')).toBe(240)
    expect(creditsLift(host, [card], 'right')).toBe(240)
  })
  it('stay at the bottom when nothing covers their corner', () => {
    const narrow = {left: 120, top: 500, right: 280, bottom: 800} // a centred card on a wide screen
    expect(creditsLift(host, [narrow], 'left', 110)).toBe(0)
    expect(creditsLift(host, [], 'right')).toBe(0)
  })
})

describe('label blockers', () => {
  it('cover each overlay with a little room, the top of each panel, and both screen edges', () => {
    const logo = {left: 6, top: 535, right: 68, bottom: 551}
    const sheet = {left: 0, top: 600, right: 400, bottom: 800}
    const rects = blockerRects(host, {overlays: [logo], panels: [sheet]}, {padPx: 4, edgePx: 16})
    expect(rects).toContainEqual({x: 2, y: 531, w: 70, h: 24})
    expect(rects).toContainEqual({x: 0, y: 596, w: 400, h: 16})
    // The edge strips stop at the sheet: the map ends there.
    expect(rects).toContainEqual({x: -12, y: 0, w: 16, h: 600})
    expect(rects).toContainEqual({x: 396, y: 0, w: 16, h: 600})
  })
  it('skips hidden things (no size)', () => {
    const rects = blockerRects(host, {overlays: [{left: 0, top: 0, right: 0, bottom: 0}], panels: []})
    expect(rects).toHaveLength(2) // the two edge strips only
  })
})
