// Item 8: write one printable A5 SVG per calibration sign (src/data/markers.json) into docs/signs/,
// with the QR code for its /c/<id> link. Run after changing the markers: node tools/build-signs.mjs
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import qrcode from 'qrcode-generator'
import {signSvg} from '../src/ui/sign.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://stirling-welcome-ar.vercel.app' // as SITE in src/route/markers.js
const {markers} = JSON.parse(readFileSync(join(root, 'src', 'data', 'markers.json'), 'utf8'))
const out = join(root, 'docs', 'signs')
mkdirSync(out, {recursive: true})

for (const marker of markers) {
  const url = `${SITE}/c/${encodeURIComponent(marker.id)}`
  const qr = qrcode(0, 'M') // as qrSvg in src/ui/screens/qr.js: a scuffed sign still scans
  qr.addData(url)
  qr.make()
  const file = join(out, `sign-${marker.id}.svg`)
  writeFileSync(file, signSvg({marker, qr: qr.createSvgTag({cellSize: 8, margin: 4, scalable: true}), url}))
  console.log('wrote', file)
}
