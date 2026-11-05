import {expect, test} from '@playwright/test'

// The location step. Chrome can fake GPS positions and accuracy, so most tests run there.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

/** Replace the GPS with one the test controls: window.__emitFix(accuracy) sends a reading. */
const controllableGps = () => {
  const watchers = []
  window.__emitFix = (accuracy) =>
    watchers.forEach((ok) => ok({coords: {latitude: 56.14525, longitude: -3.9201, accuracy}, timestamp: Date.now()}))
  const geo = {
    watchPosition: (ok) => watchers.push(ok),
    clearWatch: () => {},
    getCurrentPosition: () => {},
  }
  Object.defineProperty(navigator, 'geolocation', {value: geo, configurable: true})
}

/** Replace the GPS with one that always fails with the given error code (1, 2 or 3). */
const failingGps = (code) => {
  const geo = {
    watchPosition: (_ok, fail) => {
      setTimeout(() => fail({code, message: 'test'}), 50)
      return 1
    },
    clearWatch: () => {},
    getCurrentPosition: () => {},
  }
  Object.defineProperty(navigator, 'geolocation', {value: geo, configurable: true})
}

test.describe('location step', () => {
  test('the trip goes search → tap a destination → location → camera, with no screen to tap through', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome', 'iphone-safari')(testInfo))
    if (testInfo.project.name === 'iphone-safari') {
      // Desktop WebKit has no camera API; every iPhone does.
      await page.addInitScript(() => {
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, 'mediaDevices', {value: {getUserMedia: () => Promise.reject(new Error('x'))}})
        }
      })
    }
    await page.goto('/')
    await page.getByRole('button', {name: 'Start AR'}).click()
    await page.getByRole('button', {name: 'Library', exact: true}).click()
    // That tap asked for everything. The fix is good (±6 m), so it plans the walk and opens the camera.
    await expect(page).toHaveURL(/#\/ar\?to=library/, {timeout: 30_000})
  })

  test('a direct link shows one small button, then handles "Don\'t Allow"', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    // Pretend the phone has never asked, and that the user then taps "Don't Allow".
    await page.addInitScript(() => {
      const query = navigator.permissions.query.bind(navigator.permissions)
      navigator.permissions.query = (d) => (d?.name === 'geolocation' ? Promise.resolve({state: 'prompt'}) : query(d))
    })
    await page.addInitScript(failingGps, 1)
    await page.goto('/#/locate?to=library&force=1')
    await expect(page.locator('[data-destination]')).toContainText('Library')
    await page.getByRole('button', {name: 'Tap to start'}).click()
    await expect(page.getByRole('heading', {name: 'Location access is off'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'View 2D map instead'})).toBeVisible()
  })

  test('already blocked: goes straight to how to turn location back on', async ({browser}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    // No geolocation permission: headless Chrome reports it as blocked.
    const ctx = await browser.newContext({...testInfo.project.use, permissions: [], geolocation: undefined})
    const page = await ctx.newPage()
    await page.goto('/#/locate?to=library&force=1')
    await expect(page.getByRole('heading', {name: 'Location access is off'})).toBeVisible()
    await expect(page.getByText('Turn on Location.')).toBeVisible()
    await ctx.close()
  })

  test('weak GPS: shows the accuracy and waits, then carries on when it improves', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(controllableGps)
    await page.goto('/#/locate?to=atrium')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-title]')).toHaveText('Finding your location…')
    await page.evaluate(() => window.__emitFix(48))
    await expect(page.getByRole('heading', {name: 'Weak GPS – move into the open'})).toBeVisible()
    await expect(page.getByText('±48 m')).toBeVisible()
    await expect(page.getByText('Needs ±20 m or better')).toBeVisible()
    // Still waiting a moment later: it must not continue on weak GPS.
    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/#\/locate/)
    await page.evaluate(() => window.__emitFix(9))
    await expect(page.getByRole('heading', {name: 'Location found'})).toBeVisible()
    await expect(page).toHaveURL(/#\/ar\?to=atrium/, {timeout: 5000})
  })

  test('indoors: after 30 s of weak GPS it suggests the 2D map', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(controllableGps)
    await page.clock.install()
    await page.goto('/#/locate?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-title]')).toHaveText('Finding your location…')
    await page.evaluate(() => window.__emitFix(65))
    await expect(page.getByRole('heading', {name: 'Weak GPS – move into the open'})).toBeVisible()
    await expect(page.getByText('You may be indoors.')).toBeHidden()
    await page.clock.fastForward(31_000)
    await expect(page.getByText('You may be indoors.')).toBeVisible()
    await page.getByRole('button', {name: 'View 2D map instead'}).click()
    await expect(page).toHaveURL(/#\/map\?to=library/)
  })

  for (const [code, title] of [
    [2, 'Your location is turned off'],
    [3, 'We could not find you'],
  ]) {
    test(`GPS error ${code} shows "${title}" with a retry`, async ({page}, testInfo) => {
      test.skip(onlyOn('desktop-chrome')(testInfo))
      await page.addInitScript(failingGps, code)
      await page.goto('/#/locate?to=library&force=1')
      await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
      await expect(page.getByRole('heading', {name: title})).toBeVisible({timeout: 10_000})
      await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible()
      await expect(page.getByRole('button', {name: 'View 2D map instead'})).toBeVisible()
    })
  }

  test('without a destination it goes back to search', async ({page}) => {
    await page.goto('/#/locate')
    await expect(page.getByRole('heading', {name: 'Where do you want to go?'})).toBeVisible()
  })
})
