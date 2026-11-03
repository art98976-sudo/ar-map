import {expect, test} from '@playwright/test'

// Destination search runs the same on every device; network-only parts run on Chrome.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

test.describe('destination search', () => {
  test('Start AR opens the search first, with popular places', async ({page}) => {
    await page.goto('/')
    await page.getByRole('button', {name: 'Start AR'}).click()
    await expect(page.getByRole('heading', {name: 'Where do you want to go?'})).toBeVisible()
    for (const name of ['Library', 'Atrium', 'Cottrell Building', 'Pathfoot Building', 'Sports Centre', 'Campus Central']) {
      await expect(page.getByRole('button', {name, exact: true})).toBeVisible()
    }
  })

  test('typing "lib" suggests the Library, and picking it carries on to the camera', async ({page}) => {
    await page.goto('/#/search')
    const box = page.getByRole('combobox', {name: 'Search for a destination'})
    await box.fill('lib')
    const option = page.getByRole('option', {name: /Library/}).first()
    await expect(option).toBeVisible()
    await option.click()
    await expect(page).toHaveURL(/#\/(check|ar)\?to=library/)
  })

  test('aliases work: "gym" finds the Sports Centre', async ({page}) => {
    await page.goto('/#/search')
    await page.getByRole('combobox').fill('gym')
    await expect(page.getByRole('option').first()).toContainText('Sports Centre')
  })

  test('keyboard: arrow down and Enter pick a result', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/#/search')
    const box = page.getByRole('combobox')
    await box.fill('atrium')
    await expect(page.getByRole('option').first()).toContainText('Atrium')
    await box.press('ArrowDown')
    await expect(box).toHaveAttribute('aria-activedescendant', /opt-0/)
    await box.press('Enter')
    await expect(page).toHaveURL(/to=atrium/)
  })

  test('shows a friendly empty state', async ({page}) => {
    // Keep the room search offline so the result is the same everywhere.
    await page.route('https://search.mazemap.com/**', (route) => route.fulfill({json: {result: []}}))
    await page.goto('/#/search')
    await page.getByRole('combobox').fill('qqqzzz')
    await expect(page.getByText('No results – try a building name or room number')).toBeVisible()
  })

  test('remembers recent searches on this phone, and can clear them', async ({page}) => {
    await page.goto('/#/search')
    await page.getByRole('button', {name: 'Pathfoot Building'}).click()
    await page.goto('/#/search')
    const recent = page.getByRole('listbox', {name: 'Recent searches'})
    await expect(recent.getByRole('option', {name: /Pathfoot Building/})).toBeVisible()
    await page.getByRole('button', {name: 'Clear recent searches'}).click()
    await expect(recent).toHaveCount(0)
  })

  test('finds rooms on the University map (MazeMap)', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await page.goto('/#/search')
    await page.getByRole('combobox').fill('2A73')
    const room = page.getByRole('option', {name: /2A73/}).first()
    await expect(room).toBeVisible({timeout: 15_000})
    await expect(room).toContainText('Cottrell Building · Level 2')
  })

  test('the camera screen without a destination sends you to search', async ({page}) => {
    await page.goto('/#/ar')
    await expect(page.getByRole('heading', {name: 'Where do you want to go?'})).toBeVisible()
  })

  test('the chosen destination is shown on the camera screen and can be changed', async ({page}) => {
    await page.goto('/#/ar?to=cottrell')
    // No route yet, so it plans one first (location step), then shows the camera screen.
    await expect(page.locator('[data-destination]')).toContainText('Cottrell Building', {timeout: 30_000})
    await page.getByRole('button', {name: 'Change'}).click()
    await expect(page.getByRole('heading', {name: 'Where do you want to go?'})).toBeVisible()
  })
})

test.describe('campus map search', () => {
  test('search on the map shows the place and offers AR directions', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await page.goto('/#/map')
    await expect(page.locator('[data-overlay]')).toBeHidden({timeout: 30_000})
    await page.getByRole('combobox', {name: 'Search the campus map'}).fill('library')
    await page.getByRole('option', {name: /Library/}).first().click()
    const card = page.locator('[data-card]')
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', {name: 'Library'})).toBeVisible()
    await card.getByRole('button', {name: 'Start AR to here'}).click()
    await expect(page).toHaveURL(/to=library/)
  })

  test('#/map?to= opens with that place selected', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome')(testInfo))
    await page.goto('/#/map?to=sports-centre')
    await expect(page.locator('[data-card]').getByRole('heading', {name: 'Sports Centre'})).toBeVisible()
  })
})
