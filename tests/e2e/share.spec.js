import {expect, test} from '@playwright/test'

// Item 9: Share on the place card: the share sheet with the deep link, or "Link copied".
test('Share uses the share sheet with the place link', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.addInitScript(() => {
    window.__shared = []
    navigator.share = (data) => (window.__shared.push(data), Promise.resolve())
    navigator.canShare = () => true
  })
  await page.goto('/#/?to=library')
  const share = page.getByRole('button', {name: 'Share Library'})
  await expect(share).toBeVisible({timeout: 45_000})
  await share.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([{title: 'Library', text: 'Library, University of Stirling campus', url: 'http://127.0.0.1:4311/#/?to=library'}])
})

test('no share sheet: the link is copied', async ({page, context}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    delete Navigator.prototype.share
    delete Navigator.prototype.canShare
  })
  await page.goto('/#/?to=library')
  await page.getByRole('button', {name: 'Share Library'}).click({timeout: 45_000})
  await expect(page.getByText('Link copied')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4311/#/?to=library')
})
