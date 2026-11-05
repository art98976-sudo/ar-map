import {expect, test} from '@playwright/test'

// Route planning, the AR guide and the arrows. Chrome only: it can fake GPS and a camera.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

// Chromium's fake camera has no "rear" camera; real phones do. Drop the constraint in tests.
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

test.describe('route and arrows', () => {
  test('plans the walk after the GPS fix and shows it before the camera', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=pathfoot')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    // Pathfoot is roughly 700 m from the walkway: about 9 minutes.
    await expect(page.locator('[data-trip-remaining]')).toContainText(/\d+ m · about \d+ min/, {timeout: 60_000})
  })

  test('not on campus: offers Google Maps walking directions', async ({browser}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    const ctx = await browser.newContext({
      ...testInfo.project.use,
      geolocation: {latitude: 55.9533, longitude: -3.1883, accuracy: 5}, // Edinburgh
    })
    const page = await ctx.newPage()
    await page.goto('/#/locate?to=library&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.getByRole('heading', {name: "You're not on campus yet"})).toBeVisible({timeout: 15_000})
    const link = page.getByRole('link', {name: 'Walking directions in Google Maps'})
    await expect(link).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=56\.\d+,-3\.\d+&travelmode=walking/)
    await expect(page.getByRole('button', {name: 'View 2D map instead'})).toBeVisible()
    await ctx.close()
  })

  test('test mode: the engine runs and arrows are drawn on the route', async ({page}, testInfo) => {
    // Android profile: the 8th Wall engine only opens the camera on phones, not desktop browsers.
    test.skip(onlyOn('android-chrome')(testInfo))
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=cottrell&force=1&debug=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-stat="camera"]')).toHaveText('Working', {timeout: 60_000})
    // The test browser has no compass: test mode (force=1) faces north and places the route.
    await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 30_000})
    // ?debug=1: the live overlay with its minimap.
    await expect(page.locator('[data-minimap]')).toBeVisible()
    await expect(page.locator('[data-live="segment"]')).toHaveText(/^\d+°$/, {timeout: 10_000})
    await expect(page.locator('[data-live="look"]')).toHaveText(/^\d+°$/)
    await page.getByRole('button', {name: 'Show debug panel'}).click()
    const panel = page.getByRole('region', {name: 'Debug panel'})
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-stat="arrows"]')).toHaveText(/^([1-9]\d*) of \d+$/, {timeout: 10_000})
    await expect(panel.locator('[data-stat="gps"]')).toHaveText(/±\d+ m/)
    await expect(panel.locator('[data-stat="remaining"]')).toHaveText(/\d+ m/)
    await expect(panel.locator('[data-stat="source"]')).toHaveText(/mazemap|footpaths|direct/)
    await expect(panel.locator('[data-stat="turn"]')).toHaveText(/none|\d+ m (left|right)/)
    await expect(panel.getByRole('button', {name: 'Recalibrate compass'})).toBeVisible()
    expect(errors).toEqual([])
  })

  test('a phone without a compass is told so, with the 2D map as a way out', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-stat="camera"]')).toHaveText('Working', {timeout: 60_000})
    // Headless Chrome sends no orientation events at all.
    await expect(page.getByRole('heading', {name: 'No compass found'})).toBeVisible({timeout: 15_000})
    await expect(page.locator('[data-guide]').getByRole('button', {name: 'View 2D map instead'})).toBeVisible()
    // Without ?debug=1 nothing of the debug tools shows.
    await expect(page.locator('[data-minimap]')).toHaveCount(0)
    await expect(page.getByRole('button', {name: 'Show debug panel'})).toHaveCount(0)
  })
})
