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
    // Line-up: a drag turns the route, "Looks right" keeps it; "Re-align" opens it again.
    const lineUp = page.getByRole('region', {name: 'Line up the arrows'})
    await expect(lineUp).toBeVisible({timeout: 10_000})
    await expect(page.getByRole('button', {name: 'Re-align the arrows with the path'})).toBeHidden()
    const box = (await page.locator('.ar').boundingBox())
    await page.mouse.move(box.width * 0.3, box.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(box.width * 0.6, box.height * 0.4, {steps: 6})
    await page.mouse.up()
    await lineUp.getByRole('button', {name: 'Looks right'}).click()
    await expect(lineUp).toBeHidden()
    const realign = page.getByRole('button', {name: 'Re-align the arrows with the path'})
    await expect(realign).toBeVisible()
    await realign.click()
    await expect(lineUp).toBeVisible()
    await lineUp.getByRole('button', {name: 'Looks right'}).click()
    await expect(lineUp).toBeHidden()
    // ?debug=1: the live overlay.
    await expect(page.locator('[data-live="segment"]')).toHaveText(/^\d+°$/, {timeout: 10_000})
    await expect(page.locator('[data-live="look"]')).toHaveText(/^\d+°$/)
    await page.getByRole('button', {name: 'Show debug panel'}).click()
    const panel = page.getByRole('region', {name: 'Debug panel'})
    await expect(panel).toBeVisible()
    // The way is drawn on the floor: 3D chevrons in the AR scene. ?debug=1 says why they are there.
    await expect(page.locator('[data-ar-status]')).toHaveText(/aligned yes · chevrons \d+ visible, \d+ blocked · walls (no|level -?\d+) · in view \d+/, {timeout: 30_000})
    await expect(page.locator('[data-ar-status]')).toHaveText(/floor (tap|hits|fallback) \d+\.\d\d m below/)
    // No directions in words, no flat overlay arrows, no numbered turns.
    for (const gone of ['[data-floor-arrows]', '[data-guidance]', '[data-steps]', '[data-start-direction]', '.ar-map__turn']) {
      await expect(page.locator(gone)).toHaveCount(0)
    }
    await expect(page.getByText(/^Turn (left|right|around)/)).toHaveCount(0)
    await expect(panel.locator('[data-stat="gps"]')).toHaveText(/±\d+ m/)
    await expect(panel.locator('[data-stat="remaining"]')).toHaveText(/\d+ m/)
    await expect(panel.locator('[data-stat="source"]')).toHaveText(/mazemap|footpaths|direct/)
    await expect(panel.locator('[data-stat="turn"]')).toHaveText(/^(left|right|slight-left|slight-right|arrive), \d+ m$/)
    await expect(panel.locator('[data-stat="source"]')).toHaveText(/, \d+ points$/)
    await expect(panel.getByRole('button', {name: 'Recalibrate compass'})).toBeVisible()
    // The map opens to full screen and back.
    await page.getByRole('button', {name: 'Hide debug panel'}).click()
    await page.waitForTimeout(500)
    await page.screenshot({path: testInfo.outputPath('ground-chevrons.png')})
    // Kept: the close button and the trip pill ("Cottrell · 120 m · 2 min").
    await expect(page.getByRole('button', {name: 'Exit AR'})).toBeVisible()
    await expect(page.locator('[data-trip-pill]')).toHaveText(/^.+ · \d+(\.\d)? k?m · \d+ min$/)
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
  test('GPS worse than 20 m for 3 s: the map opens with "Finding your position"; good GPS puts it back', async ({page, context}, testInfo) => {
    test.setTimeout(180_000)
    test.skip(onlyOn('android-chrome')(testInfo))
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(FAKE_REAR_CAMERA)
    const here = {latitude: 56.14525, longitude: -3.9201}
    await context.setGeolocation({...here, accuracy: 5})
    await page.goto('/#/locate?to=cottrell&force=1&debug=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 90_000})
    const hint = page.getByText('Finding your position. Follow the map for now.')
    const map = page.locator('[data-compass-map]')
    await expect(hint).toBeHidden()
    await expect(map).not.toHaveClass(/is-expanded/)

    await context.setGeolocation({...here, accuracy: 40})
    await page.waitForTimeout(1500)
    await expect(hint).toBeHidden() // not after one bad moment
    await expect(hint).toBeVisible({timeout: 5000})
    await expect(map).toHaveClass(/is-expanded/)
    await page.screenshot({path: testInfo.outputPath("finding-position.png")})

    await context.setGeolocation({...here, accuracy: 6})
    await page.waitForTimeout(1500)
    await expect(hint).toBeVisible() // 3 s of good readings first
    await expect(hint).toBeHidden({timeout: 5000})
    await expect(map).not.toHaveClass(/is-expanded/) // put back, as the user had it
    expect(errors).toEqual([])
  })
})
