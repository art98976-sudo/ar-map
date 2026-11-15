import {expect, test} from '@playwright/test'

// Item 4 (round 4): in another language the English name leads, its translation a smaller line under it.
test('Arabic card: "Library" first, "المكتبة" as a smaller line; English shows one line', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('welcomeAR.locale.v1', 'ar') // the first load only
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/#/?to=library')
  const name = page.locator('[data-card] .dest-sheet__name')
  await expect(name).toHaveText('Library', {timeout: 45_000})
  await expect(name.locator('bdi')).toHaveAttribute('lang', 'en')
  const translation = page.locator('[data-card] .dest-sheet__translation')
  await expect(translation).toHaveText('المكتبة')
  await expect(translation).toHaveAttribute('lang', 'ar')
  const [big, small] = await Promise.all([name, translation].map((l) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))))
  expect(small).toBeLessThan(big)
  await expect(page.locator('[data-card] .dest-sheet__meta')).toHaveCount(0) // not shown twice
  await page.screenshot({path: testInfo.outputPath('ar-card.png')})

  await page.evaluate(() => localStorage.setItem('welcomeAR.locale.v1', 'en-GB'))
  await page.reload()
  await expect(name).toHaveText('Library', {timeout: 45_000})
  await expect(translation).toHaveCount(0)
})
