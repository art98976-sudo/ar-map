// The home map's visible area: the campus framed from our place data, and the padding measured
// from the search bar and the bottom panel (map-viewport.js).
import {describe, expect, it} from 'vitest'
import {campusBounds, paddingFor} from '../../src/map/map-viewport.js'
import {DESTINATIONS} from '../../src/map/destinations.js'
import {isOnCampus} from '../../src/route/route.js'

describe('the campus view', () => {
  it('is every place of ours on campus, widened by the margin, and no town place', () => {
    const onCampus = DESTINATIONS.filter((d) => d.category !== 'town' && isOnCampus(d))
    for (const id of ['pathfoot', 'cottrell', 'campus-central', 'library', 'sports-centre', 'tennis', 'andrew-stewart', 'airthrey-loch']) {
      expect(onCampus.map((d) => d.id), id).toContain(id)
    }
    const [[w, s], [e, n]] = campusBounds(onCampus, {marginM: 60})
    for (const d of onCampus) {
      expect(d.lng).toBeGreaterThan(w)
      expect(d.lng).toBeLessThan(e)
      expect(d.lat).toBeGreaterThan(s)
      expect(d.lat).toBeLessThan(n)
    }
    expect(n).toBeLessThan(56.16) // the station and the castle in town are far south: not in it
    expect(s).toBeGreaterThan(56.13)
  })

  it('has no bounds without data (the caller falls back)', () => {
    expect(campusBounds([])).toBeNull()
    expect(campusBounds([{lat: NaN, lng: 1}])).toBeNull()
  })
})

describe('the map padding', () => {
  it('is the search bar above and the panel below, with the gap', () => {
    expect(paddingFor({height: 812, topBarBottom: 56, panelTop: 656}, 16)).toEqual({top: 72, bottom: 172, left: 16, right: 16})
  })
  it('is only the gap at the bottom when nothing covers it', () => {
    expect(paddingFor({height: 812, topBarBottom: 56, panelTop: null}, 16).bottom).toBe(16)
  })
})
