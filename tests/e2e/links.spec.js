import {expect, test} from '@playwright/test'

// A place link (#/?to=<id>) must open the same card in any tab, on any device.
test.describe('place links', () => {
  test.skip(({browserName}) => browserName !== 'chromium')

  test('a preset id opens its card', async ({page}) => {
    await page.goto('/#/?to=library')
    await expect(page.locator('.dest-sheet__name')).toHaveText('Library', {timeout: 30_000})
  })

  test('a MazeMap room in a fresh tab is looked up and opens its card', async ({page}) => {
    // A fresh context: nothing in session storage, as on another device.
    await page.goto('/#/?to=mm-1002085033')
    await expect(page.locator('.dest-sheet__name')).toHaveText('A3 Lecture Theatre', {timeout: 30_000})
    await expect(page.locator('.dest-sheet__meta')).toContainText('Cottrell Building')
    await expect(page.getByRole('button', {name: 'Walk here in AR'})).toBeVisible()
    expect(page.url()).toContain('to=mm-1002085033')
  })

  test('a room link to the camera screen on a new device lands on that room', async ({page}) => {
    await page.goto('/#/locate?to=mm-1002085033')
    await expect(page.locator('.dest-sheet__name')).toHaveText('A3 Lecture Theatre', {timeout: 30_000})
  })

  test('shows a loading card while it looks the room up', async ({page}) => {
    await page.route('https://api.mazemap.com/api/pois/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.goto('/#/?to=mm-1002085033')
    await expect(page.locator('.dest-sheet__name')).toHaveText('Finding the place…')
    await expect(page.locator('.dest-sheet__name')).toHaveText('A3 Lecture Theatre', {timeout: 30_000})
  })

  test('an unknown id says so and offers search', async ({page}) => {
    await page.goto('/#/?to=mm-999999999999')
    await expect(page.locator('.dest-sheet__name')).toHaveText('We couldn’t find that place', {timeout: 30_000})
    await page.locator('.dest-sheet').getByRole('button', {name: 'Search'}).click()
    await expect(page.getByRole('combobox').first()).toBeVisible()
  })
})
