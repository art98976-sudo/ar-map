// Renders public/favicon.svg to the PNG icons iPhone and Android need.
// Run once after changing the favicon:  node scripts/make-icons.mjs
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Full-bleed square (iOS rounds the corners itself), so drop the SVG's own corner radius.
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8').replace('rx="15"', 'rx="0"')

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-512.png', 512],
]) {
  await page.setViewportSize({width: size, height: size})
  await page.setContent(
    `<style>html,body{margin:0;background:#005734}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  )
  await page.screenshot({path: join(root, 'public', file), omitBackground: false})
  console.log('wrote', file)
}
await browser.close()
