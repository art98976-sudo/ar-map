// The instruction card on the AR screen, and the list of steps it opens.
import {spokenStep} from '../../route/guidance.js'
import {formatDistance} from '../../ar/pin.js'
import {html, render} from '../dom.js'
import {icon} from '../icons.js'
import {GUIDE} from '../../config.js'

const STEP_SWIPE_PX = 24
const SWIPE_CLICK_MS = 500 // a mouse swipe also fires a click; a finger's does not
const PROMPT_ICON = {'Turn around': 'uturn', 'Turn left': 'left', 'Turn right': 'right'}

export function createStepCard(root) {
  let open = false
  let swipedAt = -Infinity
  let shownIcon = null
  let shownSteps = null
  let spoken = null

  function toggleSteps(next) {
    const list = root.querySelector('[data-steps]')
    if (!list) return
    open = next
    list.hidden = !open
    shownSteps = null
    root.querySelector('[data-action="toggle-steps"]')?.setAttribute('aria-expanded', String(open))
  }

  /** Swipe the card down for the steps, up to put them away. A tap does the same. */
  function wireSwipe() {
    const card = root.querySelector('[data-action="toggle-steps"]')
    if (!card) return
    let fromY = null
    card.addEventListener('pointerdown', (event) => {
      fromY = event.clientY
    })
    card.addEventListener('pointerup', (event) => {
      if (fromY == null) return
      const moved = event.clientY - fromY
      fromY = null
      if (Math.abs(moved) < STEP_SWIPE_PX) return
      swipedAt = performance.now()
      toggleSteps(moved > 0)
    })
    card.addEventListener('pointercancel', () => {
      fromY = null
    })
  }

  function paintSteps(steps) {
    const list = root.querySelector('[data-steps]')
    if (!list || !open || !steps) return
    const key = steps.map((s) => `${s.text}${s.done}${s.current}`).join('|')
    if (key === shownSteps) return
    shownSteps = key
    render(
      list,
      html`${steps.map(
        (s) => html`<li class="ar-steps__item" data-done="${s.done}" data-current="${s.current}">
          <span class="ar-steps__tick">${s.done ? icon('check', {size: 18, label: 'Done'}) : icon(s.icon, {size: 18})}</span>
          <span>${s.text}</span>
          <span class="ar-steps__far">${formatDistance(s.distanceM)}</span>
        </li>`,
      )}`,
    )
  }

  function paint(s) {
    const card = root.querySelector('[data-step-card]')
    if (!card) return
    const text = s.turnPrompt ?? s.step?.text ?? null
    card.hidden = !text
    if (!text) return
    const name = s.turnPrompt ? PROMPT_ICON[s.turnPrompt] : s.step.icon
    if (name !== shownIcon) {
      render(root.querySelector('[data-guidance-icon]'), icon(name, {size: 30}))
      shownIcon = name
    }
    const guidance = root.querySelector('[data-guidance]')
    if (guidance.textContent !== text) guidance.textContent = text
    // A turn close by stands out, and the card says it aloud only when the step changes.
    card.dataset.urgent = String(Boolean(s.step && s.step.icon !== 'straight' && s.step.distanceM <= GUIDE.hapticM))
    const say = spokenStep(text)
    if (say !== spoken) {
      spoken = say
      root.querySelector('[data-guidance-say]').textContent = say
    }
    paintSteps(s.steps)
  }

  return {
    paint,
    wireSwipe,
    /** A tap on the card, unless it was the end of a mouse swipe. */
    tap() {
      if (performance.now() - swipedAt > SWIPE_CLICK_MS) toggleSteps(!open)
    },
    reset() {
      open = false
      shownIcon = null
      shownSteps = null
      spoken = null
    },
  }
}
