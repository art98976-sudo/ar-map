import {expect, test} from '@playwright/test'

// Item 1 (round 4): a language change only changes the words. The trip keeps running, the route is
// the same (not planned again), and options such as step-free stay as they were.
const PATHFOOT = {type: 'place', placeId: 'pathfoot', entranceId: 'main', name: 'Pathfoot Building', entranceName: 'Main entrance', lat: 56.148705, lng: -3.926991}
const routePoints = (page) => page.evaluate(() => JSON.stringify(window.__homeMap.getSource('walking-route')?._data?.geometry?.coordinates ?? null))

test('switching to Arabic and back mid-trip keeps the trip and the same route', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  test.setTimeout(150_000)
  let plans = 0
  page.on('console', (m) => /^\[route\] /.test(m.text()) && plans++)
  await page.addInitScript((start) => {
    sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start))
    localStorage.setItem('welcomeAR.stepFree.v1', '1') // step-free on
  }, PATHFOOT)
  await page.goto('/#/?to=library&debug=1')
  await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 45_000})
  await page.locator('[data-go]').click()
  await expect(page.locator('[data-map-trip-top]')).toBeVisible()
  const before = await routePoints(page)
  expect(before).not.toBeNull()
  const plansBefore = plans

  for (const lang of ['ar', 'en-GB']) {
    // The menu bar is tucked away during the map trip: press the language button as the menu would.
    await page.evaluate((id) => document.querySelector(`[data-locale-choice="${id}"]`).click(), lang)
    await expect(page.locator('html')).toHaveAttribute('lang', lang === 'ar' ? 'ar' : 'en-GB')
    await expect(page.locator('[data-map-trip-top]')).toBeVisible({timeout: 45_000}) // still on the trip
    await expect.poll(() => routePoints(page), {timeout: 45_000}).toBe(before) // the very same route
  }
  expect(plans).toBe(plansBefore) // nothing was planned again
  expect(await page.evaluate(() => localStorage.getItem('welcomeAR.stepFree.v1'))).toBe('1')
})
