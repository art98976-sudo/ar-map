// The home screen's HTML: the page, the card for the chosen place, the door list and the map error.
import {infoSheetContent} from '../components/info-sheet.js'
import {categoryLabel, QUICK_CHIPS} from '../../map/filters.js'
import {describeDestination} from '../../map/search.js'
import {subtitleFor} from '../../route/card-text.js'
import {entrancesOf} from '../../route/start-point.js'
import {html} from '../dom.js'
import {icon, iconFor} from '../icons.js'
import {THEMES} from '../theme.js'
import {APP} from '../../config.js'
import {getLocale, LOCALES, SOURCE_LOCALE, t} from '../../i18n/i18n.js'
import EN from '../../i18n/en-GB.js'

// Group C: four chips at rest (Lecture theatres, Toilets, Food, Library), the rest behind "More".
const MAIN_CHIPS = 4

export const homePage = () => html`
  <div class="map-home">
    <h1 class="sr-only" tabindex="-1">${t('home.heading')}</h1>
    <div class="map-home__map" data-map role="region" aria-label="${t('home.mapRegion')}"></div>
    <header class="map-home__top theme-auto">
      <button class="map-search" type="button" data-action="open-search" aria-label="${t('home.search')}">
        ${icon('search', {size: 24})}<span>${t('home.search')}</span>
      </button>
      <!-- Group C: one menu holds 3D, north, the floors, and About. -->
      <button class="round-btn map-menu-btn" type="button" data-action="open-menu" aria-label="${t('home.menu')}" aria-haspopup="menu" aria-expanded="false">${icon('menu')}</button>
      <div class="home-menu" data-menu role="menu" hidden>
        <button class="home-menu__item map-3d" type="button" role="menuitem" data-action="toggle-3d" aria-pressed="false" aria-label="${t('home.show3d')}">
          ${icon('building', {size: 20})}<span>${t('home.buildingsIn')} <span data-3d-label>${t('home.mode3d')}</span></span><span class="spinner map-3d__spinner" data-3d-spinner aria-hidden="true" hidden></span>
        </button>
        <button class="home-menu__item" type="button" role="menuitem" data-action="north" aria-label="${t('home.northLabel')}" data-north hidden>${icon('north', {size: 20})}<span>${t('home.north')}</span></button>
        <div class="home-menu__floors" data-floor-host aria-label="${t('home.floor')}"></div>
        <button class="home-menu__item" type="button" role="menuitemcheckbox" aria-checked="false" data-action="toggle-voice" data-voice hidden>${icon('volume', {size: 20})}<span>${t('home.voice')}</span></button>
        <div class="home-menu__themes" role="group" aria-label="${t('home.themes')}" data-themes>
          ${THEMES.map((t) => html`<button class="home-menu__item home-menu__theme" type="button" role="menuitemradio" aria-checked="false" data-action="set-theme" data-theme-choice="${t.id}">${icon(t.id === 'dark' ? 'moon' : t.id === 'light' ? 'sun' : 'phone', {size: 20})}<span>${t.label}</span></button>`)}
        </div>
        <!-- Item 13: the language, each in its own name, remembered on this device only. -->
        <div class="home-menu__themes home-menu__langs" role="group" aria-label="${t('lang.group')}" data-langs>
          ${LOCALES.map((l) => html`<button class="home-menu__item home-menu__theme" type="button" role="menuitemradio" aria-checked="${l.id === getLocale().id ? 'true' : 'false'}" data-action="set-locale" data-locale-choice="${l.id}" lang="${l.id}" dir="${l.dir}">${icon('globe', {size: 20})}<span>${l.label}</span></button>`)}
        </div>
        <button class="home-menu__item" type="button" role="menuitem" data-action="open-info">${icon('info', {size: 20})}<span>${t('home.about')}</span></button>
        <p class="home-menu__note" role="none">${t('home.menuNote')}</p>
      </div>
    </header>
    <div class="map-rail theme-auto" data-rail>
      <button class="round-btn" type="button" data-action="locate" aria-label="${t('home.locate')}">${icon('locate')}</button>
    </div>
    <div class="map-home__overlay theme-auto" data-overlay>${mapLoading()}</div>
    <section class="home-sheet theme-auto" data-home-sheet data-height="peek" aria-label="${t('home.places')}">
      <button class="home-sheet__handle" type="button" data-action="sheet-step" aria-label="${t('home.showMore')}" aria-expanded="false">
        <span aria-hidden="true"></span>
      </button>
      <div class="home-sheet__peek">
        <div class="quick-chips" role="group" aria-label="${t('home.findOnMap')}">
          ${QUICK_CHIPS.map(
            (c, i) => html`
              <button class="quick-chip" type="button" data-action="filter" data-filter="${c.id}" aria-pressed="false" ${i >= MAIN_CHIPS ? 'data-extra-chip hidden' : ''}>
                ${icon(c.icon, {size: 20})}<span>${c.label}</span>
              </button>
            `,
          )}
          <button class="quick-chip" type="button" data-action="more-chips" aria-expanded="false">${icon('menu', {size: 20})}<span>${t('home.more')}</span></button>
        </div>
        <!-- At rest: the nearest toilet, café and lift, and the last 3 places (home-sheet.js). -->
        <div class="home-rest" data-rest></div>
      </div>
      <div class="home-sheet__body" data-chip-results aria-live="polite"></div>
    </section>
    <section class="dest-sheet theme-auto" data-card hidden aria-live="polite" aria-label="${t('home.selected')}"></section>
    <section class="map-trip theme-auto" data-map-trip hidden aria-label="${t('home.tripRegion')}"></section>

    <section class="pick-bar" data-pick-bar aria-label="${t('home.pickRegion')}" hidden>
      <p class="pick-bar__text" data-pick-text role="status">${t('home.pickText')}</p>
      <button class="btn btn--primary btn--block" type="button" data-action="pick-confirm" disabled>${t('home.pickConfirm')}</button>
      <button class="btn btn--ghost" type="button" data-action="pick-cancel">${t('common.cancel')}</button>
    </section>

    <div class="sheet theme-auto" data-start-sheet role="dialog" aria-modal="true" aria-labelledby="start-title" aria-describedby="start-note" hidden>
      <header class="sheet__bar">
        <h2 class="sheet__title" id="start-title" tabindex="-1">${t('start.title')}</h2>
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="${t('start.close')}">${icon('close')}</button>
      </header>
      <p class="start-note" id="start-note" data-start-note role="status" hidden></p>
      <div data-start-choices>
        <div class="start-options">
          <button class="start-option" type="button" data-action="start-gps">
            <span class="start-option__icon">${icon('compass')}</span>
            <span class="start-option__text"><strong>${t('start.gps')}</strong><span data-start-gps-text>${t('start.useGps')}</span></span>
          </button>
          <button class="start-option" type="button" data-action="start-pick">
            <span class="start-option__icon">${icon('map')}</span>
            <span class="start-option__text"><strong>${t('start.pick')}</strong><span>${t('start.pickHint')}</span></span>
          </button>
        </div>
        <div data-start-search></div>
      </div>
      <div class="start-doors" data-start-doors hidden></div>
    </div>

    <div class="sheet theme-auto" data-search-sheet role="dialog" aria-modal="true" aria-labelledby="search-title" hidden>
      <header class="sheet__bar">
        <h2 class="sheet__title" id="search-title">${t('search.title')}</h2>
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="${t('search.close')}">${icon('close')}</button>
      </header>
      <div data-search></div>
    </div>

    <div class="sheet theme-auto" data-info-sheet role="dialog" aria-modal="true" aria-labelledby="info-title" hidden>
      <header class="sheet__bar sheet__bar--end">
        <button class="icon-btn" type="button" data-action="close-sheets" aria-label="${t('about.close')}">${icon('close')}</button>
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
  <p class="sr-only" role="status">${t('home.loadingMap')}</p>`

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
  <p class="sr-only" role="status">${t('common.loading')}</p>
