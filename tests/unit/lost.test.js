import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {lostMessage, nearestPlace} from '../../src/route/lost.js'
import {DESTINATIONS} from '../../src/map/destinations.js'

// Item 8: "I'm lost" names the nearest place the walker can see.
const osm = JSON.parse(readFileSync('src/data/landmarks-osm.json', 'utf8'))
const at = (lat, lng, accuracy = 8) => ({lat, lng, accuracy})

describe("I'm lost", () => {
  it('names the nearest campus place or building within 150 m', () => {
    // Beside the Sports Centre (Gannochy, west of the loch).
    const sports = DESTINATIONS.find((d) => d.id === 'sports-centre')
    expect(nearestPlace(at(sports.lat, sports.lng), {destinations: DESTINATIONS, osm}).name).toBe('Sports Centre')
    // On the walkway outside the Cottrell Building.
    expect(nearestPlace(at(56.14525, -3.9201), {destinations: DESTINATIONS, osm})).toMatchObject({name: expect.stringMatching(/Cottrell|Atrium|Andrew Miller|Library/)})
  })
  it('names nothing when nothing named is within 150 m (or no fix)', () => {
    expect(nearestPlace(at(56.16, -3.95), {destinations: DESTINATIONS, osm})).toBeNull()
    expect(nearestPlace(null, {destinations: DESTINATIONS, osm})).toBeNull()
  })
  it('a building outline counts from its walls, not its middle', () => {
    const square = [[56.145, -3.921], [56.145, -3.919], [56.146, -3.919], [56.146, -3.921]]
    const near = nearestPlace(at(56.1449, -3.92), {osm: {areas: [{name: 'Colin Bell Building', kind: 'building', pts: square}]}})
    expect(near.name).toBe('Colin Bell Building')
    expect(near.distanceM).toBeLessThan(15)
  })
  it('says where, and that a new route is coming; adds a warning for a rough position', () => {
    expect(lostMessage({name: 'Sports Centre', distanceM: 20}, 6)).toBe('You are near the Sports Centre. New route from here.')
    expect(lostMessage({name: 'Airthrey Castle', distanceM: 20}, 80)).toBe('You are near Airthrey Castle. Your position is approximate. New route from here.')
    expect(lostMessage(null, 10)).toBe('There is no named place close by. New route from here.')
  })
})
