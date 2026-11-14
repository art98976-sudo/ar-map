import {expect, test} from '@playwright/test'

// Item 1: Go frames the whole route between the trip bar and the screen edges, at phone portrait,
// phone landscape and desktop sizes. Start: Pathfoot main entrance; destination: the Library.
const PATHFOOT = {type: 'place', placeId: 'pathfoot', entranceId: 'main', name: 'Pathfoot Building', entranceName: 'Main entrance', lat: 56.148705, lng: -3.926991}

for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
  test(`Go frames the route at ${width}x${height}`, async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome')
    await page.setViewportSize({width, height})
    await page.addInitScript((start) => sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start)), PATHFOOT)
    await page.goto('/#/?to=library&debug=1')
    const go = page.locator('[data-go]')
    await expect(go).toBeVisible({timeout: 45_000})
    await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 20_000})
    await go.click()
    await expect(page.locator('[data-map-trip-top]')).toBeVisible()
    await page.waitForTimeout(2500) // the fit animation
    const view = await page.evaluate(() => {
      const map = window.__homeMap
      const line = map.getSource('walking-route')?._data ?? map.getSource('walking-route')?.serialize?.().data
      const coords = line.geometry.coordinates
      const box = map.getContainer().getBoundingClientRect()
      const bar = document.querySelector('[data-map-trip-top]').getBoundingClientRect()
      const panel = document.querySelector('[data-map-trip-bottom]').getBoundingClientRect()
      const pts = coords.map(([lng, lat]) => map.project([lng, lat]))
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      return {zoom: map.getZoom(), minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), w: box.width, h: box.height, barBottom: bar.bottom - box.top, panelTop: panel.top - box.top}
    })
    // All of it on screen, below the bar...
    expect(view.minX).toBeGreaterThanOrEqual(0)
    expect(view.maxX).toBeLessThanOrEqual(view.w)
    expect(view.minY).toBeGreaterThanOrEqual(view.barBottom - 2)
    expect(view.maxY).toBeLessThanOrEqual(view.panelTop + 2) // above the directions panel
    // ...and filling a good part of it: no tiny line in a corner.
    const share = Math.max((view.maxX - view.minX) / view.w, (view.maxY - view.minY) / (view.panelTop - view.barBottom))
    expect(share).toBeGreaterThan(0.5)
    expect(view.zoom).toBeLessThanOrEqual(18)
    await page.screenshot({path: testInfo.outputPath(`trip-${width}x${height}.png`)})
  })
}

test('Go: the next turn, and every step on request, by keyboard too', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript((start) => sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start)), PATHFOOT)
  await page.goto('/#/?to=library')
  const go = page.locator('[data-go]')
  await expect(go).toBeVisible({timeout: 45_000})
  await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 20_000})
  await go.click()
  const panel = page.getByRole('region', {name: 'Directions'})
  await expect(panel.locator('[data-map-trip-banner]')).toHaveText(/^(In [\d.]+ k?m, (turn|bear) (left|right)( at .+)?|In [\d.]+ k?m, arrive at .+)$/)
  const toggle = panel.getByRole('button', {name: 'All steps'})
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const items = panel.locator('[data-map-trip-steps] li')
  expect(await items.count()).toBeGreaterThanOrEqual(2)
  await expect(items.last()).toContainText('Arrive at Library')
  await page.screenshot({path: testInfo.outputPath('steps-open.png')})
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
})
