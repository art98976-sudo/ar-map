import {expect, test} from '@playwright/test'

// Item 5: the map is created only after MazeMap's stylesheet has loaded, so Mapbox never warns
// "This page appears to be missing CSS declarations for Mapbox GL JS". The stylesheet is slowed
// down here on purpose: it now arrives well after the script.
test('no missing-CSS warning, even with a slow stylesheet', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  const warnings = []
  page.on('console', (m) => /missing CSS declarations/i.test(m.text()) && warnings.push(m.text()))
  await page.route('**/mazemap.min.css', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.mapboxgl-map')).position)
  expect(styled).not.toBe('static') // Mapbox's own CSS is in force
  expect(warnings).toEqual([])
})
