import {expect, test} from '@playwright/test'

// Item 3: spoken directions. Off by default, a menu switch remembered between visits, and the
// map trip reads each step aloud (speech is captured here, not played).
const CAPTURE_SPEECH = () => {
  window.__spoken = []
  window.speechSynthesis.speak = (u) => window.__spoken.push({text: u.text, lang: u.lang})
  window.speechSynthesis.cancel = () => {}
}

test('the menu switch turns spoken directions on, is remembered, and the trip speaks', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript(CAPTURE_SPEECH)
  await page.goto('/')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  await page.locator('[data-action="open-menu"]').click()
  const item = page.getByRole('menuitemcheckbox', {name: 'Spoken directions'})
  await expect(item).toHaveAttribute('aria-checked', 'false') // off by default
  await item.focus()
  await page.keyboard.press('Enter')
  await expect(item).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => window.__spoken)).toEqual([{text: 'Spoken directions on', lang: 'en-GB'}])

  await page.goto('/#/?to=library')
  await page.reload()
  const go = page.locator('[data-go]')
  await expect(go).toBeVisible({timeout: 45_000})
  await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 20_000})
  await go.click()
  await expect(page.locator('[data-map-trip-banner]')).not.toBeEmpty()
  await expect.poll(() => page.evaluate(() => window.__spoken.map((s) => s.text)), {timeout: 10_000}).toContainEqual(expect.stringMatching(/^(In [\d.]+ k?m, |Turn |Bear |You’ve arrived)/))
  // Ending the trip stops it; the switch is still on after a reload.
  await page.getByRole('button', {name: 'End the trip'}).click()
  await page.reload()
  await expect(page.locator('[data-go]')).toBeVisible({timeout: 45_000})
  await page.locator('[data-action="open-menu"]').click()
  await expect(page.getByRole('menuitemcheckbox', {name: 'Spoken directions'})).toHaveAttribute('aria-checked', 'true')
})

test('no switch where the browser cannot speak', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript(() => {
    delete window.speechSynthesis
    delete window.SpeechSynthesisUtterance
  })
  await page.goto('/')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  await page.locator('[data-action="open-menu"]').click()
  await expect(page.locator('[data-voice]')).toBeHidden()
})