`

/** While a linked room is looked up on MazeMap: the card's shape, not a lone spinner. */
export function placeLoading() {
  return html`
    <div class="dest-sheet__head" aria-busy="true">
      <div class="dest-sheet__text">
        <p class="route-from__label">${t('card.to')}</p>
        <h2 class="dest-sheet__name" tabindex="-1">${t('card.loading')}</h2>
        <p class="dest-sheet__meta"><span class="skeleton-line" aria-hidden="true"></span></p>
      </div>
    </div>
    <p class="sr-only" role="status">${t('card.loadingStatus')}</p>
  `
}

/** A link to a place that does not exist (or could not be loaded). */
export function placeNotFound(text = t('card.notFound')) {
  return html`
    <div class="dest-sheet__head">
      <div class="dest-sheet__text">
        <h2 class="dest-sheet__name" tabindex="-1" role="alert">${text}</h2>
        <p class="dest-sheet__meta">${t('card.searchHint')}</p>
      </div>
      <button class="icon-btn" type="button" data-action="unselect" aria-label="${t('common.close')}">${icon('close', {size: 20})}</button>
    </div>
    <button class="btn btn--primary btn--block" type="button" data-action="open-search">${icon('search')}<span>${t('common.search')}</span></button>
  `
}

export function placeCard(place, walkText, {stepFree = false, arIssue = null, handoff = null, savedIn = null, groups = []} = {}) {
  const room = place.category === 'room' ? describeDestination(place) : ''
  // Never repeat the name underneath it ("Library" / "Library").
  let subtitle = subtitleFor(place.name, room || categoryLabel(place.category))
  // Item 4 (round 4): in another language, a category that only translates the name (Arabic
  // "المكتبة" under "Library") is the name's translation: a smaller line under the English
  // name, which stays first, as on the campus signs.
  const locale = getLocale()
  const english = !room && EN[`cat.${place.category}`]
  const translation = locale.id !== SOURCE_LOCALE && english && english.toLowerCase() === String(place.name).toLowerCase() && subtitle ? subtitle : null
  if (translation) subtitle = ''
  return html`
    ${place.photo ? html`<img class="dest-sheet__photo" src="${place.photo}" alt="" loading="lazy" />` : ''}
    <!-- One line, "From my location · Options": the start, swap and step-free fold inside it. -->
    <button class="route-options" type="button" data-action="toggle-options" aria-expanded="false" aria-controls="route-options">
      <span class="route-options__from">${t('card.from')} <span data-start-text>${t('start.myLocation')}</span></span>
      <span class="route-options__more">${t('card.options')} ${icon('chevronRight', {size: 16, className: 'route-options__chev'})}</span>
    </button>
    <div class="route-options__panel" id="route-options" data-options hidden>
      <div class="route-from">
        <button class="route-from__row" type="button" data-action="open-start">
          <span class="route-from__label">${t('card.from')}</span>
          <span class="route-from__value" data-start-value></span>
          ${icon('chevronRight', {size: 18})}
        </button>
        <button class="icon-btn" type="button" data-action="swap" aria-label="${t('card.swap')}">${icon('swap', {size: 20})}</button>
      </div>
      <label class="step-free">
        <input type="checkbox" role="switch" data-step-free ${stepFree ? 'checked' : ''} />
        <span>${t('card.stepFree')}</span>
      </label>
    </div>
    <p class="route-prompt" data-start-prompt hidden>
      ${t('card.cantFind')}
      <button class="dest-sheet__link" type="button" data-action="open-start">${t('card.chooseStart')}</button>
    </p>
    <button class="dest-sheet__link" type="button" data-action="start-gps" data-live hidden>${t('card.live')}</button>
    <p class="route-approx" data-approx hidden>${icon('alert', {size: 16})}<span>${t('card.approx')}</span></p>
    <div class="dest-sheet__head">
      <div class="dest-sheet__text">
        <p class="route-from__label">${t('card.to')}</p>
        <h2 class="dest-sheet__name" tabindex="-1"><bdi lang="en">${place.name}</bdi></h2>
        ${translation ? html`<p class="dest-sheet__translation" lang="${locale.id}" dir="${locale.dir}">${translation}</p>` : ''}
        ${subtitle ? html`<p class="dest-sheet__meta">${subtitle}</p>` : ''}
        <p class="dest-sheet__walk" data-walk>${icon('footsteps', {size: 16})}<span data-walk-text>${walkText}</span></p>
        <p class="dest-sheet__indoor" data-indoor hidden>${icon('door', {size: 16})}<span data-indoor-text></span></p>
        <p class="dest-sheet__indoor" data-stairs hidden>${icon('lift', {size: 16})}<span>${t('card.stairs')}</span></p>
        <p class="dest-sheet__indoor" data-step-free-note ${stepFree ? '' : 'hidden'}>${icon('check', {size: 16})}<span>${t('card.stepFreeNote')}</span></p>
      </div>
      <div class="dest-sheet__tools">
        <button class="icon-btn dest-sheet__save" type="button" data-action="save" data-save aria-pressed="${savedIn ? 'true' : 'false'}" aria-label="${t('card.save', {name: place.name})}" aria-expanded="false" aria-controls="save-groups">${icon('star', {size: 20})}</button>
        <button class="icon-btn" type="button" data-action="share" aria-label="${t('card.share', {name: place.name})}">${icon('share', {size: 20})}</button>
        <button class="icon-btn" type="button" data-action="unselect" aria-label="${t('common.close')}">${icon('close', {size: 20})}</button>
      </div>
    </div>
    <div class="save-groups" id="save-groups" role="group" aria-label="${t('card.saveTo')}" data-save-groups hidden>
      ${groups.map((g) => html`<button class="chip" type="button" data-action="save-to" data-group="${g.id}">${g.label}</button>`)}
    </div>
    <button class="btn btn--primary btn--block" type="button" data-action="show-way" hidden>${icon('map')}<span>${t('card.showWay')}</span></button>
    <!-- A phone that runs AR: "Walk with AR" first, "Map directions" under it. A phone or browser
         without AR: one button, the map trip. data-go is always the first (primary) button. -->
    <div class="dest-sheet__actions" data-go-actions>
      ${arIssue
        ? html`<button class="btn btn--primary btn--lg btn--block dest-sheet__go" type="button" data-action="map-trip" data-go data-ar-choice data-go-map>
            ${icon('map')}<span>${t('card.go')}</span>
          </button>`
        : html`<button class="btn btn--primary btn--lg btn--block dest-sheet__go" type="button" data-action="walk" data-go data-ar-choice>
              ${icon('arrive')}<span>${t('card.walkAr')}</span>
            </button>
            <button class="btn btn--secondary btn--block dest-sheet__map" type="button" data-action="map-trip" data-map-directions>
              ${icon('map')}<span>${t('card.mapDirections')}</span>
            </button>`}
    </div>
    ${handoff ?? ''}
  `
}

export const doorList = (place) => html`
    <h3 class="start-doors__title" tabindex="-1">${t('start.whichEntrance', {name: place.name})}</h3>
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
      <h2>${t(offline ? 'home.mapOffline' : 'home.mapFailed')}</h2>
      <p>${t(offline ? 'home.mapOfflineBody' : 'home.mapFailedBody')}</p>
      <button class="btn btn--primary btn--block" type="button" data-action="retry" aria-label="${t('common.tryAgain')}">
        ${icon('refresh')}<span>${t('common.tryAgain')}</span>
      </button>
      <a class="btn btn--secondary btn--block" aria-label="${t('home.fullMap')}" href="${APP.campusMapUrl}" target="_blank" rel="noopener">
        ${icon('external')}<span>${t('home.fullMap')}</span>
      </a>
    </div>
