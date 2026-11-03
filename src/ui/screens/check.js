// Device check: runs before we ask for the camera.
// Supported: animated checklist, then continue to the camera screen.
// Not supported: a friendly explanation, "View 2D map instead", and a way onto a phone.
import {checkDevice, readBrowserEnv} from '../../ar/device.js'
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'
import {showToast} from '../components/toast.js'

const STEP_MS = 140

export function checkScreen(root, {navigate, params}) {
  const result = checkDevice(readBrowserEnv())
  // ?force=1 lets a laptop webcam run the camera test (development and demos).
  const forced = params.force === '1'
  const ok = result.status === 'supported' || (forced && result.primaryIssue?.code === 'desktop')
  const timers = []

  render(
    root,
    html`
      <div class="page page--narrow">
        <header class="page__bar">
          <button class="icon-btn" data-action="back" aria-label="Back">${icon('arrowLeft')}</button>
        </header>
        <main class="check">
          <p class="eyebrow">Getting ready</p>
          <h1 class="page__title" tabindex="-1">${ok ? 'Checking your phone' : result.primaryIssue.title}</h1>
          ${ok ? '' : html`<p class="page__lede">${result.primaryIssue.body}</p>`}

          <ul class="checklist" aria-live="polite">
            ${result.checks.map(
              (c) => html`
                <li class="checklist__item" data-state="pending" data-id="${c.id}">
                  <span class="checklist__mark">${icon(c.ok || (forced && c.id === 'motion') ? 'check' : 'close', {size: 16})}</span>
                  <span class="checklist__label">${c.label}</span>
                </li>
              `,
            )}
          </ul>

          ${ok
            ? html`<p class="check__status" data-status>Everything looks good. Opening the camera…</p>`
            : html`
                <div class="check__actions">
                  <button class="btn btn--primary btn--lg btn--block" data-action="map">
                    ${icon('map')}<span>View 2D map instead</span>
                  </button>
                  ${['desktop', 'in-app-browser'].includes(result.primaryIssue.code)
                    ? html`
                        <button class="btn btn--secondary btn--lg btn--block" data-action="copy">
                          ${icon('copy')}<span>Copy link</span>
                        </button>
                      `
                    : ''}
                </div>
                ${result.primaryIssue.code === 'desktop'
                  ? html`
                      <figure class="qr-card">
                        <canvas class="qr-card__code" data-qr width="176" height="176" aria-hidden="true"></canvas>
                        <figcaption>
                          <strong>Scan with your phone camera</strong>
                          <span>Opens this page on your phone.</span>
                        </figcaption>
                      </figure>
                      <a class="link link--muted" href="#/check?force=1${params.to ? `&to=${encodeURIComponent(params.to)}` : ''}"
                        >Try with this computer's camera</a
                      >
                    `
                  : ''}
              `}
        </main>
      </div>
    `,
  )

  // Reveal each check one after another, so the screen feels alive rather than instant.
  root.querySelectorAll('.checklist__item').forEach((item, i) => {
    const c = result.checks[i]
    timers.push(
      setTimeout(() => {
        item.dataset.state = c.ok || (forced && c.id === 'motion') ? 'ok' : 'fail'
      }, STEP_MS * (i + 1)),
    )
  })

  if (ok) {
    // Carry the chosen destination through to the camera screen.
    const next = new URLSearchParams()
    if (params.to) next.set('to', params.to)
    if (forced) next.set('force', '1')
    const query = next.toString()
    timers.push(setTimeout(() => navigate(`/ar${query ? `?${query}` : ''}`, {replace: true}), STEP_MS * 4 + 650))
  } else if (result.primaryIssue.code === 'desktop') {
    drawQr(root.querySelector('[data-qr]'))
  }

  const off = onAction(root, {
    back: () => navigate('/'),
    map: () => navigate('/map'),
    copy: async () => {
      const url = window.location.href.split('#')[0]
      try {
        await navigator.clipboard.writeText(url)
        showToast('Link copied')
      } catch {
        showToast(url, {duration: 6000})
      }
    },
  })

  return () => {
    timers.forEach(clearTimeout)
    off()
  }
}

async function drawQr(canvas) {
  if (!canvas) return
  try {
    const {default: QRCode} = await import('qrcode')
    await QRCode.toCanvas(canvas, window.location.href.split('#')[0], {
      width: 176,
      margin: 1,
      color: {dark: '#003a3dff', light: '#ffffffff'},
    })
  } catch (err) {
    console.warn('[check] QR code failed', err)
    canvas.closest('.qr-card')?.remove()
  }
}
