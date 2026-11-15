import {expect, test} from '@playwright/test'

// The map-first home screen (items 2 to 7 of its plan). Desktop Chrome at a phone's size unless a
// test says otherwise: these are layout and behaviour checks, not engine checks.
const mapReady = (page) => expect(page.locator('[data-overlay]')).toBeHidden({timeout: 45_000})
const view = (page) =>
  page.evaluate(() => {
    const map = window.__homeMap
    const c = map.getCenter()
    return {lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing()}
  })
const phoneOnly = (testInfo) => test.skip(testInfo.project.name !== 'desktop-chrome')

test.describe('item 3: opens at indoor zoom', () => {
  test('first visit: Campus Central at zoom 17.8; next visit: where the student left the map', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.setViewportSize({width: 390, height: 844})
    await page.goto('/#/?debug=1')
    await mapReady(page)
    await expect.poll(async () => (await view(page)).zoom, {timeout: 10_000}).toBeCloseTo(17.8, 1)
    const first = await view(page)
    expect(Math.abs(first.lng - -3.9209)).toBeLessThan(0.002) // Campus Central, give or take the sheet offset
    expect(Math.abs(first.lat - 56.1456)).toBeLessThan(0.002)

    // A drag (a move the student makes) is remembered on this device.
    const box = await page.locator('[data-map]').boundingBox()
    await page.mouse.move(box.x + 200, box.y + 400)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + 330, {steps: 8})
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('welcomeAR.lastView.v1')), {timeout: 5000}).not.toBeNull()
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('welcomeAR.lastView.v1')))
    await page.reload()
    await mapReady(page)
    await expect.poll(async () => (await view(page)).lng, {timeout: 10_000}).toBeCloseTo(saved.lng, 4)
    expect((await view(page)).zoom).toBeCloseTo(saved.zoom, 1)
  })
})
