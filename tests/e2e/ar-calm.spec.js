import {expect, test} from '@playwright/test'

// The calm AR screen: one message at a time in a banner under the top bar, nothing over the middle
// of the camera view, one bottom card (the next turn), and the mini-map above it, foldable.
// Android Chrome with a fake camera: the real 8th Wall engine runs, so this is the real screen.
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

test('one message, nothing mid-screen, the next turn at the bottom and the map above it', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'android-chrome')
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(FAKE_REAR_CAMERA)
  await page.goto('/#/locate?to=cottrell&force=1&debug=1')
  await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
  await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 90_000})
  await page.waitForTimeout(1500)
  const {height} = page.viewportSize()

  // Top bar: close, the trip, and "I'm lost" as a labelled icon button.
  const top = await page.locator('.ar__top').boundingBox()
  const lost = page.getByRole('button', {name: /I'm lost/})
  await expect(lost).toBeVisible()
  const lostBox = await lost.boundingBox()
  expect(lostBox.y).toBeLessThan(top.y + top.height)

  // At most one message or suggestion shows, and it sits under the top bar, not mid-screen.
  const shown = page.locator('[data-hints] > :not([hidden])')
  expect(await shown.count()).toBeLessThanOrEqual(1)
  if (await shown.count()) {
    const box = await shown.first().boundingBox()
    expect(box.y + box.height).toBeLessThan(height * 0.3)
  }

  // Nothing the app draws sits over the middle of the camera view (the edge arrow hugs a side).
  const middle = await page.evaluate(() => {
    const band = [window.innerHeight * 0.32, window.innerHeight * 0.6]
    return [...document.querySelectorAll('.ar > *:not(canvas):not(.ar__veil)')]
      .filter((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !el.hidden)
      .filter((el) => !el.matches('[data-live-debug], [data-debug], .debug-toggle, [data-ar-status], [data-tracking-chip]')) // ?debug=1 only
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const column = [window.innerWidth * 0.25, window.innerWidth * 0.75]
        return r.width > 0 && r.height > 0 && r.top < band[1] && r.bottom > band[0] && r.left < column[1] && r.right > column[0] && !el.classList.contains('ar-map')
      })
      .map((el) => el.className || el.tagName)
  })
  expect(middle).toEqual([])

  // The mini-map is never covered by the bottom card, and folds away to its button.
  const map = page.locator('[data-compass-map]')
  await expect(map).toBeVisible()
  const card = page.locator('[data-next-turn], [data-start], [data-outdoors], [data-floor-change], [data-lineup]').filter({visible: true}).first()
  if (await card.count()) {
    const m = await map.boundingBox()
    const c = await card.boundingBox()
    expect(m.y + m.height).toBeLessThanOrEqual(c.y + 1)
  }
  await page.getByRole('button', {name: 'Hide the map'}).click()
  await expect(map).toBeHidden()
  const show = page.getByRole('button', {name: 'Show the map'})
  await expect(show).toHaveAttribute('aria-expanded', 'false')
  await show.focus()
  await page.keyboard.press('Enter')
  await expect(map).toBeVisible()
  await page.screenshot({path: testInfo.outputPath('ar-calm.png')})
  expect(errors).toEqual([])
})
