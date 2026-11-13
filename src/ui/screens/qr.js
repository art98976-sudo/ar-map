// /#/qr?to=<id> (Group D): a QR code and the short link for one place, to print on a poster at a
// room or an entrance. Scanning it opens the place's card with Go ready: one tap to the arrows.
import qrcode from 'qrcode-generator'
import {findDestination} from '../../map/destinations.js'
import {fetchPoiDestination, poiIdFrom} from '../../map/poi-lookup.js'
import {showToast} from '../components/toast.js'
import {focusScreen, html, onAction, raw, render} from '../dom.js'
import {icon} from '../icons.js'

/** The short link printed under the code: /p/<id> opens the card with Go focused. */
export function shortLink(id, origin = globalThis.location?.origin ?? '') {
  return `${origin}/p/${encodeURIComponent(id)}`
}

/** The QR code as an SVG string. Error correction M: a scuffed poster still scans. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({cellSize: 8, margin: 4, scalable: true})
}

export function qrScreen(root, {navigate, params}) {
  let disposed = false
  const id = params.to ?? ''

  function show(dest) {
    const link = shortLink(dest.id)
    render(
      root,
      html`
        <div class="page page--narrow page--center qr-page">
          <h1 class="page__title" tabindex="-1">${dest.name}</h1>
          ${dest.building && dest.building !== dest.name ? html`<p class="page__lede">${dest.building}</p>` : ''}
          <figure class="qr-page__code" aria-label="QR code for ${dest.name}">${raw(qrSvg(link))}</figure>
          <p class="qr-page__hint">Scan to walk here with arrows on the ground</p>
          <p class="qr-page__link" data-qr-link>${link}</p>
          <div class="qr-page__actions">
            <button class="btn btn--primary btn--block" type="button" data-action="copy">${icon('copy')}<span>Copy link</span></button>
            <button class="btn btn--secondary btn--block" type="button" data-action="print">${icon('external')}<span>Print</span></button>
            <button class="btn btn--ghost" type="button" data-action="home">Back to the map</button>
          </div>
        </div>
      `,
    )
    focusScreen(root)
  }

  function showMissing() {
    render(
      root,
      html`
        <div class="page page--narrow page--center qr-page">
          <h1 class="page__title" tabindex="-1">We couldn’t find that place</h1>
          <p class="page__lede">Open a place on the map, then add its id to /#/qr?to=</p>
          <button class="btn btn--primary btn--block" type="button" data-action="home">Back to the map</button>
        </div>
      `,
    )
    focusScreen(root)
  }

  const off = onAction(root, {
    home: () => navigate('/'),
    print: () => window.print(),
    copy: async () => {
      const link = root.querySelector('[data-qr-link]')?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(link)
        showToast('Link copied')
      } catch {
        showToast(link, {duration: 6000})
      }
    },
  })

  const known = findDestination(id)
  if (known) show(known)
  else if (poiIdFrom(id)) {
    render(root, html`<div class="page page--narrow page--center"><p role="status">Finding the place…</p></div>`)
    fetchPoiDestination(poiIdFrom(id))
      .then((dest) => !disposed && (dest ? show(dest) : showMissing()))
      .catch(() => !disposed && showMissing())
  } else showMissing()

  return () => {
    disposed = true
    off()
  }
}
