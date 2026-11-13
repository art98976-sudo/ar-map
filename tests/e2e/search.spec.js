import {expect, test} from '@playwright/test'

// The search sheet runs the same on every device; network-only parts run on Chrome.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

const openSearch = async (page) => {
  await page.goto('/')
  await page.getByRole('button', {name: 'Search rooms, buildings, places'}).click()
  return page.getByRole('dialog', {name: 'Where do you want to go?'})
}

test.describe('destination search', () => {
  test('opens as a full-height sheet, with popular places', async ({page}) => {
    const sheet = await openSearch(page)
    await expect(sheet).toBeVisible()
    const {height} = await sheet.evaluate((el) => el.getBoundingClientRect().toJSON())
    expect(height).toBe(page.viewportSize().height)
    for (const name of ['Library', 'Atrium', 'Cottrell Building', 'Pathfoot Building', 'Sports Centre', 'Campus Central']) {
      await expect(sheet.getByRole('button', {name, exact: true})).toBeVisible()
    }
    await sheet.getByRole('button', {name: 'Close search'}).click()
    await expect(sheet).toBeHidden()
  })

  test('typing "lib" suggests the Library, and picking it opens its card', async ({page}) => {
    const sheet = await openSearch(page)
    await sheet.getByRole('combobox', {name: 'Search for a destination'}).fill('lib')
    const option = sheet.getByRole('option', {name: /Library/}).first()
    await expect(option).toBeVisible()
    await option.click()
    await expect(sheet).toBeHidden()
    const card = page.locator('[data-card]')
    await expect(card.getByRole('heading', {name: 'Library'})).toBeVisible()
    await expect(card.locator('[data-ar-choice]')).toBeVisible()
  })

  test('the back button closes the sheet and stays on the map', async ({page}) => {
    const sheet = await openSearch(page)
    await page.goBack()
    await expect(sheet).toBeHidden()
    const opener = page.getByRole('button', {name: 'Search rooms, buildings, places'})
    await expect(opener).toBeVisible()
    await expect(opener).toBeFocused()
  })

  test('an open sheet shuts the map off from focus, and closing returns focus to its button', async ({page}) => {
    const sheet = await openSearch(page)
    await expect(page.locator('[data-map]')).toHaveAttribute('inert', '')
    await expect(page.locator('.map-home__top')).toHaveAttribute('inert', '')
    await sheet.getByRole('button', {name: 'Close search'}).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('[data-map]')).not.toHaveAttribute('inert', '')
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeFocused()
  })

  test('closing a sheet leaves no entry behind for the back button to reopen', async ({page}) => {
    const sheet = await openSearch(page)
    const before = await page.evaluate(() => window.history.state)
    await sheet.getByRole('button', {name: 'Close search'}).click()
    await expect(sheet).toBeHidden()
    await expect.poll(() => page.evaluate(() => window.history.state)).toBeNull()
    expect(before).toEqual({sheet: 'search'})
  })

  test('picking a place names it in the address, focuses its card and survives a reload', async ({page}) => {
    const sheet = await openSearch(page)
    await sheet.getByRole('button', {name: 'Pathfoot Building'}).click()
    await expect(sheet).toBeHidden()
    const heading = page.locator('[data-card]').getByRole('heading', {name: 'Pathfoot Building'})
    await expect(heading).toBeFocused()
    await expect(page).toHaveURL(/#\/\?to=pathfoot$/)
    await page.reload()
    await expect(heading).toBeVisible()
    await page.locator('[data-card]').getByRole('button', {name: 'Close'}).click()
    await expect(page).toHaveURL(/#\/$/)
  })

  test('quick buttons take you to places in town', async ({page}) => {
    const sheet = await openSearch(page)
    for (const name of ['Stirling Train Station', 'Stirling Bus Station', 'City Centre', 'Stirling Castle']) {
      await expect(sheet.getByRole('button', {name})).toBeVisible()
    }
    await sheet.getByRole('button', {name: 'Stirling Train Station'}).click()
    await expect(page.locator('[data-card]').getByRole('heading', {name: 'Stirling Train Station'})).toBeVisible()
    await expect(page).toHaveURL(/to=stirling-station/)
  })

  test('aliases work: "gym" finds the Sports Centre, "bus" the Bus Hub', async ({page}) => {
    const sheet = await openSearch(page)
    const box = sheet.getByRole('combobox')
    await box.fill('gym')
    await expect(sheet.getByRole('option').first()).toContainText('Sports Centre')
    await box.fill('bus')
    await expect(sheet.getByRole('option').first()).toContainText('Bus Hub')
  })

  test('keyboard: arrow down and Enter pick a result', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    const sheet = await openSearch(page)
    const box = sheet.getByRole('combobox')
    await box.fill('atrium')
    await expect(sheet.getByRole('option').first()).toContainText('Atrium')
    await box.press('ArrowDown')
    await expect(box).toHaveAttribute('aria-activedescendant', /opt-0/)
    await box.press('Enter')
    await expect(page.locator('[data-card]').getByRole('heading', {name: 'Atrium'})).toBeVisible()
  })

  test('shows a friendly empty state', async ({page}) => {
    // Keep the room search offline so the result is the same everywhere.
    await page.route('https://search.mazemap.com/**', (route) => route.fulfill({json: {result: []}}))
    const sheet = await openSearch(page)
    await sheet.getByRole('combobox').fill('qqqzzz')
    await expect(sheet.getByText('No room found. Try the room number, like 2B87.')).toBeVisible()
  })

  test('remembers recent searches on this phone, and can clear them', async ({page}) => {
    let sheet = await openSearch(page)
    await sheet.getByRole('button', {name: 'Pathfoot Building'}).click()
    await page.reload()
    sheet = await openSearch(page)
    const recent = sheet.getByRole('listbox', {name: 'Recent searches'})
    await expect(recent.getByRole('option', {name: /Pathfoot Building/})).toBeVisible()
    await sheet.getByRole('button', {name: 'Clear recent searches'}).click()
    await expect(recent).toHaveCount(0)
  })

  test('finds rooms on the University map (MazeMap), and opens a card for one', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    const sheet = await openSearch(page)
    await sheet.getByRole('combobox').fill('2A73')
    const room = sheet.getByRole('option', {name: /2A73/}).first()
    await expect(room).toBeVisible({timeout: 15_000})
    await expect(room).toContainText('Cottrell Building · Level 2')
    await room.click()
    await expect(page.locator('[data-card]')).toContainText('Cottrell Building · Level 2')
  })

  test('the camera screen without a destination goes back to the map', async ({page}) => {
    await page.goto('/#/ar')
    await expect(page.getByRole('button', {name: 'Search rooms, buildings, places'})).toBeVisible()
  })

  test('reloading the camera screen shows the destination and one small button', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await page.goto('/#/ar?to=cottrell&force=1')
    await expect(page.locator('[data-destination]')).toContainText('Cottrell Building', {timeout: 30_000})
    await expect(page.getByRole('button', {name: 'Tap to start'})).toBeVisible()
    await page.getByRole('button', {name: 'Cancel'}).click()
    await expect(page.locator('[data-card]').getByRole('heading', {name: 'Cottrell Building'})).toBeVisible()
  })
})
