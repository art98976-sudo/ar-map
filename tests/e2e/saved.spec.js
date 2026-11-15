import {expect, test} from '@playwright/test'

// Item 12: Save a place to "My lectures"; it shows on the home sheet, survives a reload, and can be removed.
test('save a room to My lectures, find it on the home sheet, remove it', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/?to=library')
  const save = page.getByRole('button', {name: 'Save Library'})
  await expect(save).toHaveAttribute('aria-pressed', 'false', {timeout: 45_000})
  await save.focus()
  await page.keyboard.press('Enter')
  const groups = page.getByRole('group', {name: 'Save to'})
  await expect(groups).toBeVisible()
  await expect(groups.getByRole('button', {name: 'My lectures'})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Saved to My lectures')).toBeVisible()
  await expect(save).toHaveAttribute('aria-pressed', 'true')
  await expect(save).toBeFocused()

  await page.goto('/')
  await page.reload()
  // Saved places are one step up from the chips (the top bar's star opens the sheet on them).
  await page.getByRole('button', {name: 'Saved places', exact: true}).click({timeout: 45_000})
  const section = page.getByRole('region', {name: 'My lectures'})
  await expect(section.getByRole('button', {name: 'Library'})).toBeVisible({timeout: 45_000})
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('welcomeAR.saved.v1')).map((s) => [s.group, s.place.id]))).toEqual([['lectures', 'library']])

  await section.getByRole('button', {name: 'Library'}).click()
  await page.getByRole('button', {name: 'Save Library'}).click()
  await expect(page.getByText('Removed from My lectures')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('region', {name: 'My lectures'})).toHaveCount(0)
})
