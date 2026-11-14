// "Open on your phone for AR": a QR code of this place's link, for a laptop or a browser without
// location or a rear camera. The code is drawn here (qrcode-generator), so nothing is fetched.
import {html} from '../dom.js'

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

/**
 * Item 10: a short, muted, looping recording of the AR view beside the QR code, on wide screens
 * only. Files on this site (media-src 'self'); the recording is supplied later, see public/media/.
 */
export const DEMO_VIDEO = {
  src: '/media/demo-ar.mp4',
  poster: '/media/demo-ar-poster.svg',
  captions: '/media/demo-ar.en-GB.vtt',
  minWidthPx: 900, // narrower (a phone): no video at all, nothing downloaded
}

const demoVideo = () => html`
  <figure class="handoff__demo" data-demo>
    <video
      class="handoff__video"
      muted
      loop
      playsinline
      preload="none"
      controls
      poster="${DEMO_VIDEO.poster}"
      data-src="${DEMO_VIDEO.src}"
      aria-describedby="handoff-demo-caption"
    >
      <track kind="captions" srclang="en-GB" label="English (UK)" src="${DEMO_VIDEO.captions}" default />
    </video>
    <figcaption class="handoff__caption" id="handoff-demo-caption">What it looks like: arrows on the path through the phone’s camera.</figcaption>
  </figure>
`

/** The panel. url: from handoffUrl(). */
export const phoneHandoff = (url) => html`
  <section class="handoff" aria-labelledby="handoff-title" data-handoff>
    <figure class="handoff__code" role="img" aria-label="QR code that opens this place on your phone" data-qr-url="${url}"></figure>
    <div class="handoff__text">
      <h2 class="handoff__title" id="handoff-title">Open on your phone for AR</h2>
      <p class="handoff__body">Scan with your phone’s camera to follow arrows on the ground. The map here still works.</p>
    </div>
    ${demoVideo()}
  </section>
`

/**
 * Draw the QR codes and wire the demo videos inside root. The QR library loads only here, so phones
 * (which never see this panel) do not download it. Returns stop().
 */
export function hydrateHandoff(root, win = globalThis.window) {
  const figures = [...(root?.querySelectorAll?.('[data-qr-url]') ?? [])]
  if (figures.length) {
    import('../screens/qr.js').then(({qrSvg}) => {
      for (const f of figures) if (f.isConnected && !f.firstChild) f.innerHTML = qrSvg(f.dataset.qrUrl)
    })
  }
  return startDemoVideos(root, win)
}

/**
 * What the demo video should do now. Pure.
 *   'none'  too narrow (a phone), or the file could not load: hidden, nothing downloaded
 *   'poster' visible but the user prefers reduced motion: the poster, with controls to play it
 *   'play' / 'pause'  visible or scrolled away
 */
export function demoState({widthPx, visible, reducedMotion, failed = false}) {
  if (failed || widthPx < DEMO_VIDEO.minWidthPx) return 'none'
  if (reducedMotion) return 'poster'
  return visible ? 'play' : 'pause'
}

/**
 * Wire the demo videos inside root: the file is only fetched once a video is on screen on a wide
 * screen; it plays while visible and pauses when scrolled away; reduced motion never autoplays.
 * Returns stop().
 */
export function startDemoVideos(root, win = globalThis.window) {
  const videos = [...(root?.querySelectorAll?.('[data-demo] video') ?? [])]
  if (!videos.length || !win) return () => {}
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const apply = (video, visible) => {
    const figure = video.closest('[data-demo]')
    const state = demoState({widthPx: win.innerWidth, visible, reducedMotion: reduced(), failed: video.dataset.failed === '1'})
    figure.hidden = state === 'none'
    if (state === 'none') return video.pause?.()
    if (!video.getAttribute('src') && (state === 'play' || state === 'poster') && visible) {
      video.src = video.dataset.src // lazy: the first time it is on screen
    }
    if (state === 'play') video.play?.()?.catch?.(() => {})
    else video.pause?.()
  }
  const observer = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver((entries) => entries.forEach((e) => apply(e.target, e.isIntersecting)), {threshold: 0.25})
    : null
  for (const video of videos) {
    video.addEventListener('error', () => {
      video.dataset.failed = '1' // no recording yet (or it failed): hide the slot, keep the QR
      apply(video, false)
    }, {once: true})
    apply(video, false)
    observer?.observe(video)
  }
  return () => observer?.disconnect()
}
