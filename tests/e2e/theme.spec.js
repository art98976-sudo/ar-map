import {expect, test} from '@playwright/test'

// Item 11: dark mode follows the phone, and the menu can set Light or Dark (remembered).
const sheetBg = (page) => page.locator('[data-home-sheet]').evaluate((el) => getComputedStyle(el).backgroundColor)
const dark = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number)
  return r + g + b < 150
}

test('follows the phone, and the menu choice wins and is remembered', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.emulateMedia({colorScheme: 'dark'})
  await page.goto('/#/?to=library')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  expect(dark(await sheetBg(page))).toBe(true) // the phone says dark
  await page.screenshot({path: testInfo.outputPath('dark.png')})

  await page.locator('[data-action="open-menu"]').click()
  const light = page.getByRole('menuitemradio', {name: 'Light'})
  await expect(page.getByRole('menuitemradio', {name: 'Device setting'})).toHaveAttribute('aria-checked', 'true')
  await light.focus()
  await page.keyboard.press('Enter')
  await expect(light).toHaveAttribute('aria-checked', 'true')
  expect(dark(await sheetBg(page))).toBe(false) // Light wins over the phone

  await page.emulateMedia({colorScheme: 'light'})
  await page.reload()
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  await page.locator('[data-action="open-menu"]').click()
  await page.getByRole('menuitemradio', {name: 'Dark'}).click()
  expect(dark(await sheetBg(page))).toBe(true) // Dark wins over a light phone
  await page.reload()
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark') // remembered, set before drawing
  expect(dark(await sheetBg(page))).toBe(true)
})
