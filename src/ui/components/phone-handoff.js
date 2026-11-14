// "Open on your phone for AR": a QR code of this place's link, for a laptop or a browser without
// location or a rear camera. The code is drawn here (qrcode-generator), so nothing is fetched.
import {qrSvg} from '../screens/qr.js'
import {html, raw} from '../dom.js'

/** The link the phone opens: this site, with the place's card. Pure. */
export function handoffUrl(destId, origin = globalThis.location?.origin ?? '') {
  return destId ? `${origin}/#/?to=${encodeURIComponent(destId)}` : `${origin}/`
}

/**
 * Should the panel show? A computer (issue 'desktop'), no geolocation, or no rear camera. Not for
 * an in-app browser: the person is already on their phone and needs Safari or Chrome instead. Pure.
 */
export function needsHandoff({issueCode = null, hasGeolocation = true, cameraMissing = false} = {}) {
  if (issueCode === 'in-app-browser') return false
  return issueCode === 'desktop' || !hasGeolocation || cameraMissing
}

/** The panel. url: from handoffUrl(). */
export const phoneHandoff = (url) => html`
  <section class="handoff" aria-labelledby="handoff-title" data-handoff>
    <figure class="handoff__code" role="img" aria-label="QR code that opens this place on your phone">${raw(qrSvg(url))}</figure>
    <div class="handoff__text">
      <h2 class="handoff__title" id="handoff-title">Open on your phone for AR</h2>
      <p class="handoff__body">Scan with your phone’s camera to follow arrows on the ground. The map here still works.</p>
    </div>
  </section>
`
