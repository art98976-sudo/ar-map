import {expect, test} from '@playwright/test'

// Item 13: the language from the menu. The menu, the place card and the trip banner follow it, the
// choice is remembered on this device, and Arabic turns the page right to left.
const PATHFOOT = {type: 'place', placeId: 'pathfoot', entranceId: 'main', name: 'Pathfoot Building', entranceName: 'Main entrance', lat: 56.148705, lng: -3.926991}

test('switch language from the menu: menu, place card and trip banner', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript((start) => sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start)), PATHFOOT)
  await page.goto('/#/?to=library')
  await expect(page.locator('[data-go]')).toBeVisible({timeout: 45_000})
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')

  // By keyboard: the languages are a radio group in the menu, each in its own name.
  await page.locator('[data-action="open-menu"]').click()
  const languages = page.getByRole('group', {name: 'Language'})
  await expect(languages.getByRole('menuitemradio', {name: 'English'})).toHaveAttribute('aria-checked', 'true')
  const spanish = languages.getByRole('menuitemradio', {name: 'Español'})
  await expect(spanish).toHaveAttribute('lang', 'es')
  await spanish.focus()
  await page.keyboard.press('Enter')

  // The screen is drawn again in Spanish; the menu opens on the choice just made.
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  const idioma = page.getByRole('group', {name: 'Idioma'})
  await expect(idioma.getByRole('menuitemradio', {name: 'Español'})).toHaveAttribute('aria-checked', 'true')
  await expect(idioma.getByRole('menuitemradio', {name: 'Español'})).toBeFocused()
  await expect(page.getByRole('menuitem', {name: 'Información y privacidad'})).toBeVisible()
  await expect(page.getByRole('group', {name: 'Tema de color'}).getByRole('menuitemradio', {name: 'Oscuro'})).toBeVisible()
  await page.keyboard.press('Escape')

  // The place card: Spanish words, the place name in English.
  const card = page.getByRole('region', {name: 'Lugar seleccionado'})
  await expect(card.locator('.dest-sheet__name')).toHaveText('Library')
  await expect(card.getByRole('button', {name: 'Compartir Library'})).toBeVisible()
  await expect(card.locator('[data-go]')).toHaveText('Ir')
  await expect(card.locator('[data-walk-text]')).toHaveText(/^\d+ min · \d+ m$/, {timeout: 20_000})

  // The trip banner: Spanish sentence, English place names.
  await card.locator('[data-go]').click()
  const panel = page.getByRole('region', {name: 'Indicaciones'})
  await expect(panel.locator('[data-map-trip-banner]')).toHaveText(/^En [\d,]+ k?m, (gira|llegarás) /, {timeout: 20_000})
  await expect(panel.getByRole('button', {name: 'Todos los pasos'})).toBeVisible()
  await expect(page.locator('[data-map-trip-text]')).toHaveText(/^Library · \d+ m · \d+ min$/)
  await page.screenshot({path: testInfo.outputPath('es-trip.png')})

  // Remembered on this device: a reload opens in Spanish.
  await page.reload()
  await expect(page.locator('[data-go]')).toHaveText('Ir', {timeout: 45_000})
  expect(await page.evaluate(() => localStorage.getItem('welcomeAR.locale.v1'))).toBe('es')
})

test('Arabic: right to left, the menu on the other side, the trip in Arabic', async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'android-chrome') // a phone screen: the iPhone run covers it
  await page.addInitScript((start) => sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start)), PATHFOOT)
  await page.goto('/#/?to=library')
  await expect(page.locator('[data-go]')).toBeVisible({timeout: 45_000})
  const box = async (sel) => page.locator(sel).first().boundingBox()
  const menuLtr = await box('[data-action="open-menu"]')

  await page.locator('[data-action="open-menu"]').click()
  await page.getByRole('menuitemradio', {name: 'العربية'}).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await page.keyboard.press('Escape')

  // The menu button moves to the other side, and nothing scrolls sideways.
  const menuRtl = await box('[data-action="open-menu"]')
  const width = page.viewportSize().width
  expect(menuLtr.x).toBeGreaterThan(width / 2)
  expect(menuRtl.x).toBeLessThan(width / 2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(page.locator('[data-go]')).toHaveText('انطلق')
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  await page.screenshot({path: testInfo.outputPath('ar-card.png')})

  if (testInfo.project.name === 'desktop-chrome') {
    await page.locator('[data-go]').click()
    await expect(page.locator('[data-map-trip-banner]')).toHaveText(/^بعد .+، (انعطف|ستصل)/, {timeout: 20_000})
    await page.screenshot({path: testInfo.outputPath('ar-trip.png')})
  }
})
