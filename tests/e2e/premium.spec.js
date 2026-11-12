import {expect, test} from '@playwright/test'

test.describe('/premium', () => {
  test('draws the realistic map, keeps the credits together at the bottom left, and leaves home as it was', async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome')
    test.setTimeout(90_000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/#/premium?debug=1')
    await page.waitForFunction(() => window.__premiumMap?.loaded(), null, {timeout: 60_000})
    await expect(page.locator('[data-loading]')).toHaveCount(0)
    // 3D buildings from MazeMap's outlines, sky, and the indoor plan only up close.
    await expect
      .poll(() => page.evaluate(() => window.__premiumMap.getStyle().layers.filter((l) => l.id.startsWith('premium-')).map((l) => l.id)), {timeout: 20_000})
      .toEqual(expect.arrayContaining(['premium-buildings', 'premium-sky']))
    expect(await page.evaluate(() => window.__premiumMap.getLayer('mm-rooms')?.minzoom ?? 99)).toBeGreaterThan(17)
    const ratio = await page.evaluate(() => {
      const c = window.__premiumMap.getCanvas()
      return c.width / c.clientWidth
    })
    expect(ratio).toBeLessThanOrEqual(2)
    await expect(page.locator('.p-building-label', {hasText: 'Cottrell Building'})).toBeVisible()
    // Credits: visible, in the bottom-left corner.
    const corner = page.locator('.mapboxgl-ctrl-bottom-left')
    for (const credit of ['.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib-button', '.mazemap-ctrl-logo']) {
      await expect(corner.locator(credit)).toBeVisible()
    }
    expect(errors).toEqual([])

    await page.goto('/#/')
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
    await expect(page.locator('.premium')).toHaveCount(0)
  })
})
