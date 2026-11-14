// The arrival card over the camera: "You’ve arrived", or at a building door "You’re at <entrance>".
import {haptic, html, render} from '../dom.js'
import {icon} from '../icons.js'
import {ARRIVAL_CARD, COLOURS} from '../../config.js'

const PIECES = 40

export function prefersReducedMotion(win = window) {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function confetti() {
  return Array.from({length: PIECES}, (_, i) => {
    const left = (i * 97) % 100 // spread evenly without clumping
    const delay = ((i * 37) % 60) / 100
    const drift = ((i * 53) % 80) - 40
    return html`<span class="confetti" style="left: ${left}%; --delay: ${delay}s; --drift: ${drift}px; background: ${COLOURS.confetti[i % COLOURS.confetti.length]}"></span>`
  })
}

/**
 * B6: where the place is from where the phone points, in words. turnDeg: -180..180, > 0 right.
 * Null when unknown.
 */
export function directionWords(turnDeg) {
  if (!Number.isFinite(turnDeg)) return null
  const a = Math.abs(turnDeg)
  if (a <= ARRIVAL_CARD.aheadDeg) return 'straight ahead'
  if (a >= ARRIVAL_CARD.behindDeg) return 'behind you'
  return turnDeg > 0 ? 'on your right' : 'on your left'
}

/** B6: the place's details for the card: "Cottrell Building · Level 2" and its description. */
export function placeDetails(place) {
  if (!place) return {where: '', about: ''}
  const level = Number.isFinite(place.floor) ? `Level ${place.floor}` : ''
  const building = place.building && place.building !== place.name ? place.building : ''
  return {where: [building, level].filter(Boolean).join(' · '), about: place.description || place.kind || ''}
}

/**
 * Render into host: a card rises with a tick that draws itself. Outdoors: "You've arrived" and the
 * place, with Done. At a building's entrance for a room inside (entrance given): "You're at
 * <entrance>" and "Continue inside on the map" (data-action="inside"). One vibration.
 * B6: turnDeg says which way the door (or the room) is from where the phone points; place adds
 * its building, level and description.
 */
export function showArrival(host, {name, entrance = null, turnDeg = null, place = null, reducedMotion = prefersReducedMotion()}) {
  const way = directionWords(turnDeg)
  const {where, about} = placeDetails(place)
  render(
    host,
    html`
      ${reducedMotion || entrance ? '' : html`<div class="arrival__confetti" data-confetti aria-hidden="true">${confetti()}</div>`}
      <section class="arrival__card" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <span class="arrival__icon arrival__tick">${icon('check', {size: 32})}</span>
        <h1 class="arrival__title" id="arrival-title" tabindex="-1">${entrance ? `You’re at ${entrance}` : 'You’ve arrived'}</h1>
        <p class="arrival__place">${entrance ? `${name} is inside` : name}</p>
        ${way
          ? html`<p class="arrival__way" data-arrival-way>
              <span class="arrival__way-arrow" style="transform: rotate(${Math.round(turnDeg)}deg)" aria-hidden="true">${icon('arrowUp', {size: 18})}</span>
              <span>${entrance ? 'The door is' : 'It’s'} ${way}</span>
            </p>`
          : ''}
        ${where || about
          ? html`<div class="arrival__about" data-arrival-about>
              ${where ? html`<p class="arrival__where">${where}</p>` : ''}
              ${about ? html`<p>${about}</p>` : ''}
            </div>`
          : ''}
        ${entrance
          ? html`<button class="btn btn--primary btn--block" type="button" data-action="inside">${icon('map')}<span>Continue inside on the map</span></button>`
          : html`<button class="btn btn--primary btn--block" type="button" data-action="done" aria-label="Done">Done</button>`}
      </section>
    `,
  )
  host.hidden = false
  host.querySelector('[data-action]')?.focus({preventScroll: true})
  haptic(40)
}
