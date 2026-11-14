import {expect, test} from '@playwright/test'

// Go "from my location" with location blocked: ask where the walk starts, never a dead-end error.
test.use({permissions: []}) // location not allowed

test('Go with no location opens "Where are you starting from?"', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/?to=library')
  const go = page.locator('[data-go]')
  await expect(go).toBeVisible({timeout: 45_000})
  await go.click()
  const sheet = page.locator('[data-start-sheet]')
  await expect(sheet).toBeVisible({timeout: 15_000})
  await expect(sheet.locator('[data-start-note]')).toHaveText('We can’t see your location. Choose where you’re starting from.')
  await expect(page.getByText('Could not plan a route')).toHaveCount(0)

  // Choose a start: Go is ready again, and now plans the walk.
  await sheet.getByRole('combobox').fill('cottrell')
  await sheet.getByRole('option', {name: /^Cottrell Building/}).click()
  await expect(sheet).toBeHidden()
  await expect(go).toBeFocused()
})
