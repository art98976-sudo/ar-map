import {expect, test} from '@playwright/test'

// Route planning, the AR guide and the arrows. Chrome only: it can fake GPS and a camera.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

// Chromium's fake camera has no "rear" camera; real phones do. Drop the constraint in tests.
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

test.describe('route and arrows', () => {
  test('plans the walk after the GPS fix and shows it before the camera', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=pathfoot')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    // Pathfoot is roughly 700 m from the walkway: about 9 minutes.
    await expect(page.locator('[data-trip-pill]')).toHaveText(/^Pathfoot · \d+ m · \d+ min$/, {timeout: 60_000})
  })

  test('from the train station: plans a walk to Pathfoot across town', async ({browser}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    test.setTimeout(180_000)
    const ctx = await browser.newContext({
      ...testInfo.project.use,
      geolocation: {latitude: 56.119651, longitude: -3.934296, accuracy: 5},
    })
    const page = await ctx.newPage()
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=pathfoot&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-trip-pill]')).toHaveText(/^Pathfoot · \d(\.\d)? ?k?m · \d+ min$/, {timeout: 60_000})
    await expect(page.locator('[data-compass-map]')).toBeVisible()
    await ctx.close()
  })

  test('outside Stirling: offers Google Maps walking directions', async ({browser}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    const ctx = await browser.newContext({
      ...testInfo.project.use,
      geolocation: {latitude: 55.9533, longitude: -3.1883, accuracy: 5}, // Edinburgh
    })
    const page = await ctx.newPage()
    await page.goto('/#/locate?to=library&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.getByRole('heading', {name: "You're outside Stirling"})).toBeVisible({timeout: 15_000})
    const link = page.getByRole('link', {name: 'Walking directions in Google Maps'})
    await expect(link).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=56\.\d+,-3\.\d+&travelmode=walking/)
    await expect(page.getByRole('button', {name: 'View 2D map instead'})).toBeVisible()
    await ctx.close()
  })

  test('test mode: the engine runs and arrows are drawn on the route', async ({page}, testInfo) => {
    test.setTimeout(180_000) // the whole AR screen, on a software GPU
    // Android profile: the 8th Wall engine only opens the camera on phones, not desktop browsers.
    test.skip(onlyOn('android-chrome')(testInfo))
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=cottrell&force=1&debug=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-stat="camera"]')).toHaveText('Working', {timeout: 60_000})
    // A trip from GPS starts by itself, with nothing to tap.
    await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 30_000})
    await expect(page.locator('[data-start]')).toBeHidden()
    await expect(page.locator('[data-compass-map]')).toBeVisible()
    // ?debug=1: the live overlay.
    await expect(page.locator('[data-live="segment"]')).toHaveText(/^\d+°$/, {timeout: 10_000})
    await expect(page.locator('[data-live="look"]')).toHaveText(/^\d+°$/)
    await page.getByRole('button', {name: 'Show debug panel'}).click()
    const panel = page.getByRole('region', {name: 'Debug panel'})
    await expect(panel).toBeVisible()
    // The way to walk: four big chevrons lying on the floor over the camera. They wait for a heading,
    // which headless Chrome (no real compass) can be slow to give.
    await expect(page.locator('[data-floor-arrows] [data-trail]')).toBeVisible({timeout: 30_000})
    await expect(page.locator('[data-floor-arrows] .floor-arrows__chevron')).toHaveCount(4)
    await expect(panel.locator('[data-stat="gps"]')).toHaveText(/±\d+ m/)
    await expect(panel.locator('[data-stat="remaining"]')).toHaveText(/\d+ m/)
    await expect(panel.locator('[data-stat="source"]')).toHaveText(/mazemap|footpaths|direct/)
    await expect(panel.locator('[data-stat="turn"]')).toHaveText(/^(left|right|slight-left|slight-right|arrive), \d+ m$/)
    await expect(panel.locator('[data-stat="source"]')).toHaveText(/, \d+ points$/)
    await expect(page.locator('[data-guidance]')).toHaveText(/^(Continue (straight \d+ m|past .+ · \d+ m)|(Turn|Bear) (left|right) (in \d+ m|now|at .+ · (\d+ m|now))|.* in \d+ m)$/)
    await expect(panel.getByRole('button', {name: 'Recalibrate compass'})).toBeVisible()
    // The card pulls down the list of steps, and the map opens to full screen and back.
    await page.getByRole('button', {name: 'Hide debug panel'}).click()
    await page.locator('[data-action="toggle-steps"]').click()
    await expect(page.locator('[data-steps] li').first()).toBeVisible({timeout: 5_000})
    await page.locator('[data-action="toggle-steps"]').click()
    await expect(page.locator('[data-steps]')).toBeHidden()
    // A finger swipe opens the list, and the tap after it still closes it.
    const card = await page.locator('[data-action="toggle-steps"]').boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints})
    const at = {x: card.x + card.width / 2, y: card.y + 20}
    await touch('touchStart', [at])
    for (const down of [15, 30, 45]) await touch('touchMove', [{...at, y: at.y + down}])
    await touch('touchEnd', [])
    await expect(page.locator('[data-steps] li').first()).toBeVisible({timeout: 5_000})
    await page.waitForTimeout(600)
    await page.touchscreen.tap(at.x, at.y)
    await expect(page.locator('[data-steps]')).toBeHidden()
    await page.getByRole('button', {name: 'Expand map'}).click()
    await expect(page.locator('[data-compass-map]')).toHaveClass(/is-expanded/)
    // The map itself follows, not only its box: open, it is a sheet over about 55% of the screen.
    const viewport = page.viewportSize()
    const mapHeight = async () => (await page.locator('[data-map-canvas] canvas').first().boundingBox())?.height
    await expect.poll(mapHeight, {timeout: 10_000}).toBeGreaterThan(viewport.height * 0.53)
    expect(await mapHeight()).toBeLessThan(viewport.height * 0.57)
    await page.getByRole('button', {name: 'Shrink map'}).click()
    await expect(page.locator('[data-compass-map]')).not.toHaveClass(/is-expanded/)
    // Closed, a small card in the bottom-left corner, about 38% wide and 22% high.
    await expect.poll(mapHeight, {timeout: 10_000}).toBeLessThan(viewport.height * 0.24)
    const mapCard = await page.locator('[data-compass-map]').boundingBox()
    expect(mapCard.width).toBeLessThan(viewport.width * 0.4)
    expect(mapCard.x).toBeLessThan(viewport.width * 0.1)
    expect(errors).toEqual([])
  })

  test('from GPS there is no card to tap, only a small indicator until tracking is ready', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-veil]')).toHaveClass(/is-hidden/, {timeout: 60_000})
    // Headless Chrome's fake camera never tracks.
    await expect(page.locator('[data-locating]')).toHaveText('Locating you…', {timeout: 15_000})
    await expect(page.locator('[data-start]')).toBeHidden()
    // The map always shows. Without ?debug=1 nothing of the debug tools does.
    await expect(page.locator('[data-compass-map]')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Show debug panel'})).toHaveCount(0)
  })
})

