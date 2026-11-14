import {expect, test} from '@playwright/test'

// The phone takes the map's GPU context away: get it back, or offer a reload, never a black map.
const LOSE = () => {
  const canvas = document.querySelector('[data-map] canvas.mapboxgl-canvas, [data-map] canvas')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  window.__lose = gl.getExtension('WEBGL_lose_context')
  window.__lose.loseContext()
}

async function openMap(page) {
  await page.goto('/')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
}

test.describe('map WebGL context loss', () => {
  // Desktop Chrome only: the map is the same on every project, and Chromium has WEBGL_lose_context.
  test.beforeEach(async ({browserName}, testInfo) => test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop-chrome'))

  test('a context that stays lost offers "Tap to reload the map", which brings the map back', async ({page}) => {
    await openMap(page)
    await page.evaluate(LOSE)
    const reload = page.getByRole('button', {name: 'Tap to reload the map'})
    await expect(reload).toBeVisible({timeout: 6_000})
    await expect(reload).toBeFocused()
    await reload.click()
    await expect(reload).toBeHidden({timeout: 45_000})
    await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  })

  test('a context given back quickly needs nothing from the user', async ({page}) => {
    await openMap(page)
    await page.evaluate(LOSE)
    await page.waitForTimeout(500)
    await page.evaluate(() => window.__lose.restoreContext())
    await page.waitForTimeout(3_500)
    await expect(page.getByRole('button', {name: 'Tap to reload the map'})).toHaveCount(0)
  })
})
