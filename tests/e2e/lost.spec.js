import {expect, test} from '@playwright/test'

// Item 8: "I'm lost" during a trip: say where the walker is, plan again from there, show them.
const PATHFOOT = {type: 'place', placeId: 'pathfoot', entranceId: 'main', name: 'Pathfoot Building', entranceName: 'Main entrance', lat: 56.148705, lng: -3.926991}
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

test("map trip: I'm lost names the nearest place and plans from where the walker really is", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  // The start says Pathfoot, but the GPS (the test's) is outside the Cottrell Building.
  await page.addInitScript((start) => sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify(start)), PATHFOOT)
  await page.goto('/#/?to=library')
  await expect(page.locator('[data-walk-text]')).toContainText('m', {timeout: 45_000})
  await page.locator('[data-go]').click()
  const lost = page.getByRole('button', {name: /I'm lost/})
  await expect(lost).toBeVisible()
  const before = await page.locator('[data-map-trip-text]').textContent()
  await lost.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^You are near .+\. New route from here\.$/)).toBeVisible({timeout: 30_000})
  await expect(page.locator('[data-map-trip-text]')).not.toHaveText(before) // planned from here: a shorter walk
})

test("AR: I'm lost says where the walker is", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome')
  test.setTimeout(180_000)
  await page.addInitScript(FAKE_REAR_CAMERA)
  await page.goto('/#/locate?to=library&force=1&debug=1')
  await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
  await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 90_000})
  await page.getByRole('button', {name: /I'm lost/}).click()
  await expect(page.getByText(/^(You are near .+\.( Your position is approximate\.)? New route from here\.|There is no named place close by\. New route from here\.)$/)).toBeVisible({timeout: 30_000})
})
