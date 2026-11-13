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