test.describe('position confidence on the AR screen', () => {
  test('GPS worse than 20 m for 3 s: arrows hide, the map opens with "Finding your position"; good GPS brings them back', async ({page, context}, testInfo) => {
    test.setTimeout(180_000)
    test.skip(onlyOn('android-chrome')(testInfo))
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(FAKE_REAR_CAMERA)
    const here = {latitude: 56.14525, longitude: -3.9201}
    await context.setGeolocation({...here, accuracy: 5})
    await page.goto('/#/locate?to=cottrell&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    const arrows = page.locator('[data-floor-arrows] [data-trail]')
    await expect(arrows).toBeVisible({timeout: 90_000})
    const hint = page.getByText('Finding your position. Follow the map for now.')
    const map = page.locator('[data-compass-map]')
    await expect(hint).toBeHidden()
    await expect(map).not.toHaveClass(/is-expanded/)

    await context.setGeolocation({...here, accuracy: 40})
    await page.waitForTimeout(1500)
    await expect(hint).toBeHidden() // not after one bad moment
    await expect(hint).toBeVisible({timeout: 5000})
    await expect(map).toHaveClass(/is-expanded/)
    await expect(arrows).toBeHidden()
    await page.screenshot({path: testInfo.outputPath("finding-position.png")})

    await context.setGeolocation({...here, accuracy: 6})
    await page.waitForTimeout(1500)
    await expect(hint).toBeVisible() // 3 s of good readings first
    await expect(hint).toBeHidden({timeout: 5000})
    await expect(map).not.toHaveClass(/is-expanded/) // put back, as the user had it
    await expect(arrows).toBeVisible({timeout: 10_000})
    expect(errors).toEqual([])
  })
})
