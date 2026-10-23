import { expect, test } from '@playwright/test';

test('short addresses open the matching tab', async ({ page }) => {
  await page.goto('/ar');
  await expect(page).toHaveURL(/\?tab=ar$/);
  await expect(page.getByRole('heading', { name: 'AR navigation' })).toBeVisible();

  await page.goto('/web');
  await expect(page.getByRole('searchbox', { name: 'Search campus' })).toBeVisible();
});

test('unknown addresses show a helpful page with a way back', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the campus map' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search campus' })).toBeVisible();
});
