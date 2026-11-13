import {expect, test} from '@playwright/test'

// Choosing where a trip starts: the From row, the sheet, swap, pick on map, and AR from a door.
const onlyOn = (...names) => (testInfo) => !names.includes(testInfo.project.name)

const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

async function openCard(page, id = 'library') {
  await page.goto(`/#/?to=${id}`)
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
  await expect(page.locator('[data-ar-choice]')).toBeVisible({timeout: 15_000})
  // The start, swap and step-free are folded into "From my location · Options".
  await page.locator('[data-action="toggle-options"]').click()
}

const fromRow = (page) => page.locator('.route-from__row')

test.describe('starting point', () => {
  test('the From row shows GPS with its accuracy, above the destination', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await openCard(page)
    await expect(page.locator('[data-start-value]')).toHaveText(/^Current location · ±\d+ m$/, {timeout: 20_000})
    const from = await fromRow(page).boundingBox()
    const to = await page.locator('[data-card] .dest-sheet__name').boundingBox()
    expect(from.y).toBeLessThan(to.y)
  })

  test('choosing a building starts at its entrance, and is kept for the session', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await openCard(page)
    await fromRow(page).click()
    const sheet = page.locator('[data-start-sheet]')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('combobox').fill('juniper') // housing, which is not a destination
    await expect(sheet.getByRole('option', {name: /Juniper Court/})).toBeVisible()
    await sheet.getByRole('combobox').fill('cottrell')
    await sheet.getByRole('option', {name: /^Cottrell Building/}).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('[data-start-value]')).toHaveText('Cottrell main entrance')
    await expect(fromRow(page)).toBeFocused()
    await page.reload()
    await expect(page.locator('[data-start-value]')).toHaveText('Cottrell main entrance', {timeout: 45_000})
    await expect(page.locator('[data-start-text]')).toHaveText('Cottrell main entrance') // the folded line says it too
    // And it shows at the top next time, under Recent.
    await page.locator('[data-action="toggle-options"]').click()
    await fromRow(page).click()
    await expect(sheet.getByRole('heading', {name: 'Recent'})).toBeVisible()
    await expect(sheet.getByRole('option', {name: /^Cottrell Building/})).toBeVisible()
  })

  test('the swap button swaps From and To', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await openCard(page)
    await fromRow(page).click()
    const sheet = page.locator('[data-start-sheet]')
    await sheet.getByRole('combobox').fill('cottrell')
    await sheet.getByRole('option', {name: /^Cottrell Building/}).click()
    await page.getByRole('button', {name: 'Swap start and destination'}).click()
    await expect(page.locator('[data-card] .dest-sheet__name')).toHaveText('Cottrell Building')
    await expect(page.locator('[data-start-value]')).toHaveText('Library main entrance')
    await expect(page).toHaveURL(/to=cottrell/)
  })

  test('pick on map: the pin snaps to a path, and confirming sets the start', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await openCard(page)
    await fromRow(page).click()
    await page.getByRole('button', {name: /Pick on map/}).click()
    const confirm = page.getByRole('button', {name: 'Confirm start here'})
    await expect(page.locator('[data-pick-text]')).toHaveText(/nearest path/, {timeout: 30_000})
    await expect(confirm).toBeEnabled()
    await expect(page.locator('.map-pick-pin')).toBeVisible()
    await expect(page.locator('[data-card]')).toBeHidden()
    await confirm.click()
    await expect(page.locator('[data-card]')).toBeVisible()
    await expect(page.locator('.map-pick-pin')).toHaveCount(0)
    await expect(page.locator('[data-start-value]')).toHaveText('Pin on the map')
    await expect(page.locator('.map-start')).toBeVisible()
  })

  test('cancelling a pick changes nothing', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await openCard(page)
    await fromRow(page).click()
    await page.getByRole('button', {name: /Pick on map/}).click()
    await page.getByRole('button', {name: 'Cancel'}).click()
    await expect(page.locator('[data-card]')).toBeVisible()
    await expect(page.locator('[data-start-value]')).toContainText('Current location')
  })

  test('GPS blocked: never stuck, it offers a manual start', async ({page}, testInfo) => {
    test.skip(onlyOn('desktop-chrome', 'android-chrome')(testInfo))
    await page.addInitScript(() => {
      navigator.permissions.query = async () => ({state: 'denied', addEventListener() {}, removeEventListener() {}})
    })
    await page.goto('/#/locate?to=library&force=1')
    await page.getByRole('button', {name: 'Choose starting point'}).click({timeout: 15_000})
    await expect(page.locator('[data-start-sheet]')).toBeVisible({timeout: 45_000})
    await expect(page.getByRole('heading', {name: 'Where are you starting from?'})).toBeVisible()
  })

  test('weak GPS: the prompt appears without blocking the wait', async ({page, context}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    await context.setGeolocation({latitude: 56.14525, longitude: -3.9201, accuracy: 60})
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=library&force=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.getByText("We can't find you precisely.")).toBeVisible({timeout: 20_000})
    await expect(page.getByRole('button', {name: 'Choose starting point'})).toBeVisible()
    await expect(page.getByRole('button', {name: 'Cancel'})).toBeVisible()
  })

  test('AR from a door: the Start button says when it is not ready', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    test.setTimeout(180_000)
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.addInitScript(() => {
      sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify({type: 'place', placeId: 'cottrell', name: 'Cottrell Building', entranceName: 'main entrance', lat: 56.144904, lng: -3.920317, headingDeg: 120, facing: null}))
    })
    await page.goto('/#/locate?to=library')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    // Headless Chrome's fake camera never tracks.
    const waiting = page.getByRole('button', {name: 'Getting ready…', exact: true})
    await expect(waiting).toBeVisible({timeout: 90_000})
    await expect(waiting).toBeDisabled()
    await expect(waiting).not.toHaveCSS('background-image', /gradient/)
    await expect(page.locator('[data-start-title]')).toBeFocused()
  })

  test('AR from a door: one line says where to stand, and Start begins the walk', async ({page}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    test.setTimeout(180_000)
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.addInitScript(() => {
      sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify({type: 'place', placeId: 'cottrell', name: 'Cottrell Building', entranceName: 'main entrance', lat: 56.144904, lng: -3.920317, headingDeg: 120, facing: null}))
    })
    await page.goto('/#/locate?to=library&force=1&debug=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await expect(page.getByRole('heading', {name: /^Stand at the Cottrell main entrance, with the door behind you, facing south-east\.$/})).toBeVisible({timeout: 90_000})
    await page.getByRole('button', {name: 'Start', exact: true}).click({timeout: 30_000})
    await expect(page.locator('[data-stat="phase"]')).toHaveText('ready', {timeout: 30_000})
    await expect(page.locator('[data-guidance]')).toHaveCount(0) // no directions in words
    await expect(page.locator('[data-compass-map]')).toBeVisible()
  })
})

