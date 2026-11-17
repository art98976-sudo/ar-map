import {expect, test} from '@playwright/test'

test('geometry editor stores only field-verified additions as route corrections', async ({page}) => {
  await page.goto('/?debug=1#/geometry')
  await expect(page.getByRole('heading', {name: 'Pedestrian geometry corrections'})).toBeVisible()

  const map = page.locator('[data-map]')
  const box = await map.boundingBox()
  await page.getByRole('button', {name: 'Add verified path'}).click()
  await map.click({position: {x: 40, y: 60}})
  await map.click({position: {x: 240, y: 220}})
  await page.getByRole('button', {name: 'Finish path'}).click()

  await map.locator('[data-path="0"]').click()
  await page.locator('[data-verified]').check()
  await page.locator('[data-width]').fill('2.2')
  await page.getByRole('button', {name: 'Save and export corrections'}).click()

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('welcomeAR.footpathCorrections.v1')))
  expect(saved.paths).toHaveLength(1)
  expect(saved.paths[0].properties).toMatchObject({verified: true, widthM: 2.2, type: 'path'})
  expect(saved.paths[0].geometry.coordinates).toHaveLength(2)
  expect(box.width).toBeGreaterThan(0)
})

test('geometry editor is hidden without ?debug', async ({page}) => {
  await page.goto('/#/geometry')
  await expect(page.getByRole('heading', {name: 'Pedestrian geometry corrections'})).toHaveCount(0)
  await expect(page).not.toHaveURL(/#\/geometry/)
})
