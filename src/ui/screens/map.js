// 2D campus map (University MazeMap) with destination search.
// Also the fallback when AR is not available. #/map?to=<id> opens with a place selected.
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {createDestinationSearch} from '../components/destination-search.js'
import {findDestination, setCurrentDestination} from '../../nav/destinations.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {describeDestination} from '../../nav/search.js'
import {html, onAction, render} from '../dom.js'
import {CATEGORY_ICON, icon} from '../icons.js'
import {APP} from '../../config.js'

const BRAND_GREEN = '#006938'

export function mapScreen(root, {navigate, params}) {
  let instance = null
  let marker = null
  let selected = findDestination(params.to)
  let disposed = false

  render(
    root,
    html`
      <div class="map-screen">
        <h1 class="sr-only" tabindex="-1">Campus map</h1>
        <header class="map-screen__bar">
          <button class="icon-btn icon-btn--glass-light" type="button" data-action="back" aria-label="Back">
            ${icon('arrowLeft')}
          </button>
          <div class="map-screen__search" data-search></div>
        </header>
        <div class="map-screen__map" data-map role="region" aria-label="University of Stirling campus map"></div>
        <div class="map-screen__overlay" data-overlay>
          <span class="spinner spinner--dark" aria-hidden="true"></span>
          <p>Loading the University map…</p>
        </div>
        <section class="place-card" data-card hidden aria-live="polite"></section>
      </div>
    `,
  )

  const overlay = root.querySelector('[data-overlay]')
  const card = root.querySelector('[data-card]')

  const search = createDestinationSearch(root.querySelector('[data-search]'), {
    compact: true,
    label: 'Search the campus map',
    placeholder: 'Search places and rooms',
    onSelect: (dest) => select(dest),
  })

  // ---------- selected place ----------
  function select(dest) {
    selected = dest
    showCard()
    showOnMap()
  }

  function showCard() {
    if (!selected) {
      card.hidden = true
      return
    }
    const meta = describeDestination(selected)
    render(
      card,
      html`
        <div class="place-card__row">
          <span class="dsearch__badge" data-category="${selected.category}">
            ${icon(CATEGORY_ICON[selected.category] || 'pin', {size: 22})}
          </span>
          <div class="place-card__text">
            <h2 class="place-card__name">${selected.name}</h2>
            ${meta ? html`<p class="place-card__meta">${meta}</p>` : ''}
          </div>
          <button class="icon-btn place-card__close" type="button" data-action="unselect" aria-label="Close">
            ${icon('close', {size: 20})}
          </button>
        </div>
        ${selected.description ? html`<p class="place-card__desc">${selected.description}</p>` : ''}
        <button class="btn btn--primary btn--block" type="button" data-action="go" aria-label="Start AR to here">
          ${icon('camera')}<span>Start AR to here</span>
        </button>
      `,
    )
    card.hidden = false
  }

  function showOnMap() {
    const map = instance?.map
    if (!map || !selected || !Number.isFinite(selected.lat)) return
    const Mazemap = window.Mazemap
    const lngLat = {lng: selected.lng, lat: selected.lat}
    marker?.remove()
    try {
      marker = Mazemap.MazeMarker
        ? new Mazemap.MazeMarker({
            color: BRAND_GREEN,
            innerCircle: true,
            innerCircleColor: '#ffffff',
            size: 40,
            shape: 'marker',
            zLevel: selected.floor ?? undefined,
          })
        : new Mazemap.mapboxgl.Marker({color: BRAND_GREEN})
      marker.setLngLat(lngLat).addTo(map)
    } catch (err) {
      console.warn('[map] marker failed', err)
    }
    if (selected.floor != null && typeof map.setZLevel === 'function') map.setZLevel(selected.floor)
    // Leave room for the card at the bottom of the screen.
    map.flyTo({center: lngLat, zoom: selected.category === 'room' ? 19 : 17.5, padding: {bottom: 200, top: 80}, speed: 1.4})
  }

  // ---------- map loading ----------
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
          <button class="btn btn--primary btn--block" type="button" data-action="retry" aria-label="Try again">
            ${icon('refresh')}<span>Try again</span>
          </button>
          <a class="btn btn--secondary btn--block" aria-label="Open the full campus map" href="${APP.campusMapUrl}" target="_blank" rel="noopener">
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
          if (disposed) return
          overlay.hidden = true
          showOnMap()
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
    unselect: () => {
      selected = null
      marker?.remove()
      marker = null
      showCard()
    },
    go: () => {
      // First, inside the tap: iPhone only shows the motion prompt here.
      if (!deviceIssue()) startPermissionRequests()
      setCurrentDestination(selected)
      navigate(`/locate?to=${encodeURIComponent(selected.id)}`)
    },
  })
  showCard()
  load()

  return () => {
    disposed = true
    off()
    search.destroy()
    marker?.remove()
    instance?.destroy()
  }
}
