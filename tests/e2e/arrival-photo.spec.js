import {expect, test} from '@playwright/test'

// Item 10: arriving on a map trip shows which door, with its photo (the placeholder until supplied).
test('arrival names the entrance and shows its photo', async ({page, context}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/?to=cottrell')
  const go = page.locator('[data-go]')
  await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 45_000})
  await go.click()
  await context.setGeolocation({latitude: 56.144904, longitude: -3.920317, accuracy: 5}) // at the Cottrell door
  const figure = page.locator('[data-map-trip-entrance] [data-entrance-photo]')
  await expect(figure).toBeVisible({timeout: 20_000})
  await expect(figure.locator('figcaption')).toHaveText('Cottrell main entrance')
  await expect(figure.locator('img')).toHaveAttribute('alt', /Cottrell main entrance/)
  await expect.poll(() => figure.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true) // the placeholder, as no photo yet
})