`

/** The map's WebGL context was lost and not given back: a black or frozen map otherwise. */
export const mapLost = () => html`
    <div class="map-home__error" role="alert">
      <span class="error-state__icon" data-tone="warn">${icon('map', {size: 28})}</span>
      <h2>${t('home.mapStopped')}</h2>
      <p>${t('home.mapStoppedBody')}</p>
      <button class="btn btn--primary btn--block" type="button" data-action="retry" data-autofocus>
        ${icon('refresh')}<span>${t('home.mapReload')}</span>
      </button>
    </div>
`

/** The sheet at rest (Group C): three "Nearest" shortcuts, the saved places (item 12), then the last 3 places. */
export const restView = (recent, saved = []) => html`
  <div class="home-rest__nearest" role="group" aria-label="${t('home.nearest')}">
    <button class="home-rest__near" type="button" data-nearest="toilet">${icon('toilet', {size: 18})}<span>${t('home.nearestToilet')}</span></button>
    <button class="home-rest__near" type="button" data-nearest="cafe">${icon('cup', {size: 18})}<span>${t('home.nearestCafe')}</span></button>
    <button class="home-rest__near" type="button" data-nearest="lift">${icon('lift', {size: 18})}<span>${t('home.nearestLift')}</span></button>
  </div>
  ${saved.map(
    (g) => html`<section class="home-rest__recent" aria-label="${g.label}">
        <h2 class="home-rest__title">${icon('star', {size: 16})}${g.label}</h2>
        <ul class="home-rest__list">
          ${g.places.map((d) => html`<li><button class="home-rest__row" type="button" data-saved="${d.id}">${icon(iconFor(d), {size: 18})}<span>${d.name}</span></button></li>`)}
        </ul>
      </section>`,
  )}
  ${recent.length
    ? html`<section class="home-rest__recent" aria-label="${t('home.recent')}">
        <h2 class="home-rest__title">${icon('history', {size: 16})}${t('home.recent')}</h2>
        <ul class="home-rest__list">
          ${recent.map((d, i) => html`<li><button class="home-rest__row" type="button" data-recent="${i}">${icon(iconFor(d), {size: 18})}<span>${d.name}</span></button></li>`)}
        </ul>
      </section>`
    : ''}
`
