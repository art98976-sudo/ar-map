import {expect, test} from '@playwright/test'

// The map-first home screen (items 2 to 7 of its plan). Desktop Chrome at a phone's size unless a
// test says otherwise: these are layout and behaviour checks, not engine checks.
const mapReady = (page) => expect(page.locator('[data-overlay]')).toBeHidden({timeout: 45_000})
const view = (page) =>
  page.evaluate(() => {
    const map = window.__homeMap
    const c = map.getCenter()
    return {lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing()}
  })
const phoneOnly = (testInfo) => test.skip(testInfo.project.name !== 'desktop-chrome')

test.describe('item 3: opens at indoor zoom', () => {
  test('first visit: Campus Central at zoom 17.8; next visit: where the student left the map', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.setViewportSize({width: 390, height: 844})
    await page.goto('/#/?debug=1')
    await mapReady(page)
    await expect.poll(async () => (await view(page)).zoom, {timeout: 10_000}).toBeCloseTo(17.8, 1)
    const first = await view(page)
    expect(Math.abs(first.lng - -3.9209)).toBeLessThan(0.002) // Campus Central, give or take the sheet offset
    expect(Math.abs(first.lat - 56.1456)).toBeLessThan(0.002)

    // A drag (a move the student makes) is remembered on this device.
    const box = await page.locator('[data-map]').boundingBox()
    await page.mouse.move(box.x + 200, box.y + 400)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + 330, {steps: 8})
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('welcomeAR.lastView.v1')), {timeout: 5000}).not.toBeNull()
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('welcomeAR.lastView.v1')))
    await page.reload()
    await mapReady(page)
    await expect.poll(async () => (await view(page)).lng, {timeout: 10_000}).toBeCloseTo(saved.lng, 4)
    expect((await view(page)).zoom).toBeCloseTo(saved.zoom, 1)
  })
})

test.describe('item 4: the map controls on the right edge', () => {
  test('north only on a turned map (tap: north up), floors only in a building, 3D beside them', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.setViewportSize({width: 390, height: 844})
    await page.goto('/#/?debug=1')
    await mapReady(page)
    const rail = page.locator('[data-rail]')
    const north = rail.getByRole('button', {name: 'Turn the map north up'})
    await expect(rail.getByRole('button', {name: 'Show 3D buildings'})).toBeVisible()
    await expect(rail.getByRole('button', {name: 'Show my location'})).toBeVisible()
    await expect(north).toBeHidden()

    // The floor bar lives in the rail, and the menu no longer holds any map control.
    await expect(page.locator('[data-rail] [data-floor-host] .mm-floor-bar')).toBeAttached({timeout: 15_000})
    await page.getByRole('button', {name: 'Menu', exact: true}).click()
    const menu = page.locator('[data-menu]')
    await expect(menu.locator('.mm-floor-bar, [data-action="toggle-3d"], [data-action="north"]')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Turn the map: the compass shows, its needle turned; a tap (or Enter) brings north up.
    await page.evaluate(() => window.__homeMap.setBearing(40))
    await expect(north).toBeVisible()
    expect(await north.evaluate((el) => el.style.getPropertyValue('--bearing'))).toBe('-40deg')
    await north.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => Math.round(window.__homeMap.getBearing())), {timeout: 5000}).toBe(0)
    await expect(north).toBeHidden()

    // All of the rail sits on the right edge, inside the screen.
    const box = await rail.boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.x).toBeGreaterThan(390 / 2)
  })
})

