import { expect, test } from '@playwright/test';

// A first visit: nothing saved yet, so the tutorial shows.
test.use({ storageState: { cookies: [], origins: [] } });

test('shows the tutorial on first open only, and again from the AR menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  const tutorial = page.getByRole('dialog', { name: 'Welcome' });
  const title = () => tutorial.locator('section:not([aria-hidden="true"]) h2');
  await expect(title()).toHaveText('Search a place');
  await expect(tutorial.getByRole('button', { name: 'Skip' })).toBeVisible();

  // Swipe left to the next screen, right to go back.
  const box = (await tutorial.boundingBox())!;
  const swipe = async (fromX: number, toX: number) => {
    await page.mouse.move(box.x + fromX, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + toX, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(box.width * 0.8, box.width * 0.2);
  await expect(title()).toHaveText('Switch to AR');
  await swipe(box.width * 0.2, box.width * 0.8);
  await expect(title()).toHaveText('Search a place');

  // Next, then the dots; the last screen has the safety reminder and "Get started".
  await tutorial.getByRole('button', { name: 'Next' }).click();
  await expect(title()).toHaveText('Switch to AR');
  await tutorial.getByRole('button', { name: 'Go to screen 3' }).click();
  await expect(title()).toHaveText('Follow the arrows');
  await expect(tutorial.getByText("Always watch where you're walking.")).toBeVisible();
  await tutorial.getByRole('button', { name: 'Get started' }).click();
  await expect(tutorial).toBeHidden();

  // Seen: not shown again.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search campus' })).toBeVisible();
  await expect(tutorial).toBeHidden();

  // "Show tutorial again" in the AR menu.
  await page.goto('/?tab=ar&from=building:library&to=building:pathfoot');
  await page.getByRole('button', { name: 'Try it with a simulated walk' }).click();
  const ar = page.getByRole('dialog', { name: 'AR navigation' });
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitem', { name: 'Show tutorial again' }).click();
  await expect(title()).toHaveText('Search a place');
  await tutorial.getByRole('button', { name: 'Skip' }).click();
  await expect(tutorial).toBeHidden();
  await expect(ar).toBeVisible();

  expect(errors).toEqual([]);
});
