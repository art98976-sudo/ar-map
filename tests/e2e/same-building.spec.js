import {expect, test} from '@playwright/test'
import {encodeTile, tileOf} from './helpers/mvt.js'

// Items 6-7: from a door to a destination in the same building, the walk stays inside. MazeMap is
// mocked end to end: a building outline around the Cottrell destination, one exterior door in its
// west wall (a floor tile made here), and two answers from the router: from just inside the door a
// longer way that stays indoors, from just outside it a shorter way that goes out and back in.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

const D = {lat: 56.14465, lng: -3.92048} // the Cottrell destination (destinations.json)
const M_LAT = 111_320
const M_LNG = 111_320 * Math.cos((D.lat * Math.PI) / 180)
const ll = (x, y) => [D.lng + x / M_LNG, D.lat + y / M_LAT] // metres east/north of D -> [lng, lat]
const square = [ll(-25, -25), ll(25, -25), ll(25, 25), ll(-25, 25), ll(-25, -25)]
const door = [ll(-25, -0.6), ll(-25, 0.6)]
const tile = tileOf(door[0], 18)
const tileBody = encodeTile({doors: [{id: 7, line: door}], outlines: [{id: 1, polygon: [square]}]}, tile)

/** A MazeMap /routing/path answer: stretches [[z, buildingId|null, [[x, y], ...]], ...]. */
function path(stretches) {
  const features = stretches.map(([z, buildingId, pts]) => ({type: 'Feature', properties: {z, ...(buildingId ? {buildingId} : {})}, geometry: {type: 'LineString', coordinates: pts.map(([x, y]) => ll(x, y))}}))
  return {path: {type: 'FeatureCollection', features}}
}

test('a door start to a place in the same building takes the way that stays inside, not the shorter one outside', async ({page}, testInfo) => {
  test.skip(onlyOn('desktop-chrome')(testInfo))
  await page.route('https://api.mazemap.com/api/buildings/**', (route) =>
    route.fulfill({json: {buildings: [{id: 1, name: 'Test Hall', fullOutline: {type: 'Polygon', coordinates: [square]}, floors: [{z: 1}]}]}}),
  )
  await page.route('https://tiles.mazemap.com/**', (route) => {
    const m = /\/(\d+)\/(\d+)\.mvt/.exec(route.request().url())
    const here = m && Number(m[1]) === tile.x && Number(m[2]) === tile.y
    return here ? route.fulfill({status: 200, contentType: 'application/x-protobuf', body: tileBody}) : route.fulfill({status: 204})
  })
  const asked = []
  await page.route('https://routing.mazemap.com/**', (route) => {
    const q = new URL(route.request().url()).searchParams
    asked.push(q.get('sourcez'))
    // Inside the door (on level 1): round the building's inside, 80 m. Outside it: in, out along the
    // wall, and in again, 40 m: shorter, but it leaves the building.
    const json =
      q.get('sourcez') === '1'
        ? path([[1, 1, [[-24.5, 0], [-20, 15], [20, 15], [0, 0]]]])
        : path([
            [0, null, [[-25.5, 0], [-25.5, 0.2]]],
            [1, 1, [[-24.5, 0.2], [-24.5, 1]]],
            [0, null, [[-25.5, 1], [-25.5, 8]]],
            [1, 1, [[-24.5, 8], [0, 0]]],
          ])
    return route.fulfill({json})
  })
  // GPS: just inside the west wall, good enough to be sure the user is indoors.
  await page.addInitScript(([lng, lat]) => {
    const geo = {
      watchPosition: (ok) => {
        setTimeout(() => ok({coords: {latitude: lat, longitude: lng, accuracy: 8}, timestamp: Date.now()}), 50)
        return 1
      },
      clearWatch: () => {},
      getCurrentPosition: () => {},
    }
    Object.defineProperty(navigator, 'geolocation', {value: geo, configurable: true})
  }, ll(-22, 0))

  await page.goto('/#/locate?to=cottrell&force=1')
  await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
  await expect(page.getByRole('heading', {name: 'Where are you?'})).toBeVisible({timeout: 10_000})
  await page.getByRole('button', {name: /Test Hall, west door/}).click({timeout: 10_000})
  await expect(page).toHaveURL(/#\/ar\?to=cottrell/, {timeout: 20_000})

  expect(new Set(asked)).toEqual(new Set(['1', '0'])) // both ways were planned
  const trip = await page.evaluate(() => JSON.parse(sessionStorage.getItem('welcomeAR.route.v1')))
  // Outdoors is MazeMap's level 0; the destination's entrance at the end carries no level.
  const zs = [...trip.points, ...(trip.indoorPoints ?? []).slice(1)].map((p) => p.z)
  const leaves = zs.some((z, i) => z === 0 && zs.slice(0, i).some((y) => Number.isFinite(y) && y !== 0))
  expect(leaves).toBe(false) // the way that stays inside
  expect(trip.start).toMatchObject({type: 'door', floor: 1})
})
