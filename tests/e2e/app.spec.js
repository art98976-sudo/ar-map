import {expect, test} from '@playwright/test'

// Collect errors so every test also proves "no crashes in the console".
function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|GL Driver/i.test(m.text())) errors.push(m.text())
  })
  return errors
}

const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

// Chromium's fake camera has no "rear" camera, but the engine (correctly) asks for one.
// Real phones have it; in tests, drop the facingMode constraint so the fake feed is used.
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

// Desktop WebKit has no camera API; give it the one every real iPhone has.
const IPHONE_CAMERA_STUB = () => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {getUserMedia: () => Promise.reject(new DOMException('No camera in test', 'NotFoundError'))},
    })
  }
}

test.describe('home', () => {
  test('shows the brand, the actions and how it works', async ({page}) => {
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.getByRole('img', {name: 'University of Stirling'}).first()).toBeVisible()
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Find your way with arrows on the floor.')
    await expect(page.getByRole('button', {name: 'Start AR'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Campus map'})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'How it works'})).toBeVisible()
    expect(errors).toEqual([])
  })

  test('has no horizontal scroll on a phone', async ({page}) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('opens About with the licence notices', async ({page}) => {
    await page.goto('/')
    await page.getByRole('link', {name: 'About and licences'}).click()
    await expect(page.getByRole('heading', {name: 'About Stirling Welcome AR'})).toBeVisible()
    await expect(page.getByText('Niantic Spatial, Inc.', {exact: false})).toBeVisible()
    const licence = await page.request.get('/external/xr/LICENSE')
    expect(licence.ok()).toBe(true)
  })
})

test.describe('device check', () => {
  test('desktop: explains AR is for phones, offers the map and a QR code', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/#/check')
    await expect(page.getByRole('heading', {name: 'AR works on your phone'})).toBeVisible()
    await expect(page.locator('[data-qr]')).toBeVisible()
    await page.getByRole('button', {name: 'View 2D map instead'}).click()
    await expect(page).toHaveURL(/#\/map/)
  })

  test('in-app browser: asks to open Safari', async ({browser}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    const ctx = await browser.newContext({
      ...testInfo.project.use,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0',
    })
    const page = await ctx.newPage()
    await page.goto('/#/check')
    await expect(page.getByRole('heading', {name: 'Open this page in Safari'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Copy link'})).toBeVisible()
    await ctx.close()
  })

  test('iPhone: passes the check and shows the camera primer', async ({page}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    await page.addInitScript(IPHONE_CAMERA_STUB)
    await page.goto('/')
    await page.getByRole('button', {name: 'Start AR'}).click()
    await page.getByRole('button', {name: 'Library'}).click()
    await expect(page.getByRole('heading', {name: 'Allow camera and motion'})).toBeVisible({timeout: 5000})
    await expect(page.locator('[data-destination]')).toContainText('Library')
  })
})

test.describe('AR session', () => {
  test('Android: downloads the engine and shows the live camera with tracking', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    const errors = watchErrors(page)
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/')
    await page.getByRole('button', {name: 'Start AR'}).click()
    await page.getByRole('button', {name: 'Cottrell Building'}).click()
    await page.getByRole('button', {name: 'Allow and start'}).click()
    await expect(page.getByRole('progressbar', {name: 'Loading AR'})).toBeVisible()
    await expect(page.locator('[data-stat="camera"]')).toHaveText('Working', {timeout: 60_000})
    await expect(page.locator('canvas[data-canvas]')).toBeVisible()
    await expect(page.locator('[data-stat="fps"]')).toHaveText(/\d+ fps/, {timeout: 10_000})
    // Exit returns home and releases the camera.
    await page.getByRole('button', {name: 'Exit AR'}).click()
    await expect(page.getByRole('button', {name: 'Start AR'})).toBeVisible()
    expect(errors).toEqual([])
  })

  test('iPhone: motion denied shows Safari steps and a way out', async ({page}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    await page.addInitScript(IPHONE_CAMERA_STUB)
    await page.addInitScript(() => {
      window.DeviceMotionEvent.requestPermission = () => Promise.resolve('denied')
    })
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Allow and start'}).click()
    await expect(page.getByRole('heading', {name: 'Motion access is off'})).toBeVisible()
    await expect(page.getByText('Tap Allow when Safari asks about motion.')).toBeVisible()
    await page.getByRole('button', {name: 'View 2D map instead'}).click()
    await expect(page).toHaveURL(/#\/map/)
  })

  test('Android: camera blocked shows how to turn it back on', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Allow and start'}).click()
    await expect(page.getByRole('heading', {name: 'Camera access is off'})).toBeVisible({timeout: 60_000})
    await expect(page.getByText('Turn on Camera.')).toBeVisible()
  })

  test('engine download failure shows a retry, not a blank screen', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.route('**/external/xr/xr-slam.js', (route) => route.abort('internetdisconnected'))
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Allow and start'}).click()
    await expect(page.getByRole('heading', {name: 'AR could not load'})).toBeVisible({timeout: 30_000})
    await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible()
  })
})

test.describe('campus map', () => {
  test('loads the University MazeMap map full screen', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await page.goto('/#/map')
    await expect(page.getByRole('heading', {name: 'Campus map'})).toBeAttached()
    await expect(page.locator('[data-overlay]')).toBeHidden({timeout: 30_000})
    const height = await page.locator('[data-map]').evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(500)
    await expect(page.locator('.mapboxgl-canvas')).toBeVisible()
  })

  test('shows a friendly error with a retry when MazeMap is unreachable', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.route('https://api.mazemap.com/**', (route) => route.abort('internetdisconnected'))
    await page.goto('/#/map')
    await expect(page.getByRole('heading', {name: 'The map could not load'})).toBeVisible({timeout: 20_000})
    await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible()
    await expect(page.getByRole('link', {name: 'Open the full campus map'})).toHaveAttribute(
      'href',
      'https://stirling-campus-map.vercel.app',
    )
  })
})
