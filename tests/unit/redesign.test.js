import {describe, expect, it} from 'vitest'
import data from '../../src/data/destinations.json'
import {categoryLabel, MAP_FILTERS, matchesFilter} from '../../src/map/filters.js'
import {estimateWalkMinutes} from '../../src/route/route.js'
import {prefersReducedMotion, showArrival} from '../../src/ui/components/arrival.js'
import {tripPillText} from '../../src/ui/screens/ar.js'
import {CATEGORY_ICON, icon} from '../../src/ui/icons.js'

const byId = (id) => data.destinations.find((d) => d.id === id)
const ids = (filter) => data.destinations.filter((d) => matchesFilter(d, filter)).map((d) => d.id)

describe('map filters', () => {
  it('shows every place with no chip selected', () => {
    expect(ids(null)).toHaveLength(data.destinations.length)
  })
  it('has exactly the five chips, and every chip finds a place', () => {
    expect(MAP_FILTERS.map((f) => f.label)).toEqual(['Buildings', 'Library', 'Food', 'Bus', 'Sport'])
    for (const f of MAP_FILTERS) expect(ids(f.id).length).toBeGreaterThan(0)
  })
  it('sorts places into the right chips', () => {
    expect(ids('library')).toEqual(['library'])
    expect(ids('bus')).toEqual(['bus-hub'])
    expect(ids('sport')).toEqual(expect.arrayContaining(['sports-centre', 'tennis']))
    expect(ids('food')).toEqual(expect.arrayContaining(['atrium', 'scran', 'the-bite', 'umami']))
    expect(ids('buildings')).toEqual(expect.arrayContaining(['cottrell', 'pathfoot', 'library']))
  })
  it('does not count the loch, the bus hub or a café as a building', () => {
    const buildings = ids('buildings')
    for (const id of ['airthrey-loch', 'bus-hub', 'scran']) expect(buildings).not.toContain(id)
  })
  it('names every category, with a fallback', () => {
    for (const d of data.destinations) expect(categoryLabel(d.category)).not.toBe('Place')
    expect(categoryLabel('nonsense')).toBe('Place')
  })
  it('has an icon for every category and chip', () => {
    for (const d of data.destinations) expect(() => icon(CATEGORY_ICON[d.category])).not.toThrow()
    for (const f of MAP_FILTERS) expect(() => icon(f.icon)).not.toThrow()
  })
})

describe('walking time on the card', () => {
  const walkway = {lat: 56.14525, lng: -3.9201}
  it('estimates from the user to the entrance, allowing for paths not being straight', () => {
    const minutes = estimateWalkMinutes(walkway, byId('pathfoot'))
    expect(minutes).toBeGreaterThanOrEqual(5)
    expect(minutes).toBeLessThanOrEqual(12)
  })
  it('gives nothing before there is a fix, or from off campus', () => {
    expect(estimateWalkMinutes(null, byId('pathfoot'))).toBeNull()
    expect(estimateWalkMinutes({lat: 55.9533, lng: -3.1883}, byId('pathfoot'))).toBeNull()
  })
})

describe('the AR pill', () => {
  it('reads like "Pathfoot · 120 m · 2 min"', () => {
    expect(tripPillText('Pathfoot Building', 120)).toBe('Pathfoot · 120 m · 2 min')
  })
  it('keeps names that are not a building, and never says 0 min', () => {
    expect(tripPillText('Library', 10)).toBe('Library · 10 m · 1 min')
  })
})

describe('arrival', () => {
  it('says you have arrived, with a Done button in focus', () => {
    const host = document.createElement('div')
    document.body.append(host)
    host.hidden = true
    showArrival(host, {name: 'Library', reducedMotion: false})
    expect(host.hidden).toBe(false)
    expect(host.querySelector('h1').textContent).toBe('You’ve arrived')
    expect(host.querySelector('.arrival__place').textContent).toBe('Library')
    expect(document.activeElement).toBe(host.querySelector('[data-action="done"]'))
    expect(host.querySelectorAll('.confetti').length).toBeGreaterThan(0)
    host.remove()
  })
  it('skips the confetti for people who prefer reduced motion', () => {
    const host = document.createElement('div')
    document.body.append(host)
    showArrival(host, {name: 'Library', reducedMotion: true})
    expect(host.querySelector('[data-confetti]')).toBeNull()
    expect(host.querySelector('h1').textContent).toBe('You’ve arrived')
    host.remove()
  })
  it('at a building door for a room inside: "You’re at <entrance>" and continue on the indoor map', () => {
    const host = document.createElement('div')
    document.body.append(host)
    showArrival(host, {name: 'A3 Lecture Theatre', entrance: 'Cottrell entrance', reducedMotion: true})
    expect(host.querySelector('h1').textContent).toBe('You’re at Cottrell entrance')
    expect(host.querySelector('.arrival__place').textContent).toBe('A3 Lecture Theatre is inside')
    expect(document.activeElement).toBe(host.querySelector('[data-action="inside"]'))
    expect(host.querySelector('[data-action="done"]')).toBeNull()
    host.remove()
  })
  it('reads the reduced-motion setting', () => {
    expect(prefersReducedMotion({matchMedia: () => ({matches: true})})).toBe(true)
    expect(prefersReducedMotion({matchMedia: () => ({matches: false})})).toBe(false)
    expect(prefersReducedMotion({})).toBe(false)
  })
})

describe('one status message at a time', () => {
  it('shows only the most urgent, in the brief order', async () => {
    const {statusMessage} = await import('../../src/ui/screens/ar-status.js')
    const ready = {phase: 'ready', directionKnown: true, manual: false, source: 'mazemap'}
    expect(statusMessage({...ready, tracking: 'LIMITED', arrowsShown: false, pointAtFloor: true, positionUncertain: true}).key).toBe('tracking')
    expect(statusMessage({...ready, tracking: 'NORMAL', pointAtFloor: true, positionUncertain: true}).key).toBe('floor')
    expect(statusMessage({...ready, tracking: 'NORMAL', positionUncertain: true, rerouting: true}).text).toBe('Finding your position. Follow the map for now.')
    expect(statusMessage({...ready, tracking: 'NORMAL', rerouting: true, source: 'direct'}).key).toBe('reroute')
    expect(statusMessage({...ready, tracking: 'NORMAL', source: 'direct', compassPoor: true}).text).toBe('Approximate route')
    expect(statusMessage({...ready, tracking: 'NORMAL', compassPoor: true}).key).toBe('compass')
    expect(statusMessage({...ready, tracking: 'NORMAL'})).toBeNull()
    expect(statusMessage({phase: 'await-start', manual: false}).text).toBe('Locating you…')
  })
})
