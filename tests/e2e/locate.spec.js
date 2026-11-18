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
  test('a direct link (no tap yet): one screen says what each permission is for, then one tap', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.addInitScript(controllableGps)
    await page.goto('/#/locate?to=library&force=1')
    await expect(page.getByRole('heading', {name: 'Ready when you are'})).toBeVisible({timeout: 15_000})
    await expect(page.getByRole('heading', {name: 'Before we start'})).toHaveCount(0)
    await expect(page.locator('[data-guide] li')).toHaveText([
      'We use your camera to show arrows',
      'We use your location to find the route',
      'We use motion to keep the arrows on the floor',
    ])
  })

  test('a chosen start: the guide says where the walk starts, not that it uses the location', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.addInitScript(() => {
      sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify({type: 'place', placeId: 'library', name: 'Library', entranceName: 'main entrance', lat: 56.14525, lng: -3.9201}))
    })
    await page.goto('/#/locate?to=pathfoot&force=1')
    await expect(page.locator('[data-guide] li').nth(1)).toHaveText('Starting from Library main entrance', {timeout: 15_000})
  })

  test('a screen that arrives later takes focus, so a screen reader hears it', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo)) // the iPhone case is under "motion denied"
    await page.addInitScript(() => {
      navigator.permissions.query = async () => ({state: 'denied', addEventListener() {}, removeEventListener() {}})
    })
    await page.goto('/#/locate?to=library&force=1')
    const heading = page.getByRole('heading', {name: 'Location access is off'})
    await expect(heading).toBeVisible({timeout: 15_000})
    await expect(heading).toBeFocused()
  })

  test('the trip goes map → card → location → camera, with no screen to tap through', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome', 'iphone-safari')(testInfo))
    await page.addInitScript(() => localStorage.setItem('welcomeAR.guideSeen.v1', '1')) // a returning user: the guide was seen
    if (testInfo.project.name === 'iphone-safari') {
      // Desktop WebKit has no camera API; every iPhone does.
      await page.addInitScript(() => {
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, 'mediaDevices', {value: {getUserMedia: () => Promise.reject(new Error('x'))}})
        }
      })
    }
    await page.goto('/#/?to=library')
    await page.getByRole('button', {name: 'Go', exact: true}).click()
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
    await expect(page.getByText('Needs ±15 m or better')).toBeVisible()
    // 18 m (good enough before Phase 1) is still not good enough to start AR.
    await page.evaluate(() => window.__emitFix(18))
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/#\/locate/)
    // Still waiting a moment later: it must not continue on weak GPS.
    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/#\/locate/)
    await page.evaluate(() => window.__emitFix(9))
    await expect(page.getByRole('heading', {name: 'Location found'})).toBeVisible()
    await expect(page).toHaveURL(/#\/ar\?to=atrium/, {timeout: 5000})
  })

  test('weak GPS for 10 s: "Where are you?" with the doors nearby and Choose on map', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(controllableGps)
    await page.clock.install()
    await page.goto('/#/locate?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-title]')).toHaveText('Finding your location…')
    await page.evaluate(() => window.__emitFix(65))
    await expect(page.getByRole('heading', {name: 'Weak GPS – move into the open'})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'Where are you?'})).toHaveCount(0)
    await page.clock.fastForward(11_000)
    await expect(page.getByRole('heading', {name: 'Where are you?'})).toBeVisible()
    await expect(page.getByText('GPS is too weak to line up the arrows.')).toBeVisible()
    await page.getByRole('button', {name: 'Choose on map'}).click()
    await expect(page).toHaveURL(/start=map/)
  })

  test('a good fix inside a building goes straight to "Where are you?"; a door starts the trip there', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    // MazeMap's building list: one building around the test GPS position. Its floors have no tiles
    // here, so the doors offered are our own named entrances nearby (Cottrell main entrance).
    const d = 0.0003
    const ring = [[-3.9201 - d, 56.14525 - d], [-3.9201 + d, 56.14525 - d], [-3.9201 + d, 56.14525 + d], [-3.9201 - d, 56.14525 + d], [-3.9201 - d, 56.14525 - d]]
    await page.route('https://api.mazemap.com/api/buildings/**', (route) =>
      route.fulfill({json: {buildings: [{id: 1, name: 'Test Hall', fullOutline: {type: 'Polygon', coordinates: [ring]}, floors: [{z: 1}]}]}}),
    )
    await page.route('https://tiles.mazemap.com/**', (route) => route.fulfill({status: 204}))
    await page.addInitScript(controllableGps)
    await page.goto('/#/locate?to=library&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await page.evaluate(() => window.__emitFix(8))
    await expect(page.getByRole('heading', {name: 'Where are you?'})).toBeVisible({timeout: 5000})
    await expect(page.getByText('You seem to be inside.')).toBeVisible()
    const doors = page.locator('[data-action="pick-door"]')
    await expect(doors.first()).toBeVisible({timeout: 10_000})
    await expect(doors.first()).toContainText('main entrance')
    await expect(page.getByRole('button', {name: 'Choose on map'})).toBeVisible()
    await doors.first().click()
    await expect(page).toHaveURL(/#\/ar\?to=library/, {timeout: 20_000})
    const start = await page.evaluate(() => JSON.parse(sessionStorage.getItem('welcomeAR.route.v1') || 'null')?.start)
    expect(start).toMatchObject({type: 'door', doorFacing: expect.stringMatching(/inside|outside/)})
    expect(Number.isFinite(start.headingDeg)).toBe(true)
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

  test('without a destination it goes back to the map', async ({page}) => {
    await page.goto('/#/locate')
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
  })
})
