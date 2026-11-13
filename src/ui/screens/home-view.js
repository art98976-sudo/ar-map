// The home screen's HTML: the page, the card for the chosen place, the door list and the map error.
import {infoSheetContent} from '../components/info-sheet.js'
import {categoryLabel, QUICK_CHIPS} from '../../map/filters.js'
import {describeDestination} from '../../map/search.js'
import {subtitleFor} from '../../route/card-text.js'
import {entrancesOf} from '../../route/start-point.js'
import {html} from '../dom.js'
import {icon} from '../icons.js'
import {APP} from '../../config.js'

export const homePage = () => html`
  <div class="map-home">
    <h1 class="sr-only" tabindex="-1">Campus map</h1>
    <div class="map-home__map" data-map role="region" aria-label="University of Stirling campus map"></div>
    <header class="map-home__top theme-auto">
      <button class="map-search" type="button" data-action="open-search" aria-label="Search rooms, buildings, places">
        ${icon('search', {size: 24})}<span>Search rooms, buildings, places</span>
      </button>
    </header>
    <div class="map-rail theme-auto" data-rail>
      <div class="map-rail__floors" data-floor-host></div>
      <button class="round-btn map-3d" type="button" data-action="toggle-3d" aria-pressed="false" aria-label="Show 3D buildings">
        <span data-3d-label>3D</span><span class="spinner map-3d__spinner" data-3d-spinner aria-hidden="true" hidden></span>
      </button>
      <button class="round-btn" type="button" data-action="locate" aria-label="Show my location">${icon('locate')}</button>
      <button class="round-btn" type="button" data-action="north" aria-label="Turn the map north up" data-north hidden>${icon('north')}</button>
    </div>
    <div class="map-home__overlay theme-auto" data-overlay>${mapLoading()}</div>
    <section class="home-sheet theme-auto" data-home-sheet data-height="peek" aria-label="Places">
      <button class="home-sheet__handle" type="button" data-action="sheet-step" aria-label="Show more" aria-expanded="false">
        <span aria-hidden="true"></span>
      </button>
      <div class="home-sheet__peek">
        <div class="quick-chips" role="group" aria-label="Find on the map">
          ${QUICK_CHIPS.map(
            (c) => html`
              <button class="quick-chip" type="button" data-action="filter" data-filter="${c.id}" aria-pressed="false">
                ${icon(c.icon, {size: 20})}<span>${c.label}</span>
              </button>
            `,
          )}
        </div>
        <button class="round-btn round-btn--flat" type="button" data-action="open-menu" aria-label="More" aria-haspopup="menu" aria-expanded="false">${icon('menu')}</button>
        <div class="home-menu" data-menu role="menu" hidden>
          <button class="home-menu__item" type="button" role="menuitem" data-action="open-info">${icon('info', {size: 20})}<span>About and privacy</span></button>
        </div>
      </div>
      <div class="home-sheet__body" data-chip-results aria-live="polite"></div>
    </section>
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

/** Grey blocks in the shape of what is coming, instead of a blank screen or a lone spinner. */
export const mapLoading = () => html`<div class="skeleton" aria-hidden="true">
    <span class="skeleton__bar"></span>
    <span class="skeleton__rail"></span>
    <span class="skeleton__sheet"><span></span><span></span><span></span></span>
  </div>
  <p class="sr-only" role="status">Loading the University map…</p>`

/** One row of the quick-chip results: what it is, where, how far. */
export const placeRow = (place, i) => html`
  <li>
    <button class="place-row" type="button" data-result="${i}">
      <span class="place-row__icon">${icon(place.icon, {size: 20})}</span>
      <span class="place-row__text"><strong>${place.name}</strong><span>${place.detail}</span></span>
    </button>
  </li>
`

export const chipResults = (title, places, note = '') => html`
  <h2 class="home-sheet__title">${title}</h2>
  ${note ? html`<p class="home-sheet__note">${note}</p>` : ''}
  <ul class="place-list">${places.map((p, i) => placeRow(p, i))}</ul>
`

export const chipLoading = (title) => html`
  <h2 class="home-sheet__title">${title}</h2>
  <ul class="place-list" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<li class="place-row place-row--skeleton"><span></span><span></span></li>`)}</ul>
  <p class="sr-only" role="status">Loading…</p>
`

/** While a linked room is looked up on MazeMap: the card's shape, not a lone spinner. */
export function placeLoading() {
  return html`
    <div class="dest-sheet__head" aria-busy="true">
      <div class="dest-sheet__text">
        <p class="route-from__label">To</p>
        <h2 class="dest-sheet__name" tabindex="-1">Finding the place…</h2>
        <p class="dest-sheet__meta"><span class="skeleton-line" aria-hidden="true"></span></p>
      </div>
    </div>
    <p class="sr-only" role="status">Finding the place on the campus map</p>
  `
}

/** A link to a place that does not exist (or could not be loaded). */
export function placeNotFound(text = 'We couldn’t find that place') {
  return html`
    <div class="dest-sheet__head">
      <div class="dest-sheet__text">
        <h2 class="dest-sheet__name" tabindex="-1" role="alert">${text}</h2>
        <p class="dest-sheet__meta">Search for it by name or room number.</p>
      </div>
      <button class="icon-btn" type="button" data-action="unselect" aria-label="Close">${icon('close', {size: 20})}</button>
    </div>
    <button class="btn btn--primary btn--block" type="button" data-action="open-search">${icon('search')}<span>Search</span></button>
  `
}

export function placeCard(place, walkText, {stepFree = false} = {}) {
  const room = place.category === 'room' ? describeDestination(place) : ''
  // Never repeat the name underneath it ("Library" / "Library").
  const subtitle = subtitleFor(place.name, room || categoryLabel(place.category))
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
    <p class="route-approx" data-approx hidden>${icon('alert', {size: 16})}<span>Location is approximate</span></p>
    <div class="dest-sheet__head">
      <div class="dest-sheet__text">
        <p class="route-from__label">To</p>
        <h2 class="dest-sheet__name" tabindex="-1">${place.name}</h2>
        ${subtitle ? html`<p class="dest-sheet__meta">${subtitle}</p>` : ''}
        <p class="dest-sheet__walk" data-walk>${icon('footsteps', {size: 16})}<span data-walk-text>${walkText}</span></p>
        <p class="dest-sheet__indoor" data-indoor hidden>${icon('door', {size: 16})}<span data-indoor-text></span></p>
        <p class="dest-sheet__indoor" data-stairs hidden>${icon('lift', {size: 16})}<span>Stairs or lift needed</span></p>
        <label class="step-free">
          <input type="checkbox" role="switch" data-step-free ${stepFree ? 'checked' : ''} />
          <span>Step-free route</span>
        </label>
        <p class="dest-sheet__indoor" data-step-free-note ${stepFree ? '' : 'hidden'}>${icon('check', {size: 16})}<span>Step-free: no stairs on this route</span></p>
      </div>
      <button class="icon-btn" type="button" data-action="unselect" aria-label="Close">${icon('close', {size: 20})}</button>
    </div>
    <button class="btn btn--primary btn--block" type="button" data-action="show-way" hidden>${icon('map')}<span>Show the way</span></button>
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
