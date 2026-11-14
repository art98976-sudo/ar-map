// /#/stats (8.2): the anonymous counts, behind a passcode. The passcode is checked by the server
// (STATS_PASSCODE); this page only keeps it for this tab.
import {html, onAction, render} from '../dom.js'

const LABELS = {
  'trip-started': 'Trips started',
  'ar-started': 'AR started',
  'lineup-confirmed': 'Line-up confirmed',
  arrived: 'Arrived',
  'ended-early': 'Ended early',
  'tracking-lost': 'Tracking lost',
  rerouted: 'Re-routed',
}

// Anonymous error counts (src/stats/errors.js): page loads where each kind happened at least once.
const ERROR_LABELS = {
  js: 'Script error',
  promise: 'Unhandled promise',
  'webgl-lost': '3D graphics lost',
  camera: 'Camera failed or blocked',
  motion: 'Motion sensors blocked',
  location: 'Location failed or blocked',
  'engine-load': 'AR engine did not load',
  'ar-stopped': 'AR stopped',
}

export function statsScreen(root, {navigate}) {
  let disposed = false

  function showLock(message = '') {
    render(
      root,
      html`
        <div class="page page--narrow page--center stats">
          <h1 class="page__title" tabindex="-1">Trip counts</h1>
          <form class="stats__form" data-form>
            <label for="stats-pass">Passcode</label>
            <input id="stats-pass" class="input" type="password" autocomplete="current-password" data-pass required />
            <button class="btn btn--primary btn--block" type="submit">Show counts</button>
            ${message ? html`<p class="stats__msg" role="alert">${message}</p>` : ''}
          </form>
          <button class="btn btn--ghost" type="button" data-action="home">Back to the map</button>
        </div>
      `,
    )
    root.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault()
      load(root.querySelector('[data-pass]').value)
    })
  }

  async function load(passcode) {
    let res
    try {
      res = await fetch('/api/stats', {headers: {'x-passcode': passcode}, cache: 'no-store'})
    } catch {
      return showLock('Could not reach the server. Check your connection.')
    }
    if (disposed) return
    if (res.status === 401) return showLock('Wrong passcode.')
    if (!res.ok) return showLock('The counts could not be read. Try again later.')
    showCounts(await res.json())
  }

  function showCounts({store, counts}) {
    const rows = (prefix, names) => names.map((n) => html`<tr><th scope="row">${n.label}</th><td>${counts[prefix + n.key] ?? 0}</td></tr>`)
    render(
      root,
      html`
        <div class="page page--narrow stats">
          <h1 class="page__title" tabindex="-1">Trip counts</h1>
          ${store === 'off' ? html`<p class="stats__msg" role="status">Counting is off: no store is connected yet.</p>` : ''}
          <table class="stats__table">
            <tbody>${rows('', Object.entries(LABELS).map(([key, label]) => ({key, label})))}</tbody>
          </table>
          <h2 class="stats__sub">Phones</h2>
          <table class="stats__table">
            <tbody>${rows('device:', [{key: 'ios', label: 'iPhone'}, {key: 'android', label: 'Android'}, {key: 'other', label: 'Other'}])}</tbody>
          </table>
          <h2 class="stats__sub">Browsers</h2>
          <table class="stats__table">
            <tbody>${rows('browser:', ['safari', 'chrome', 'samsung', 'firefox', 'other'].map((key) => ({key, label: key[0].toUpperCase() + key.slice(1)})))}</tbody>
          </table>
          <h2 class="stats__sub">Errors</h2>
          <table class="stats__table">
            <tbody>${rows('error:', Object.entries(ERROR_LABELS).map(([key, label]) => ({key, label})))}</tbody>
          </table>
          <button class="btn btn--ghost" type="button" data-action="home">Back to the map</button>
        </div>
      `,
    )
  }

  const off = onAction(root, {home: () => navigate('/')})
  showLock()
  return () => {
    disposed = true
    off()
  }
}
