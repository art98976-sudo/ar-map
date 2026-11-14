import {expect, test} from '@playwright/test'

// Item 8: scanning a calibration sign opens /c/<id>: the start is set at the sign, then "Where to?".
test('a sign link sets the start at the sign and asks where to go', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/c/cottrell-main')
  await expect(page.getByText('Starting at the Cottrell main entrance sign. Where to?')).toBeVisible({timeout: 30_000})
  await expect(page).toHaveURL(/#\/\?sign=cottrell-main$/)
  const start = await page.evaluate(() => JSON.parse(sessionStorage.getItem('welcomeAR.start.v1')))
  expect(start).toMatchObject({type: 'place', placeId: 'cottrell', markerId: 'cottrell-main', headingDeg: 20})
  // Pick a place: the card's From row names the sign.
  await page.goto('/#/?to=library')
  await expect(page.locator('[data-start-value]')).toHaveText('Cottrell main entrance sign', {timeout: 45_000})
})

test('an unknown sign just opens the map', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/c/nope')
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
})

test('the A5 sign page: the sign, and Print', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/#/qr?marker=pathfoot-main')
  await expect(page.getByRole('heading', {name: 'Sign: Pathfoot main entrance'})).toBeVisible({timeout: 30_000})
  await expect(page.getByRole('img', {name: 'Start AR here: Pathfoot main entrance'})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Print'})).toBeVisible()
  await page.emulateMedia({media: 'print'})
  await expect(page.getByRole('button', {name: 'Print'})).toBeHidden()
})