test.describe('field test mode', () => {
  const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

  test('?fieldtest=1: live readout, marked rows, Finish summary and CSV copy, clear of the arrows', async ({page, context}, testInfo) => {
    test.skip(onlyOn('android-chrome')(testInfo))
    test.setTimeout(180_000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.addInitScript(() => {
      sessionStorage.setItem('welcomeAR.start.v1', JSON.stringify({type: 'place', placeId: 'cottrell', name: 'Cottrell Building', entranceName: 'main entrance', lat: 56.144904, lng: -3.920317, headingDeg: 120, facing: null}))
    })
    await page.goto('/#/locate?to=library&force=1&fieldtest=1')
    await page.getByRole('button', {name: 'Tap to start'}).click({timeout: 30_000})
    await page.getByRole('button', {name: 'Start', exact: true}).click({timeout: 90_000})
    const readout = page.getByRole('region', {name: 'Field test readings'})
    await expect(readout.locator('[data-ft="arrow"]')).toHaveText(/^\d+°$/, {timeout: 30_000})
    await expect(readout.locator('[data-ft="heading"]')).toHaveText(/^(\d+°|–)$/) // no compass in a headless browser
    await expect(readout.locator('[data-ft="along"]')).toHaveText(/ m$/)

    // Nothing of the field test may sit on the arrows, the step card, the trip pill or the mini-map.
    for (const size of [{width: 412, height: 915}, {width: 393, height: 852}, {width: 375, height: 667}]) {
      await page.setViewportSize(size)
      await page.waitForTimeout(300)
      await page.screenshot({path: testInfo.outputPath(`fieldtest-${size.width}x${size.height}.png`)})
      const boxes = {
        readout: await readout.boundingBox(),
        marks: await page.getByRole('group', {name: 'Mark this moment'}).boundingBox(),
      }
      const arrowsTop = size.height * 0.55
      for (const [name, box] of Object.entries(boxes)) {
        expect(box.y + box.height, `${name} above the arrows at ${size.width}x${size.height}`).toBeLessThanOrEqual(arrowsTop)
        for (const other of ['[data-step-card]', '[data-trip-pill]', '[data-compass-map]']) {
          const el = page.locator(other)
          if (!(await el.isVisible())) continue
          expect(overlaps(box, await el.boundingBox()), `${name} clear of ${other} at ${size.width}x${size.height}`).toBe(false)
        }
      }
    }
    await page.setViewportSize({width: 412, height: 915})

    await page.getByRole('button', {name: 'Arrow correct'}).click()
    await page.getByRole('button', {name: 'Arrow correct'}).click()
    await page.getByRole('button', {name: 'Arrow wrong'}).click()
    await page.getByRole('button', {name: 'At a turn'}).click()
    await page.waitForTimeout(2200) // a couple of timed samples
    await page.getByRole('button', {name: 'Finish'}).click()
    const sheet = page.getByRole('dialog', {name: 'Field test summary'})
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(/GPS accuracy\s*average ±[\d.]+ m, worst ±[\d.]+ m/)
    await expect(sheet).toContainText(/Distance from route\s*average [\d.]+ m, worst [\d.]+ m/)
    await expect(sheet).toContainText(/Arrow correct\s*2/)
    await expect(sheet).toContainText(/Arrow wrong\s*1/)
    await expect(sheet).toContainText(/At a turn\s*1/)
    await sheet.getByRole('button', {name: 'Copy CSV'}).click()
    await expect(sheet.getByRole('status')).toContainText(/Copied \d+ rows/)
    const csv = await page.evaluate(() => navigator.clipboard.readText())
    const lines = csv.trimEnd().split(/\r?\n/) // the Windows clipboard turns \n into \r\n
    expect(lines[0]).toBe('time,elapsed_s,lat,lon,tracked_lat,tracked_lon,gps_accuracy_m,heading_deg,off_route_m,along_m,arrow_bearing_deg,tracked_heading_deg,heading_gap_deg,match_locked,match_residual_m,lateral_offset_m,fps,phase,mark')
    expect(lines.filter((l) => l.endsWith(',Arrow correct'))).toHaveLength(2)
    expect(lines.length).toBeGreaterThan(6)
    await sheet.getByRole('button', {name: 'Continue'}).click()
    await expect(sheet).toBeHidden()
  })
})
