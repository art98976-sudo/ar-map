import {expect, test} from '@playwright/test'

// Item 10: on a wide screen, the QR panel has a muted looping AR demo, fetched only once shown.
// No recording has been supplied yet, so the slot must hide itself and leave the QR panel as it was.
test('desktop: a lazy demo video beside the QR code, gone cleanly while the file is missing', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  const asked = []
  page.on('request', (r) => r.url().includes('/media/demo-ar') && asked.push(new URL(r.url()).pathname))
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto('/#/?to=library')
  const panel = page.locator('[data-card] [data-handoff]')
  await expect(panel).toBeVisible({timeout: 45_000})
  await panel.scrollIntoViewIfNeeded()
  await expect.poll(() => asked.includes('/media/demo-ar.mp4'), {timeout: 10_000}).toBe(true)
  await expect(panel.locator('[data-demo]')).toBeHidden({timeout: 10_000}) // 404: the slot goes
  await expect(panel.getByRole('img', {name: /QR code/})).toBeVisible()
})

test('phone width: no video, nothing downloaded', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  const asked = []
  page.on('request', (r) => r.url().includes('/media/demo-ar.mp4') && asked.push(r.url()))
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('/#/?to=library')
  await expect(page.locator('[data-card] [data-handoff]')).toBeVisible({timeout: 45_000})
  await page.waitForTimeout(2000)
  await expect(page.locator('[data-demo]')).toBeHidden()
  expect(asked).toEqual([])
})
