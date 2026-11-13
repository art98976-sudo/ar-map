import {expect, test} from '@playwright/test'

// MazeMap's own icon timer can fire just after its map is removed. Nothing visible breaks.
const MAZEMAP_TEARDOWN = /getOwnSource|getOwnLayer|mm-tiles|Script error/

// Collect errors so every test also proves "no crashes in the console".
function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => {
    if (!MAZEMAP_TEARDOWN.test(e.message)) errors.push(e.message)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|GL Driver/i.test(m.text()) && !MAZEMAP_TEARDOWN.test(m.text())) errors.push(m.text())
  })
  return errors
}

const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)
const CHROME = ['desktop-chrome', 'android-chrome']

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

const mapReady = (page) => expect(page.locator('[data-overlay]')).toBeHidden({timeout: 30_000})
const tapPin = (page, id) => page.locator(`[data-pin="${id}"]`).dispatchEvent('click')

test.describe('the map home', () => {
  test('is the University map, with search, chips and pins', async ({page}, testInfo) => {
    test.skip(onlyOn(...CHROME)(testInfo))
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', {name: 'Campus map'})).toBeAttached()
    await mapReady(page)
    const height = await page.locator('[data-map]').evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(500)
    await expect(page.locator('.mapboxgl-canvas')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
    // The quick chips: in the sheet, scrolled sideways.
    for (const id of ['lecture', 'toilets', 'food', 'library', 'study', 'lifts', 'buildings', 'bus', 'sport']) {
      await expect(page.locator(`.quick-chips [data-filter="${id}"]`)).toBeAttached()
    }
    // Group C: four chips at rest, the rest behind More.
    for (const name of ['Lecture theatres', 'Toilets', 'Food', 'Library', 'More']) {
      await expect(page.locator('.quick-chips').getByRole('button', {name, exact: true})).toBeVisible()
    }
    await expect(page.locator('.quick-chips').getByRole('button', {name: 'Bus', exact: true})).toBeHidden()
    // The top: the search bar and one menu button. The right: only my location. 3D is in the menu.
    await expect(page.locator('.map-home__top > button')).toHaveCount(2)
    await expect(page.locator('[data-rail] button')).toHaveCount(1)
    await expect(page.locator('[data-rail]').getByRole('button', {name: 'Show my location'})).toBeVisible()
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    await expect(page.getByRole('menuitem', {name: 'Show 3D buildings'})).toBeVisible()
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    // At rest the sheet offers the nearest toilet, café and lift.
    for (const name of ['Nearest toilet', 'Nearest café', 'Nearest lift']) await expect(page.getByRole('button', {name})).toBeVisible()
    await expect(page.locator('.map-pin')).toHaveCount(24)
    await expect(page.getByRole('button', {name: 'Pathfoot Building'})).toBeAttached()
    expect(errors).toEqual([])
  })

  test('the old hero, how-it-works list and privacy block are gone', async ({page}) => {
    await page.goto('/')
    await expect(page.getByRole('heading', {name: 'How it works'})).toHaveCount(0)
    await expect(page.getByText('Find your way with arrows on the ground.')).toHaveCount(0)
    await expect(page.getByRole('button', {name: 'Start AR'})).toHaveCount(0)
  })

  test('chips filter the pins, and tapping again shows them all', async ({page}, testInfo) => {
    test.skip(onlyOn(...CHROME)(testInfo))
    await page.goto('/')
    await mapReady(page)
    const chips = page.locator('.quick-chips')
    await chips.getByRole('button', {name: 'More', exact: true}).click() // Bus is behind More
    const bus = chips.getByRole('button', {name: 'Bus', exact: true})
    await bus.click()
    await expect(bus).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.map-pin:not([hidden])')).toHaveCount(1)
    await expect(page.locator('[data-pin="bus-hub"]')).toBeVisible()
    // ...and the sheet rises to list them.
    await expect(page.locator('[data-home-sheet]')).toHaveAttribute('data-height', 'half')
    await expect(page.locator('[data-chip-results] .place-row')).toHaveCount(1)
    await chips.getByRole('button', {name: 'Food', exact: true}).click()
    // Shown by the filter; close food places may share one numbered cluster (7.3).
    await expect(page.locator('[data-pin="scran"]:not([hidden])')).toHaveCount(1)
    await expect(page.locator('.map-pin, .map-cluster').filter({visible: true}).first()).toBeVisible()
    await expect(page.locator('[data-pin="bus-hub"]')).toBeHidden()
    await chips.getByRole('button', {name: 'Food', exact: true}).click()
    await expect(page.locator('.map-pin:not([hidden])')).toHaveCount(24)
    await expect(page.locator('[data-home-sheet]')).toHaveAttribute('data-height', 'peek')
  })

  test('Toilets lists toilets from the campus model, and a row opens its place card', async ({page}, testInfo) => {
    test.skip(onlyOn(...CHROME)(testInfo))
    await page.goto('/')
    await mapReady(page)
    await page.locator('.quick-chips').getByRole('button', {name: 'Toilets', exact: true}).click()
    const rows = page.locator('[data-chip-results] .place-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(5)
    // The test phone is on campus, so each row says how far away it is.
    await expect(rows.first()).toContainText(/\d+ (m|km)/)
    await rows.first().click()
    await expect(page.locator('.dest-sheet__name')).toHaveText(/Toilet/)
    await expect(page.locator('[data-home-sheet]')).toBeHidden()
  })

  test('the ⓘ button opens about, privacy, the disclaimer and licences', async ({page}) => {
    await page.goto('/')
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    await page.getByRole('menuitem', {name: 'About and privacy'}).click()
    const sheet = page.getByRole('dialog', {name: /About Stirling Welcome AR/})
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', {name: 'Privacy'})).toBeVisible()
    await expect(sheet.locator('[data-disclaimer]')).toContainText('Student prototype')
    await expect(sheet.getByText('Niantic Spatial, Inc.', {exact: false})).toBeVisible()
    const licence = await page.request.get('/external/xr/LICENSE')
    expect(licence.ok()).toBe(true)
    await sheet.getByRole('button', {name: 'Close about'}).click()
    await expect(sheet).toBeHidden()
  })

  test('shows a friendly error with a retry when MazeMap is unreachable', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.route('https://api.mazemap.com/**', (route) => route.abort('internetdisconnected'))
    await page.goto('/')
    await expect(page.getByRole('heading', {name: 'The map could not load'})).toBeVisible({timeout: 20_000})
    await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible()
    await expect(page.getByRole('link', {name: 'Open the full campus map'})).toHaveAttribute(
      'href',
      'https://stirling-campus-map.vercel.app',
    )
  })

  test('old addresses land on the map', async ({page}) => {
    for (const old of ['/#/check', '/#/search', '/#/map', '/#/about']) {
      await page.goto(old)
      await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
    }
  })
})

test.describe('at 360 px wide', () => {
  test.use({viewport: {width: 360, height: 700}})

  const tooSmall = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('button, a.btn')]
        .filter((el) => {
          if (el.closest('.mm-floor-bar, .mapboxgl-ctrl-attrib')) return false // MazeMap's own
          const r = el.getBoundingClientRect()
          // Rounded: a sheet sliding in can make a 44 px height read as 43.99.
          return r.width > 0 && (Math.round(r.height) < 44 || Math.round(r.width) < 44)
        })
        .map((el) => el.getAttribute('aria-label') || el.textContent.trim()),
    )
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

  test('every screen fits, and every button is at least 44 px', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.goto('/')
    await mapReady(page)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await tooSmall(page)).toEqual([])

    await tapPin(page, 'pathfoot')
    await expect(page.locator('[data-ar-choice]')).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await tooSmall(page)).toEqual([])
    await page.getByRole('button', {name: 'Close', exact: true}).click()

    await page.getByRole('button', {name: 'Search rooms, buildings, places'}).click()
    await expect(page.getByRole('combobox')).toBeFocused()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await tooSmall(page)).toEqual([])
    await page.getByRole('button', {name: 'Close search'}).click()

    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    expect(await tooSmall(page)).toEqual([])
    await page.getByRole('menuitem', {name: 'About and privacy'}).click()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await tooSmall(page)).toEqual([])
  })
})

