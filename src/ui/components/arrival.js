// "You have arrived": shown over the camera at the entrance, with a short burst of confetti.
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

/** Render into host. The Done button uses data-action="done", handled by the AR screen. */
export function showArrival(host, {name, reducedMotion = prefersReducedMotion()}) {
  render(
    host,
    html`
      ${reducedMotion ? '' : html`<div class="arrival__confetti" data-confetti aria-hidden="true">${confetti()}</div>`}
      <section class="arrival__card" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <span class="arrival__icon">${icon('check', {size: 32})}</span>
        <h1 class="arrival__title" id="arrival-title" tabindex="-1">You have arrived</h1>
        <p class="arrival__place">${name}</p>
        <button class="btn btn--primary btn--block" type="button" data-action="done" aria-label="Done">Done</button>
      </section>
    `,
  )
  host.hidden = false
  host.querySelector('[data-action="done"]').focus({preventScroll: true})
  haptic([30, 60, 30])
}
