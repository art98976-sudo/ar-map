// The arrival card over the camera: "You’ve arrived", or at a building door "You’re at <entrance>".
import {haptic, html, render} from '../dom.js'
import {icon} from '../icons.js'
import {COLOURS} from '../../config.js'

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
 * Render into host: a card rises with a tick that draws itself. Outdoors: "You've arrived" and the
 * place, with Done. At a building's entrance for a room inside (entrance given): "You're at
 * <entrance>" and "Continue inside on the map" (data-action="inside"). One vibration.
 */
export function showArrival(host, {name, entrance = null, reducedMotion = prefersReducedMotion()}) {
  render(
    host,
    html`
      ${reducedMotion || entrance ? '' : html`<div class="arrival__confetti" data-confetti aria-hidden="true">${confetti()}</div>`}
      <section class="arrival__card" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <span class="arrival__icon arrival__tick">${icon('check', {size: 32})}</span>
        <h1 class="arrival__title" id="arrival-title" tabindex="-1">${entrance ? `You’re at ${entrance}` : 'You’ve arrived'}</h1>
        <p class="arrival__place">${entrance ? `${name} is inside` : name}</p>
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
