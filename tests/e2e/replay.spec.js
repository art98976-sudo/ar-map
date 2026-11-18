import {expect, test} from '@playwright/test'

// Phase 1: ?simulate=1&replay=1 replays a trip through the real trip logic and shows its metrics.
test('the replay viewer runs a synthetic Library → A3 walk and shows the metrics and the frames', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome')
  await page.goto('/?simulate=1&replay=1')
  const viewer = page.getByRole('region', {name: 'Replay a trip'})
  await expect(viewer).toBeVisible({timeout: 30_000})
  await viewer.getByRole('button', {name: 'Synthetic Library → A3'}).click()
  await expect(viewer.locator('[data-rv-metrics]')).toContainText('targets:', {timeout: 60_000})
  await expect(viewer.locator('[data-rv-status]')).toContainText('with ground truth')
  const scrub = viewer.getByRole('slider', {name: 'Frame'})
  await scrub.fill('1500')
  await expect(viewer.locator('[data-rv-frame]')).toContainText('position error')
})
