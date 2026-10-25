import { expect, test } from '@playwright/test';

/**
 * Phone-sized end-to-end check of the main flow:
 * search a place → see it on the map → get directions from "My location"
 * → step through the route → switch to a step-free route → floor change indoors.
 * The browser's location is set to a point on campus in playwright.config.ts.
 */
test('search, open a place and walk through a route', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: 'Search campus' })).toBeVisible();

  // Search and pick a building
  await page.getByRole('searchbox', { name: 'Search campus' }).fill('library');
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results).toBeVisible();
  await results.getByRole('button', { name: /^Library Building/ }).click();

  // Destination card
  const card = page.getByRole('article', { name: 'Library' });
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/dest=building%3Alibrary/);

  // Save it, and it shows in the Saved tab
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('button', { name: 'Saved' })).toBeVisible();

  // Directions from My location
  await card.getByRole('button', { name: 'Directions' }).click();
  await expect(page.getByTestId('route-from')).toContainText('My location');
  await expect(page.getByTestId('route-to')).toContainText('Library');
  await expect(page.getByTestId('route-duration')).toHaveText(/\d+ min/);
  await expect(page.getByTestId('current-step')).toHaveText(/^Head /);
  await expect(page).toHaveURL(/tab=navigate.*to=building%3Alibrary/);

  // Step through to the end
  const next = page.getByRole('button', { name: 'Next step' });
  while (await next.isEnabled()) await next.click();
  await expect(page.getByTestId('current-step')).toHaveText(/You have arrived at Library/);

  await page.getByRole('button', { name: 'Saved' }).click();
  await expect(page.getByRole('list', { name: 'Saved places' })).toContainText('Library');

  expect(errors).toEqual([]);
});

test('a shared step-free link routes into Cottrell and up by lift', async ({ page }) => {
  await page.goto('/?tab=navigate&from=building:library&to=room:cottrell-1-101&acc=1');
  await expect(page.getByRole('switch', { name: /Step-free route/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('route-duration')).toBeVisible();

  await page.getByRole('button', { name: 'Show all steps' }).click();
  const steps = page.getByRole('list', { name: 'Steps' });
  await expect(steps).toContainText('Take the Cottrell ramp (step-free)');
  await expect(steps).toContainText('Enter Cottrell Building');
  await expect(steps).toContainText('Take the lift to Floor 2');
  await expect(steps).not.toContainText('steps', { ignoreCase: false });

  // Jump to the floor change and switch the map to Floor 2
  await steps.getByRole('button', { name: /Take the lift to Floor 2/ }).click();
  await page.getByRole('button', { name: 'Show Floor 2 on the map' }).click();
  await expect(page.getByRole('group', { name: 'Cottrell floors' }).getByRole('button', { name: 'Floor 2' })).toHaveAttribute('aria-pressed', 'true');
});

test('without location, it asks for a starting point', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, permissions: [] });
  const page = await context.newPage();
  await page.goto('/?tab=navigate&to=building:library');
  await expect(page.getByText(/Choose a starting point/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Choose a starting point' }).click();
  await page.getByRole('searchbox', { name: 'Search for a starting point' }).fill('pathfoot');
  await page.getByRole('button', { name: /^Pathfoot Building/ }).click();
  await expect(page.getByTestId('route-from')).toContainText('Pathfoot Building');
  await expect(page.getByTestId('route-duration')).toBeVisible();
  await context.close();
});
