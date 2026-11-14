// Item 8: the printable A5 calibration sign (148 x 210 mm, portrait), as one SVG. Used by the print
// page (/#/qr?marker=<id>) and by tools/build-signs.mjs, which writes one file per sign. Pure: it
// takes the QR code as an SVG string (qr.js qrSvg) so it runs in the browser and in Node alike.
const GREEN = '#006938'
const LIGHT = '#9fcc69'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The QR code's inner drawing (its <rect> and <path>), scaled into a box of size mm at x, y. */
function placeQr(qr, x, y, size) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(qr)
  const n = viewBox ? Number(viewBox[1]) : 100
  const inner = qr.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<g transform="translate(${x} ${y}) scale(${size / n})">${inner}</g>`
}

/**
 * @param o.marker  one entry of markers.json
 * @param o.qr      the QR code SVG for markerUrl(marker.id)
 * @param o.url     the link it holds, printed small under the code
 */
export function signSvg({marker, qr, url}) {
  const facing = Number.isFinite(marker.facingDeg)
  const steps = [
    'Scan the code with your phone’s camera.',
    facing ? 'Turn round so this sign is behind you.' : 'Stand in front of this sign.',
    'Choose where to go, then follow the arrows.',
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="148mm" height="210mm" viewBox="0 0 148 210" role="img" aria-label="${esc(`Start AR here: ${marker.label}`)}">
  <rect width="148" height="210" fill="#fff"/>
  <rect width="148" height="38" fill="${GREEN}"/>
  <g transform="translate(10 7) scale(0.38)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 46 32 36l12 10" stroke="${LIGHT}" stroke-width="6"/>
    <path d="M18 31 32 18l14 13" stroke="#fff" stroke-width="6.5"/>
  </g>
  <text x="34" y="18" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="9" font-weight="700">Start AR here</text>
  <text x="34" y="29" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="4.6">Stirling Welcome AR: arrows to anywhere on campus</text>
  <text x="74" y="52" fill="${GREEN}" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" text-anchor="middle">${esc(marker.label)}</text>
  ${placeQr(qr, 29, 58, 90)}
  <text x="74" y="154" fill="#3a3c39" font-family="Inter, Arial, sans-serif" font-size="3.6" text-anchor="middle">${esc(url)}</text>
  ${steps
    .map(
      (s, i) => `<g transform="translate(14 ${164 + i * 11})">
    <circle cx="4" cy="-1.3" r="4" fill="${GREEN}"/>
    <text x="4" y="0.2" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="4.6" font-weight="700" text-anchor="middle">${i + 1}</text>
    <text x="12" y="0.3" fill="#1d1f1c" font-family="Inter, Arial, sans-serif" font-size="4.8">${esc(s)}</text>
  </g>`,
    )
    .join('\n  ')}
  <text x="74" y="204" fill="#6b6e69" font-family="Inter, Arial, sans-serif" font-size="3" text-anchor="middle">Sign ${esc(marker.id)}${facing ? ` · faces ${marker.facingDeg}°` : ''} · mount the code centre ${marker.mountHeightM} m above the ground</text>
</svg>
`
}
