import {expect, test} from '@playwright/test'

// Item 7: the indoor map opened from AR at the entrance says why, and starts on the door's floor.
test('from AR at the entrance: the reason, and the floor of the door', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/indoor?to=mm-1002085033&from=ar&floor=1')
  await expect(page.locator('[data-indoor-why]')).toHaveText('You’re inside: GPS can’t see you here, so the floor plan shows the way, starting on Level 1.', {timeout: 30_000})
  await expect(page.locator('.mm-floor-bar, .mapboxgl-canvas').first()).toBeAttached({timeout: 45_000})
})

test('opened from the place card: no handoff line', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/indoor?to=mm-1002085033')
  await expect(page.locator('[data-indoor-name]')).toHaveText('A3 Lecture Theatre', {timeout: 30_000})
  await expect(page.locator('[data-indoor-why]')).toBeHidden()
})
