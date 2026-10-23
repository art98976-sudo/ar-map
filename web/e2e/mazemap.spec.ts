import { expect, test } from '@playwright/test';

/**
 * The real University campus map (MazeMap, campus 2058) on a phone-sized screen.
 * Runs with E2E_PROVIDER=mazemap (or against a deployment that uses MazeMap):
 *   E2E_PROVIDER=mazemap npx playwright test
 * Uses MazeMap's live services, so it needs an internet connection.
 */
test('search the real campus, open a place, route to it and switch floors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByText('University campus map by MazeMap', { exact: false }).first()).toBeVisible();
  // MazeMap's floor control lists the campus floors.
  const floors = page.getByRole('group', { name: 'Campus floors' });
  await expect(floors).toBeVisible({ timeout: 30_000 });

  await page.getByRole('searchbox', { name: 'Search campus' }).fill('library');
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('button', { name: /^Library/ }).first()).toBeVisible();
  await results.getByRole('button', { name: /^Library/ }).first().click();
  await expect(page.getByRole('article', { name: /Library/ })).toBeVisible();

  await page.getByRole('button', { name: 'Directions' }).click();
  await expect(page.getByTestId('route-duration')).toHaveText(/\d+ min/, { timeout: 30_000 });
  await expect(page.getByText('University campus map route')).toBeVisible();

  // Switching floors from the app's control changes MazeMap's floor.
  await page.getByRole('button', { name: 'Map' }).click();
  await floors.getByRole('button', { name: 'Floor 2' }).click();
  await expect(floors.getByRole('button', { name: 'Floor 2' })).toHaveAttribute('aria-pressed', 'true');

  expect(errors).toEqual([]);
});
