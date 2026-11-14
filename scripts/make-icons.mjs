// Renders public/favicon.svg to the PNG icons iPhone and Android need.
// Run once after changing the favicon:  node scripts/make-icons.mjs
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Full-bleed square (iOS rounds the corners itself), so drop the SVG's own corner radius.
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8').replace('rx="15"', 'rx="0"')

// Maskable (Android crops it to a circle, squircle...): the same artwork with the chevrons shrunk
// to 80% around the centre, so they sit well inside the safe zone (the middle circle, 80% across).
const maskable = svg.replace('<path', '<g transform="translate(32 32) scale(0.8) translate(-32 -32)"><path').replace('</svg>', '</g></svg>')

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, art] of [
  ['apple-touch-icon.png', 180, svg],
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
]) {
  await page.setViewportSize({width: size, height: size})
  await page.setContent(
    `<style>html,body{margin:0;background:#005734}svg{width:${size}px;height:${size}px;display:block}</style>${art}`,
  )
  await page.screenshot({path: join(root, 'public', file), omitBackground: false})
  console.log('wrote', file)
}
await browser.close()
