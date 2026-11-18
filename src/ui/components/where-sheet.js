// "Where are you?" (alignment Phase 1): GPS cannot start this AR trip, so the user taps the door they
// stand at, or chooses on the map. One tap. Drawn inside the location card (locate.js).
import {html} from '../dom.js'
import {icon} from '../icons.js'
import {doorLabel} from '../../route/door-start.js'

const WHY = {
  indoors: 'You seem to be inside. GPS can’t place you well enough here.',
  weak: 'GPS is too weak to line up the arrows.',
  'no-fix': 'We couldn’t get your location.',
  'outline-unknown': 'We couldn’t check your location against the campus map.',
}

/**
 * reason: why GPS was not used (ar-start.js). doors: ranked doors (door-start.js rankDoors), or
 * null while they load. approximate: the distances come from a rough fix.
 */
export function whereSheet({reason, doors, approximate = true}) {
  const loading = doors == null
  const rows = loading
    ? [0, 1, 2].map(() => html`<div class="place-row place-row--skeleton" aria-hidden="true"><span></span><span></span></div>`)
    : doors.map((door, i) => {
        const {title, detail} = doorLabel(door, {approximate})
        return html`
          <button class="place-row" type="button" data-action="pick-door" data-door="${i}" aria-label="${title}. ${detail}">
            <span class="place-row__icon">${icon('door', {size: 20})}</span>
            <span class="place-row__text"><strong>${title}</strong><span>${detail}</span></span>
          </button>
        `
      })
  return html`
    <div class="where" data-where>
      <h1 class="locate-card__title" tabindex="-1" data-where-title>Where are you?</h1>
      <p class="locate-card__body">${WHY[reason] ?? WHY.weak} Tap the door you’re standing at.</p>
      <div class="where__list" aria-busy="${loading ? 'true' : 'false'}" data-where-list>
        ${rows}
        ${!loading && !doors.length ? html`<p class="where__empty">No doors found near you.</p>` : ''}
        <button class="place-row" type="button" data-action="pick-on-map">
          <span class="place-row__icon">${icon('map', {size: 20})}</span>
          <span class="place-row__text"><strong>Choose on map</strong><span>Put a pin where you are</span></span>
        </button>
      </div>
    </div>
  `
}
