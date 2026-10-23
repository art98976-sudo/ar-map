import { expect, test, type Page } from '@playwright/test';

/** Counts the amber route-arrow pixels drawn on the AR canvas. */
const arrowPixels = (page: Page) =>
  page.evaluate(() => {
    const cv = document.querySelector('[aria-label="AR navigation"] canvas') as HTMLCanvasElement | null;
    const g = cv?.getContext('2d');
    if (!cv || !g) return 0;
    const { data } = g.getImageData(0, 0, cv.width, cv.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] > 230 && data[i + 1] > 160 && data[i + 1] < 215 && data[i + 2] < 60) n++;
    return n;
  });

test('opens a route in AR with the camera, draws arrows and arrives', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?tab=navigate&from=building:library&to=room:cottrell-1-101&acc=1');
  await expect(page.getByTestId('route-duration')).toBeVisible();
  await page.getByRole('button', { name: 'View in AR' }).click();

  const ar = page.getByRole('dialog', { name: 'AR navigation' });
  await expect(ar).toBeVisible();
  await expect(ar.getByText('Camera', { exact: true })).toBeVisible();
  // Follows GPS: the test location is on the main walkway, so AR places us along the route.
  await expect(ar.getByTestId('ar-gps')).toHaveText(/GPS ±\d+ m/);
  await expect(ar.getByTestId('ar-instruction')).toHaveText(/\w+/);

  // Walk the simulation a little: the arrows are drawn on the ground ahead.
  await ar.getByRole('button', { name: 'Simulate walk' }).click();
  await expect.poll(() => arrowPixels(page), { timeout: 10_000 }).toBeGreaterThan(20);

  // Jump to the floor change; the simulation takes the lift and carries on to the room.
  await ar.getByRole('button', { name: 'Simulation speed' }).click();
  for (let i = 0; i < 4; i++) await ar.getByRole('button', { name: 'Next step' }).click();
  await expect(ar.getByTestId('ar-arrived')).toHaveText(/You have arrived at Seminar room 1\.01/, { timeout: 40_000 });
  await ar.getByRole('button', { name: 'Done' }).click();
  await expect(ar).toBeHidden();

  expect(errors).toEqual([]);
});

test('the AR tab starts AR for the current route, with a simulated view when there is no camera', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, permissions: [] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // No camera on this device.
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined });
  });
  await page.goto('/?tab=navigate&from=building:library&to=building:pathfoot');
  await expect(page.getByTestId('route-duration')).toBeVisible();
  await page.getByRole('button', { name: 'AR', exact: true }).click();
  await page.getByRole('button', { name: 'Try it with a simulated walk' }).click();

  const ar = page.getByRole('dialog', { name: 'AR navigation' });
  await expect(ar.getByText('Simulated view', { exact: true })).toBeVisible();
  await expect(ar.getByText(/No camera available/)).toBeVisible();
  await expect(ar.getByTestId('ar-gps')).toHaveText(/Simulated walk/);
  await expect.poll(() => arrowPixels(page), { timeout: 10_000 }).toBeGreaterThan(20);
  await ar.getByRole('button', { name: 'Exit AR' }).click();
  await expect(ar).toBeHidden();
  await context.close();
});