test.describe('item 5: the top bar', () => {
  test('search, Directions, Saved places and Menu in one compact row', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.setViewportSize({width: 390, height: 844})
    await page.goto('/')
    await mapReady(page)
    const top = page.locator('.map-home__top')
    const names = ['Search rooms, buildings, places', 'Directions', 'Saved places', 'Menu']
    const boxes = []
    for (const name of names) {
      const button = top.getByRole('button', {name, exact: true})
      await expect(button).toBeVisible()
      boxes.push(await button.boundingBox())
    }
    // One row, left to right, inside the screen, no taller than a tap target.
    for (const [i, b] of boxes.entries()) {
      expect(b.height).toBeLessThanOrEqual(48)
      expect(Math.abs(b.y + b.height / 2 - (boxes[0].y + boxes[0].height / 2))).toBeLessThan(2)
      if (i) expect(b.x).toBeGreaterThan(boxes[i - 1].x)
    }
    expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(390)
  })

  test('Directions: the search with the start row ready; choosing a start comes back to it', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.goto('/')
    await mapReady(page)
    await page.getByRole('button', {name: 'Directions', exact: true}).click()
    const sheet = page.locator('[data-search-sheet]')
    await expect(sheet.getByRole('heading', {name: 'Directions'})).toBeVisible()
    await expect(sheet.locator('[data-search-from]')).toBeVisible()
    await expect(sheet.locator('[data-search-from-text]')).toHaveText('Your location')
    await expect(sheet.getByRole('combobox')).toBeFocused()

    // Change the start: the start sheet, then back to the search with the new start shown.
    await sheet.locator('[data-search-from] button').click()
    const start = page.locator('[data-start-sheet]')
    await expect(start).toBeVisible()
    await start.getByRole('combobox').fill('Pathfoot')
    await start.getByRole('option', {name: /Pathfoot/}).first().click()
    const door = start.locator('[data-action="start-door"]').first()
    if (await door.isVisible().catch(() => false)) await door.click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-search-from-text]')).toContainText('Pathfoot')
    await expect(sheet.getByRole('combobox')).toBeFocused()

    // Where to: the card, planned from that start.
    await sheet.getByRole('combobox').fill('Library')
    await sheet.getByRole('option', {name: /^Library/}).first().click()
    await expect(page.locator('[data-card] [data-start-text]')).toContainText('Pathfoot')

    // Plain Search has no start row.
    await page.getByRole('button', {name: 'Close', exact: true}).first().click()
    await page.getByRole('button', {name: 'Search rooms, buildings, places'}).click()
    await expect(sheet.getByRole('heading', {name: 'Where do you want to go?'})).toBeVisible()
    await expect(sheet.locator('[data-search-from]')).toBeHidden()
  })

  test('Saved places: says how to save one, then opens the sheet on them', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.goto('/')
    await mapReady(page)
    await page.getByRole('button', {name: 'Saved places', exact: true}).click()
    await expect(page.getByText('No saved places yet. Open a place and tap the star to save it.')).toBeVisible()

    await page.evaluate(() =>
      localStorage.setItem('welcomeAR.saved.v1', JSON.stringify([{group: 'lectures', place: {id: 'cottrell', name: 'Cottrell Building', category: 'academic', lat: 56.1449, lng: -3.9203}}])),
    )
    await page.reload()
    await mapReady(page)
    await page.getByRole('button', {name: 'Saved places', exact: true}).click()
    await expect(page.locator('[data-home-sheet]')).toHaveAttribute('data-height', 'half')
    await expect(page.getByRole('heading', {name: 'My lectures'})).toBeFocused()
    await expect(page.locator('[data-home-sheet]').getByRole('button', {name: 'Cottrell Building'})).toBeVisible()
  })
})

test.describe('item 6: Walk with AR first on a phone that runs AR', () => {
  test('Android: Walk with AR is the primary button, Map directions starts the map trip', async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'android-chrome')
    await page.goto('/#/?to=library')
    const card = page.locator('[data-card]')
    const walk = card.getByRole('button', {name: 'Walk with AR', exact: true})
    await expect(walk).toBeVisible({timeout: 45_000})
    await expect(walk).toHaveAttribute('data-go', '')
    await expect(walk).toHaveClass(/btn--primary/)
    const map = card.getByRole('button', {name: 'Map directions', exact: true})
    await expect(map).toHaveClass(/btn--secondary/)
    await map.click()
    await expect(page.locator('[data-map-trip-text]')).toHaveText(/^Library · \d+ m · \d+ min$/, {timeout: 30_000})
  })

  test('desktop: only the one map button', async ({page}, testInfo) => {
    phoneOnly(testInfo)
    await page.goto('/#/?to=library')
    const card = page.locator('[data-card]')
    await expect(card.locator('[data-go]')).toHaveAttribute('data-action', 'map-trip', {timeout: 45_000})
    await expect(card.getByRole('button', {name: 'Walk with AR'})).toHaveCount(0)
    await expect(card.getByRole('button', {name: 'Map directions'})).toHaveCount(0)
  })
})
