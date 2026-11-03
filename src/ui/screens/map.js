// 2D campus map (University MazeMap). Used as the fallback when AR is not available.
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'
import {APP} from '../../config.js'

export function mapScreen(root, {navigate}) {
  let instance = null
  let disposed = false

  render(
    root,
    html`
      <div class="map-screen">
        <header class="map-screen__bar">
          <button class="icon-btn icon-btn--glass-light" data-action="back" aria-label="Back">${icon('arrowLeft')}</button>
          <div class="map-screen__title">
            <h1 tabindex="-1">Campus map</h1>
            <p>Pinch to zoom. Zoom in on a building to see its floors.</p>
          </div>
        </header>
        <div class="map-screen__map" data-map role="region" aria-label="University of Stirling campus map"></div>
        <div class="map-screen__overlay" data-overlay>
          <span class="spinner spinner--dark" aria-hidden="true"></span>
          <p>Loading the University map…</p>
        </div>
      </div>
    `,
  )

  const overlay = root.querySelector('[data-overlay]')

  function showError(err) {
    if (disposed) return
    const offline = err?.code === 'offline' || navigator.onLine === false
    overlay.hidden = false
    render(
      overlay,
      html`
        <div class="map-screen__error">
          <span class="error-state__icon" data-tone="warn">${icon(offline ? 'wifiOff' : 'map', {size: 28})}</span>
          <h2>${offline ? 'You are offline' : 'The map could not load'}</h2>
          <p>${offline ? 'Connect to Wi-Fi or mobile data and try again.' : 'Check your connection and try again.'}</p>
          <button class="btn btn--primary btn--block" data-action="retry">${icon('refresh')}<span>Try again</span></button>
          <a class="btn btn--secondary btn--block" href="${APP.campusMapUrl}" target="_blank" rel="noopener">
            ${icon('external')}<span>Open the full campus map</span>
          </a>
        </div>
      `,
    )
  }

  async function load() {
    render(
      overlay,
      html`<span class="spinner spinner--dark" aria-hidden="true"></span>
        <p>Loading the University map…</p>`,
    )
    overlay.hidden = false
    try {
      const Mazemap = await loadMazeMap()
      if (disposed) return
      instance?.destroy()
      instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
        onReady: () => {
          if (!disposed) overlay.hidden = true
        },
      })
    } catch (err) {
      console.warn('[map] load failed', err)
      showError(err)
    }
  }

  const off = onAction(root, {
    back: () => (window.history.length > 1 ? window.history.back() : navigate('/')),
    retry: () => load(),
  })
  load()

  return () => {
    disposed = true
    off()
    instance?.destroy()
  }
}
