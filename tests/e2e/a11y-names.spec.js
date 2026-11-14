import {expect, test} from '@playwright/test'

// Every visible button, link and form control has an accessible name (item 5): on each screen and
// with each sheet or menu open. A missing name is reported with the element's markup.
const FAKE_REAR_CAMERA = () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (constraints) => {
    if (constraints?.video && typeof constraints.video === 'object') delete constraints.video.facingMode
    return original(constraints)
  }
}

/** Visible controls with no accessible name (aria-label, aria-labelledby, label, text, title, alt). */
function unnamed(page) {
  return page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [aria-hidden="true"]')
    const textOf = (el) => (el.innerText || el.textContent || '').trim() || [...el.querySelectorAll('img[alt], svg title')].map((i) => i.alt || i.textContent).join(' ').trim()
    const nameOf = (el) => {
      const labelled = el.getAttribute('aria-labelledby')
      if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      const own = el.getAttribute('aria-label') || el.getAttribute('title') || ''
      if (own.trim()) return own.trim()
      if (el.labels?.length) return [...el.labels].map((l) => l.textContent).join(' ').trim()
      if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type)) return el.value
      return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? el.placeholder || '' : textOf(el)
    }
    const controls = document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="switch"], [role="tab"], input:not([type="hidden"]), select, textarea')
    const missing = [...controls].filter((el) => visible(el) && !nameOf(el))
    // Images too: an <img> needs alt (empty is fine for decoration); an <svg> outside a named
    // image needs a name or aria-hidden. MazeMap's own map canvas and controls are not ours.
    const images = [...document.querySelectorAll('img, svg, [role="img"]')].filter((el) => {
      if (!visible(el) || el.closest('.mapboxgl-map, .mazemap-ctrl-logo-wrapper')) return false
      if (el.tagName === 'IMG') return !el.hasAttribute('alt')
      if (el.parentElement?.closest('svg, [role="img"]')) return false // part of a named image
      if (el.closest('button, a, [role="button"], [role="menuitem"]') && el.tagName.toLowerCase() === 'svg' && !el.getAttribute('role')) return false // named by its control
      return !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.querySelector?.('title'))
    })
    return [...missing, ...images].map((el) => el.outerHTML.slice(0, 200))
  })
}

async function mapReady(page) {
  await expect(page.locator('.map-pin').first()).toBeAttached({timeout: 45_000})
}

test.describe('every control has a name', () => {
  test.beforeEach(async ({browserName}, testInfo) => test.skip(testInfo.project.name !== 'desktop-chrome' && testInfo.project.name !== 'android-chrome'))

  test('home: map, menu, search, a building card, its options and the start sheet', async ({page}) => {
    await page.goto('/')
    await mapReady(page)
    expect(await unnamed(page), 'home at rest').toEqual([])
    await page.locator('[data-action="open-menu"]').click()
    expect(await unnamed(page), 'menu').toEqual([])
    await page.keyboard.press('Escape')
    await page.locator('[data-action="open-search"]').first().click()
    await page.getByRole('combobox').first().fill('lib')
    await page.waitForTimeout(500)
    expect(await unnamed(page), 'search').toEqual([])
    await page.keyboard.press('Escape')

    await page.goto('/#/?to=library')
    await expect(page.locator('[data-go]')).toBeVisible({timeout: 45_000})
    expect(await unnamed(page), 'building card').toEqual([])
    await page.locator('[data-action="toggle-options"]').click()
    expect(await unnamed(page), 'card options').toEqual([])
    await page.locator('.route-from__row').click()
    await expect(page.locator('[data-start-sheet]')).toBeVisible()
    expect(await unnamed(page), 'start sheet').toEqual([])
  })

  test('a room card, the indoor map, the poster QR page and the counts page', async ({page}) => {
    await page.goto('/#/?to=mm-1002085033')
    await expect(page.locator('.dest-sheet__name')).toHaveText('A3 Lecture Theatre', {timeout: 45_000})
    expect(await unnamed(page), 'room card').toEqual([])
    await page.goto('/#/indoor?to=mm-1002085033')
    await page.waitForTimeout(6000)
    expect(await unnamed(page), 'indoor map').toEqual([])
    await page.goto('/#/qr?to=library')
    await expect(page.getByRole('heading', {name: 'Library'})).toBeVisible()
    expect(await unnamed(page), 'qr page').toEqual([])
    await page.goto('/#/stats')
    await expect(page.getByRole('heading', {name: 'Trip counts'})).toBeVisible()
    expect(await unnamed(page), 'stats').toEqual([])
  })

  test('locate and the live AR screen', async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'android-chrome')
    test.setTimeout(180_000)
    await page.addInitScript(FAKE_REAR_CAMERA)
    await page.goto('/#/locate?to=cottrell&force=1')
    await expect(page.getByRole('button', {name: 'Tap to start'})).toBeVisible({timeout: 30_000})
    expect(await unnamed(page), 'locate').toEqual([])
    await page.getByRole('button', {name: 'Tap to start'}).click()
    await expect(page.locator('[data-trip-pill]')).toBeVisible({timeout: 90_000})
    await page.waitForTimeout(4000)
    expect(await unnamed(page), 'AR').toEqual([])
  })
})
