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
  await expect(ar.getByTestId('ar-instruction')).toHaveText(/\w+/);
  // Walking view: only the instruction, the trip summary and a few small buttons are on screen.
  await expect(ar.getByTestId('ar-summary')).toContainText('Seminar room 1.01');
  await expect(ar.getByRole('button', { name: 'End' })).toBeVisible();
  await expect(ar.getByRole('button', { name: 'Show 2D map' })).toBeVisible();
  await expect(ar.getByTestId('ar-gps')).toBeHidden();
  // Status details live in the menu. Follows GPS: the test location is on the main walkway.
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await expect(ar.getByText('Camera', { exact: true })).toBeVisible();
  await expect(ar.getByTestId('ar-gps')).toHaveText(/GPS ±\d+ m/);
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await expect(ar.getByRole('menu')).toBeHidden();

  // No motion sensors or compass here (and the test position is beside this route): rather than drawing arrows
  // in the wrong place, AR hides them and says why.
  await expect(ar.getByTestId('ar-status')).toHaveText(/Motion sensors are off|No compass reading|from the route/);
  await page.waitForTimeout(500);
  expect(await arrowPixels(page)).toBe(0);

  // Debug overlay: off by default, shows tracking state when switched on.
  await expect(ar.getByTestId('ar-debug')).toBeHidden();
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitemcheckbox', { name: 'Debug overlay' }).click();
  await expect(ar.getByTestId('ar-debug')).toContainText('engine camera overlay');
  await expect(ar.getByTestId('ar-debug')).toContainText('phone height 1.40 m');

  // Ground calibration: tap the ground 2 m ahead (here: low in the screen) → phone height measured.
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitem', { name: 'Calibrate ground' }).click();
  const box = (await ar.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
  await expect(ar.getByText(/Ground calibrated: phone held \d\.\d\d m/)).toBeVisible();
  await expect(ar.getByTestId('ar-debug')).not.toContainText('phone height 1.40 m');
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitemcheckbox', { name: 'Debug overlay' }).click();
  await expect(ar.getByTestId('ar-debug')).toBeHidden();

  // Walk the simulation a little: the arrows are drawn on the ground ahead.
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitemcheckbox', { name: 'Simulate walk' }).click();
  await expect.poll(() => arrowPixels(page), { timeout: 10_000 }).toBeGreaterThan(20);

  // The bottom bar fades after 5 s without a touch, and comes back on a tap.
  const bar = ar.getByTestId('ar-summary').locator('..');
  await expect(bar).toHaveClass(/opacity-30/, { timeout: 8_000 });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
  await expect(bar).not.toHaveClass(/opacity-30/);

  // Jump to the floor change; the simulation takes the lift and carries on to the room.
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await ar.getByRole('menuitem', { name: 'Simulation speed' }).click();
  for (let i = 0; i < 4; i++) await ar.getByRole('menuitem', { name: 'Next step' }).click();
  await ar.getByRole('button', { name: 'AR menu' }).click();
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
  // A short message instead of a permanent panel; it hides by itself.
  await expect(ar.getByText(/No camera available/)).toBeVisible();
  await expect(ar.getByText(/No camera available/)).toBeHidden({ timeout: 6_000 });
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await expect(ar.getByText('Simulated view', { exact: true })).toBeVisible();
  await expect(ar.getByTestId('ar-gps')).toHaveText(/Simulated walk/);
  await ar.getByRole('button', { name: 'AR menu' }).click();
  await expect.poll(() => arrowPixels(page), { timeout: 10_000 }).toBeGreaterThan(20);
  await ar.getByRole('button', { name: 'End' }).click();
  await expect(ar).toBeHidden();
  await context.close();
});

test('far from the route, arrows are hidden instead of floating in the distance', async ({ browser }) => {
  // About 6 km north of campus.
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    geolocation: { latitude: 56.2, longitude: -3.92, accuracy: 10 },
    permissions: ['geolocation', 'camera'],
  });
  const page = await context.newPage();
  await page.goto('/?tab=navigate&from=building:library&to=building:pathfoot');
  await expect(page.getByTestId('route-duration')).toBeVisible();
  await page.getByRole('button', { name: 'View in AR' }).click();
  const ar = page.getByRole('dialog', { name: 'AR navigation' });
  await expect(ar.getByTestId('ar-status')).toHaveText(/You are \d+(\.\d)? k?m from the route/);
  await page.waitForTimeout(500);
  expect(await arrowPixels(page)).toBe(0);
  await context.close();
});
