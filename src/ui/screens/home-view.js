// The home screen's HTML: the page, the card for the chosen place, the door list and the map error.
import {infoSheetContent} from '../components/info-sheet.js'
import {categoryLabel, MAP_FILTERS} from '../../map/filters.js'
import {describeDestination} from '../../map/search.js'
import {entrancesOf} from '../../route/start-point.js'
import {html} from '../dom.js'
import {icon} from '../icons.js'
import {APP} from '../../config.js'

export const homePage = () => html`
  <div class="map-home">
    <h1 class="sr-only" tabindex="-1">Campus map</h1>
    <div class="map-home__map" data-map role="region" aria-label="University of Stirling campus map"></div>
    <header class="map-home__top">
      <div class="map-home__row">
        <button class="map-search" type="button" data-action="open-search" aria-label="Where do you want to go?">
          ${icon('search', {size: 20})}<span>Where do you want to go?</span>
        </button>
        <button class="icon-btn icon-btn--glass-light" type="button" data-action="open-info" aria-label="About and privacy">${icon('info')}</button>
      </div>
      <div class="map-chips" role="group" aria-label="Filter the map">
        ${MAP_FILTERS.map(
          (f) => html`
            <button class="map-chip" type="button" data-action="filter" data-filter="${f.id}" aria-pressed="false">
              ${icon(f.icon, {size: 18})}<span>${f.label}</span>
            </button>
          `,
        )}
      </div>
    </header>
    <div class="map-home__overlay" data-overlay>
      <span class="spinner spinner--dark" aria-hidden="true"></span>
      <p>Loading the University map…</p>
    </div>
    <section class="dest-sheet" data-card hidden aria-live="polite" aria-label="Selected place"></section>

    <section class="pick-bar" data-pick-bar aria-label="Pick your start on the map" hidden>
      <p class="pick-bar__text" data-pick-text role="status">Tap the map or drag the pin to where you are.</p>
      <button class="btn btn--primary btn--block" type="button" data-action="pick-confirm" disabled>Confirm start here</button>
      <button class="btn btn--ghost" type="button" data-action="pick-cancel">Cancel</button>
    </section>

    <div class="sheet" data-start-sheet role="dialog" aria-modal="true" aria-labelledby="start-title" hidden>
      <header class="sheet__bar">
        <h2 class="sheet__title" id="start-title" tabindex="-1">Where are you starting from?</h2>
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="Close starting point">${icon('close')}</button>
      </header>
      <div data-start-choices>
        <div class="start-options">
          <button class="start-option" type="button" data-action="start-gps">
            <span class="start-option__icon">${icon('compass')}</span>
            <span class="start-option__text"><strong>Current location</strong><span data-start-gps-text>Use GPS</span></span>
          </button>
          <button class="start-option" type="button" data-action="start-pick">
            <span class="start-option__icon">${icon('map')}</span>
            <span class="start-option__text"><strong>Pick on map</strong><span>Tap or drag a pin to where you are</span></span>
          </button>
        </div>
        <div data-start-search></div>
      </div>
      <div class="start-doors" data-start-doors hidden></div>
    </div>

    <div class="sheet" data-search-sheet role="dialog" aria-modal="true" aria-labelledby="search-title" hidden>
      <header class="sheet__bar">
        <h2 class="sheet__title" id="search-title">Where do you want to go?</h2>
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="Close search">${icon('close')}</button>
      </header>
      <div data-search></div>
    </div>

    <div class="sheet" data-info-sheet role="dialog" aria-modal="true" aria-labelledby="info-title" hidden>
      <header class="sheet__bar sheet__bar--end">
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="Close about">${icon('close')}</button>
      </header>
      ${infoSheetContent()}
    </div>
  </div>
`

export const mapLoading = () => html`<span class="spinner spinner--dark" aria-hidden="true"></span>
  <p>Loading the University map…</p>`

export function placeCard(place, walkText) {
  const room = place.category === 'room' ? describeDestination(place) : ''
  return html`
    ${place.photo ? html`<img class="dest-sheet__photo" src="${place.photo}" alt="" loading="lazy" />` : ''}
    <div class="route-from">
      <button class="route-from__row" type="button" data-action="open-start">
        <span class="route-from__label">From</span>
        <span class="route-from__value" data-start-text></span>
        ${icon('chevronRight', {size: 18})}
      </button>
      <button class="icon-btn" type="button" data-action="swap" aria-label="Swap start and destination">${icon('swap', {size: 20})}</button>
    </div>
    <p class="route-prompt" data-start-prompt hidden>
      We can't find you precisely.
      <button class="dest-sheet__link" type="button" data-action="open-start">Choose your starting point instead</button>
    </p>
    <button class="dest-sheet__link" type="button" data-action="start-gps" data-live hidden>Switch to live location?</button>
    <div class="dest-sheet__head">
      <div class="dest-sheet__text">
        <p class="route-from__label">To</p>
        <h2 class="dest-sheet__name" tabindex="-1">${place.name}</h2>
        <p class="dest-sheet__meta">${room || categoryLabel(place.category)}</p>
        <p class="dest-sheet__walk" data-walk>${icon('footsteps', {size: 16})}<span data-walk-text>${walkText}</span></p>
      </div>
      <button class="icon-btn" type="button" data-action="unselect" aria-label="Close">${icon('close', {size: 20})}</button>
    </div>
    <button class="btn btn--primary btn--block" type="button" data-action="walk" aria-label="Walk here in AR">
      ${icon('camera')}<span>Walk here in AR</span>
    </button>
    <button class="dest-sheet__link" type="button" data-action="route" aria-expanded="false" data-route-link>Show route on map</button>
  `
}

export const doorList = (place) => html`
    <h3 class="start-doors__title" tabindex="-1">Which entrance of ${place.name}?</h3>
    ${entrancesOf(place).map(
      (door) => html`
        <button class="start-option" type="button" data-action="start-door" data-door="${door.id}">
          <span class="start-option__icon">${icon('door')}</span>
          <span class="start-option__text"><strong>${door.name}</strong></span>
        </button>
      `,
    )}
`

export const mapError = (offline) => html`
    <div class="map-home__error" role="alert">
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
`