test.describe('the destination card', () => {
  test('tapping a pin shows the place, one main button and a route link', async ({page}, testInfo) => {
    test.skip(onlyOn(...CHROME)(testInfo))
    await page.goto('/')
    await mapReady(page)
    await tapPin(page, 'pathfoot')
    const card = page.locator('[data-card]')
    await expect(card.getByRole('heading', {name: 'Pathfoot Building'})).toBeVisible()
    await expect(card).toContainText('Academic building')
    await expect(card.locator('[data-ar-choice]')).toBeVisible()
    await expect(card.getByRole('button', {name: 'Show route on map'})).toHaveCount(0) // one button: Go
    await expect(page.locator('[data-pin="pathfoot"]')).toHaveClass(/is-selected/)
  })

  test('says "On campus" before GPS, and a walking time once GPS is allowed', async ({browser, page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/')
    await mapReady(page)
    await tapPin(page, 'pathfoot')
    // Time and distance together: "3 min · 240 m".
    await expect(page.locator('[data-walk-text]')).toHaveText(/^\d+ min · \d+(\.\d)? k?m$/, {timeout: 10_000})

    const noGps = await browser.newContext({...testInfo.project.use, permissions: [], geolocation: undefined})
    const other = await noGps.newPage()
    await other.goto('/')
    await mapReady(other)
    await tapPin(other, 'pathfoot')
    await expect(other.locator('[data-walk-text]')).toHaveText('On campus')
    await noGps.close()
  })

  test('the route is drawn behind the card as soon as it opens, and goes with it', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/#/?debug=1')
    await mapReady(page)
    await tapPin(page, 'pathfoot')
    const drawn = () => page.evaluate(() => Boolean(window.__homeMap?.getLayer('walking-route')))
    await expect.poll(drawn, {timeout: 30_000}).toBe(true)
    await page.getByRole('button', {name: 'Close', exact: true}).click()
    await expect.poll(drawn).toBe(false)
  })

  test('From my location · Options folds the start, swap and step-free into one line', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/#/?to=library')
    const options = page.getByRole('button', {name: /From .* · Options/})
    await expect(options).toBeVisible({timeout: 30_000})
    await expect(page.getByRole('switch', {name: 'Step-free route'})).toBeHidden()
    await options.click()
    await expect(options).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('switch', {name: 'Step-free route'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Swap start and destination'})).toBeVisible()
  })

  test('#/?to= opens with that place selected', async ({page}) => {
    await page.goto('/#/?to=sports-centre')
    await expect(page.locator('[data-card]').getByRole('heading', {name: 'Sports Centre'})).toBeVisible()
  })

  test('Go goes straight on, with no permission screen', async ({page}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    await page.addInitScript(() => localStorage.setItem('welcomeAR.guideSeen.v1', '1')) // a returning user: the guide was seen
    await page.addInitScript(IPHONE_CAMERA_STUB)
    await page.goto('/#/?to=library')
    await page.getByRole('button', {name: 'Go', exact: true}).click()
    await expect(page).toHaveURL(/#\/(locate|ar)\?to=library/, {timeout: 5000})
    await expect(page.getByRole('button', {name: 'Tap to start'})).toHaveCount(0)
  })

  test('asks for motion, camera and location inside the tap', async ({page}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    await page.addInitScript(() => localStorage.setItem('welcomeAR.guideSeen.v1', '1')) // a returning user: the guide was seen
    await page.addInitScript(IPHONE_CAMERA_STUB)
    await page.addInitScript(() => {
      window.__asked = []
      window.DeviceMotionEvent.requestPermission = () => {
        window.__asked.push('motion')
        return Promise.resolve('granted')
      }
      const watch = navigator.geolocation.watchPosition.bind(navigator.geolocation)
      navigator.geolocation.watchPosition = (...args) => {
        window.__asked.push('location')
        return watch(...args)
      }
      const camera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = (c) => {
        window.__asked.push('camera')
        return camera(c)
      }
    })
    await page.goto('/#/?to=library')
    // Asked in one go: the order is fixed, and nothing else ran between them.
    const asked = await page.evaluate(() => {
      window.__asked.length = 0
      document.querySelector('[data-action="walk"]').click()
      return [...window.__asked]
    })
    expect(asked).toEqual(['motion', 'camera', 'location'])
  })
})

test.describe('phones and browsers that cannot run AR', () => {
  test('desktop: explains AR is for phones and offers the map', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    // 8.4: found before any AR button shows. The card says why, and offers the route on the map.
    await page.goto('/#/?to=library')
    const card = page.locator('[data-card]')
    // Group A: the same Go button, no error. Here it starts the trip on the map.
    const go = card.getByRole('button', {name: 'Go', exact: true})
    await expect(go).toHaveAttribute('data-action', 'map-trip', {timeout: 15_000})
    await go.click()
    await expect(page.locator('[data-map-trip-text]')).toHaveText(/^Library · \d+ m · \d+ min$/, {timeout: 30_000})
    await page.getByRole('button', {name: 'End the trip'}).click()
    await expect(card.getByRole('heading', {name: 'Library'})).toBeVisible()
    // A link straight to the camera still explains, with a copy link and the map.
    await page.goto('/#/locate?to=library')
    await expect(page.getByRole('heading', {name: 'AR works on your phone'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Copy link'})).toBeVisible()
  })

  test('in-app browser: asks to open Safari', async ({browser}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    const ctx = await browser.newContext({
      ...testInfo.project.use,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0',
    })
    const page = await ctx.newPage()
    await page.goto('/#/locate?to=library')
    await expect(page.getByRole('heading', {name: 'Open this page in Safari'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Copy link'})).toBeVisible()
    await ctx.close()
  })
})

test.describe('AR session', () => {
  test('Android: from a pin to the live camera, showing only exit, the pill and the map', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(() => localStorage.setItem('welcomeAR.guideSeen.v1', '1')) // a returning user: the guide was seen
    const errors = watchErrors(page)
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/')
    await mapReady(page)
    await tapPin(page, 'cottrell')
    await page.getByRole('button', {name: 'Go', exact: true}).click()
    // The engine was fetched while the card was showing, so there may be no loading screen at all.
    await expect(page.locator('canvas[data-canvas]')).toBeVisible({timeout: 60_000})
    await expect(page.locator('[data-veil]')).toHaveClass(/is-hidden/, {timeout: 60_000})
    await expect(page.locator('[data-trip-pill]')).toHaveText(/^Cottrell · \d+ m · \d+ min$/)
    // Nothing else without ?debug=1.
    await expect(page.locator('[data-tracking-chip]')).toHaveCount(0)
    await expect(page.locator('[data-debug]')).toHaveCount(0)
    await expect(page.locator('[data-compass-map]')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Show debug panel'})).toHaveCount(0)
    // Exit returns to the map and releases the camera.
    await page.getByRole('button', {name: 'Exit AR'}).click()
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
    expect(errors).toEqual([])
  })

  test('at the entrance: "You\'ve arrived", and Done goes back to the map', async ({page, context}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(FAKE_REAR_CAMERA)
    // Standing at the Cottrell entrance. Test mode faces north and places the route.
    await context.setGeolocation({latitude: 56.144904, longitude: -3.920317, accuracy: 5})
    await page.goto('/#/locate?to=cottrell&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.getByRole('heading', {name: 'You’ve arrived'})).toBeVisible({timeout: 90_000})
    await page.getByRole('button', {name: 'Done'}).click()
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
  })

  test('iPhone: motion denied shows Safari steps and a way out', async ({page}, testInfo) => {
    test.skip(onlyOn('iphone-safari')(testInfo))
    await page.addInitScript(IPHONE_CAMERA_STUB)
    await page.addInitScript(() => {
      window.DeviceMotionEvent.requestPermission = () => Promise.resolve('denied')
    })
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click()
    await expect(page.getByRole('heading', {name: 'Motion access is off'})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'Motion access is off'})).toBeFocused()
    await expect(page.getByText('Tap Allow when Safari asks about motion.')).toBeVisible()
    await page.getByRole('button', {name: 'View 2D map instead'}).click()
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
  })

  test('Android: camera blocked shows how to turn it back on', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click()
    await expect(page.getByRole('heading', {name: 'Camera access is off'})).toBeVisible({timeout: 60_000})
    await expect(page.getByText('Turn on Camera.')).toBeVisible()
  })

  test('engine download failure shows a retry, not a blank screen', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.route('**/external/xr/xr-slam.js', (route) => route.abort('internetdisconnected'))
    await page.goto('/#/ar?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click()
    await expect(page.getByRole('heading', {name: 'AR could not load'})).toBeVisible({timeout: 30_000})
    await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible()
  })
})

test.describe('3D buildings', () => {
  test('3D loads the campus model on demand, colours the chosen room, and 2D hides it', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    test.setTimeout(150_000)
    const errors = watchErrors(page)
    const glb = []
    page.on('request', (r) => r.url().endsWith('/data/stirling_campus.glb') && glb.push(r.url()))
    await page.goto('/#/?to=scran&debug=1')
    await mapReady(page)
    expect(glb).toHaveLength(0) // not downloaded until 3D is turned on
    // Group C: 3D is in the menu.
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    const button = page.getByRole('menuitem', {name: 'Show 3D buildings'})
    await button.click()
    const hide = page.getByRole('menuitem', {name: 'Hide 3D buildings'})
    await expect(hide).toHaveAttribute('aria-pressed', 'true')
    await expect(hide).toContainText('2D', {timeout: 90_000})
    await expect(hide).not.toHaveAttribute('aria-busy')
    expect(glb).toHaveLength(1)
    // Scran (Andrew Miller, level 2): its room is coloured, and the map moves to its floor.
    await expect.poll(() => page.evaluate(() => window.__campusModel?.stats()), {timeout: 10_000}).toMatchObject({visible: true, highlighted: '1002096756', level: 2})
    await page.getByRole('button', {name: 'Close', exact: true}).click()
    await expect.poll(() => page.evaluate(() => window.__campusModel.stats().highlighted)).toBeNull()
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    await hide.click()
    await expect(page.getByRole('menuitem', {name: 'Show 3D buildings'})).toContainText('3D')
    expect(await page.evaluate(() => window.__campusModel.stats().visible)).toBe(false)
    expect(glb).toHaveLength(1)
    expect(errors).toEqual([])
  })
})

test.describe('arrow test mode', () => {
  test('?simulate=1 walks a fake user along the route, the arrow turns, and the slider pushes them off it', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    test.setTimeout(150_000)
    const errors = watchErrors(page)
    await page.goto('/#/?to=pathfoot&simulate=1')
    await mapReady(page)
    const panel = page.getByRole('region', {name: 'Arrow test mode'})
    await expect(panel.locator('[data-sim-status]')).toHaveText(/route, \d+ m/, {timeout: 60_000})
    const readout = panel.locator('[data-sim-readout]')
    const arrow = async () => Number((await readout.textContent()).match(/arrow (\d+)°/)?.[1])
    await expect(readout).toHaveText(/Walked \d+ of \d+ m/)
    await panel.getByRole('button', {name: 'Walking speed'}).click() // 4x
    const bearings = new Set()
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000)
      bearings.add(Math.round((await arrow()) / 10))
    }
    expect(bearings.size).toBeGreaterThan(2) // it turned at the corners
    await panel.getByRole('button', {name: 'Restart'}).click()
    await panel.getByLabel('Off the route').fill('15')
    await expect(panel.locator('[data-sim-offset-label]')).toHaveText('15 m')
    const off = async () => Number((await readout.textContent()).match(/([\d.]+) m off the route/)?.[1])
    await expect.poll(off).toBeGreaterThan(2) // off the line, so the arrow aims back on to it
    // Closing the place ends the test mode, and the address keeps it for the next place.
    await page.getByRole('button', {name: 'Close', exact: true}).click()
    await expect(panel).toHaveCount(0)
    expect(page.url()).toContain('simulate=1')
    expect(errors).toEqual([])
  })

  test('?simulate=1 sets off "Finding your position" (GPS and compass) and "Finding a new route" (at most once in 15 s)', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    test.setTimeout(180_000)
    const errors = watchErrors(page)
    await page.goto('/#/?to=pathfoot&simulate=1')
    await mapReady(page)
    const panel = page.getByRole('region', {name: 'Arrow test mode'})
    await expect(panel.locator('[data-sim-status]')).toHaveText(/route, \d+ m/, {timeout: 60_000})
    const banner = panel.locator('[data-sim-banner]')
    const readout = panel.locator('[data-sim-readout]')
    await panel.getByRole('button', {name: 'Pause'}).click()

    // 1. GPS worse than 20 m for 3 s: the arrow hides and the map takes over; 3 s of good GPS brings it back.
    await panel.getByLabel('GPS accuracy').fill('35')
    await page.waitForTimeout(2000)
    await expect(banner).toBeHidden()
    await expect(banner).toHaveText('Finding your position. Follow the map for now.', {timeout: 3000})
    await expect(readout).toContainText('arrow hidden')
    await panel.getByLabel('GPS accuracy').fill('6')
    await page.waitForTimeout(2000)
    await expect(banner).toBeVisible()
    await expect(banner).toBeHidden({timeout: 3000})
    await expect(readout).toContainText(/arrow \d+°/)

    // ...and the compass swinging while the phone holds still.
    await panel.getByRole('button', {name: 'Compass swinging'}).click()
    await expect(banner).toHaveText('Finding your position. Follow the map for now.', {timeout: 7000})
    await panel.getByRole('button', {name: 'Compass swinging'}).click()
    await expect(banner).toBeHidden({timeout: 7000})

    // 2. More than 15 m off for 5 s: plans a new route; not again within 15 s.
    await panel.getByLabel('Off the route').fill('22')
    await page.waitForTimeout(3500)
    await expect(panel.locator('[data-sim-status]')).not.toContainText('new routes')
    await expect(panel.locator('[data-sim-status]')).toContainText('new routes: 1', {timeout: 8000})
    await expect(readout).toContainText(/next new route in \d+ s/)
    await page.waitForTimeout(9000) // 5 s off again, but within 15 s of the last
    await expect(panel.locator('[data-sim-status]')).toContainText('new routes: 1')
    await expect(panel.locator('[data-sim-status]')).toContainText('new routes: 2', {timeout: 12_000})
    expect(errors).toEqual([])
  })

  test('?simulate=1 shows "You’ve arrived" with the place name at the end', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    test.setTimeout(150_000)
    const errors = watchErrors(page)
    await page.goto('/#/?to=library&simulate=1')
    await mapReady(page)
    const panel = page.getByRole('region', {name: 'Arrow test mode'})
    await expect(panel.locator('[data-sim-status]')).toHaveText(/route, \d+ m/, {timeout: 60_000})
    await panel.getByRole('button', {name: 'Walking speed'}).click() // 4x
    await expect(panel.locator('[data-sim-banner]')).toHaveText(/^You’ve arrived · .*Library/, {timeout: 60_000})
    await expect(panel.locator('[data-sim-readout]')).toContainText('arrow hidden')
    await expect(panel.getByRole('button', {name: 'Replay'})).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('model alignment check', () => {
  test('?debug=align shows the model see-through, the origin, and click coordinates', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    test.setTimeout(150_000)
    const errors = watchErrors(page)
    await page.goto('/#/?debug=align')
    await mapReady(page)
    const panel = page.getByRole('region', {name: 'Model alignment check'})
    await expect(panel).toBeVisible({timeout: 90_000})
    await expect(page.getByRole('menuitem', {name: 'Hide 3D buildings', includeHidden: true})).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('Model')).toHaveValue('50')
    await page.locator('[data-map] canvas').first().click({position: {x: 300, y: 500}})
    await expect(panel.locator('[data-align-latlon]')).toHaveText(/^56\.\d+, -3\.\d+$/)
    await expect(panel.locator('[data-align-metres]')).toHaveText(/^[\d.]+ m (east|west), [\d.]+ m (north|south)$/)
    expect(errors).toEqual([])
  })
})
