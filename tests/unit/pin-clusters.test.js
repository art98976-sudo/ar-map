import {describe, expect, it} from 'vitest'
import {clusterPoints, onePerBuilding} from '../../src/map/pin-clusters.js'

describe('home map pins (7.3)', () => {
  it('one pin per building at campus zoom; outdoor places keep theirs', () => {
    const dests = [
      {id: 'atrium', building: 'Andrew Miller Building'},
      {id: 'union', building: 'Andrew Miller Building'},
      {id: 'loch', building: 'Outdoors'},
      {id: 'bus', building: 'Outdoors'},
      {id: 'town'},
    ]
    expect(onePerBuilding(dests)).toEqual(['atrium', 'loch', 'bus', 'town'])
  })

  it('pins that would overlap on screen merge into one numbered cluster', () => {
    const groups = clusterPoints([{id: 'a', x: 100, y: 100}, {id: 'b', x: 120, y: 110}, {id: 'c', x: 300, y: 100}], 40)
    expect(groups.map((g) => g.ids)).toEqual([['a', 'b'], ['c']])
  })

  it('the selected place is never merged away', () => {
    const groups = clusterPoints([{id: 'a', x: 100, y: 100}, {id: 'sel', x: 105, y: 100, keep: true}], 40)
    expect(groups.find((g) => g.ids.includes('sel')).ids).toEqual(['sel'])
  })
})

describe('building names before pins (7.3)', async () => {
  const {blockedPins, labelBox, sizeAtZoom} = await import('../../src/map/pin-clusters.js')
  it('reads the label size from the style stops', () => {
    expect(sizeAtZoom([[13, 10], [16, 12], [17, 14]], 16.5)).toBeCloseTo(13)
    expect(sizeAtZoom([[13, 10], [16, 12]], 20)).toBe(12)
  })
  it('a pin over a name, or under the search bar, is hidden; the selected one never', () => {
    const name = labelBox({x: 200, y: 100, text: 'Cottrell Building'}, 12)
    const bar = {left: 16, right: 374, top: 8, bottom: 56}
    const pins = [
      {id: 'cafe', x: 170, y: 125}, // on the start of "Cottrell Building"
      {id: 'far', x: 200, y: 300},
      {id: 'hall', x: 22, y: 18}, // behind the left end of the search bar
      {id: 'chosen', x: 200, y: 125, keep: true},
    ]
    expect([...blockedPins(pins, [name, bar], 18)].sort()).toEqual(['cafe', 'hall'])
  })
})

describe('one trip distance', async () => {
  const {indoorRestM, tripLengthM} = await import('../../src/route/route.js')
  it('the card, the location screen and AR all show the whole walk to the room', () => {
    const route = {lengthM: 63, totalM: 108}
    expect(tripLengthM(route)).toBe(108)
    expect(tripLengthM({lengthM: 420})).toBe(420)
    // AR ends at the door: its pill adds the indoor part, so at the start it says 108 m too.
    expect(63 + indoorRestM(route, false)).toBe(108)
    expect(indoorRestM(route, true)).toBe(0) // indoor AR walks it all
  })
})
