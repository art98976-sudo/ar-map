// The way to walk, drawn over the camera: four big chevrons lying on the ground at the bottom of the
// screen (CSS perspective), turned towards the route. Turning further than about 100°, a curved turn
// arrow shows instead, and within 10 m of the entrance a pin and "You've arrived".
// It needs only the compass, so it looks the same on every phone.
import {angleDiff} from '../../geo/geo.js'
import {html, render} from '../dom.js'
import {icon} from '../icons.js'
import {FLOOR_ARROWS} from '../../config.js'

/** Ease an angle (degrees) towards a target the short way, so the arrows do not jitter. */
export function easeAngle(shown, target, dt, easeS = FLOOR_ARROWS.easeS) {
  if (shown == null) return target
  return shown + angleDiff(shown, target) * (1 - Math.exp(-dt / easeS))
}

/** 'trail' or 'turn'. Once turned, it stays a turn arrow until well back within the limit, so it never flickers. */
export function arrowMode(deg, current = 'trail') {
  const limit = current === 'turn' ? FLOOR_ARROWS.turnBackDeg : FLOOR_ARROWS.turnDeg
  return Math.abs(deg) > limit ? 'turn' : 'trail'
}

// A wide chevron pointing away from the user (up the screen before it is laid on the ground).
const chevron = (n) =>
  html`<svg class="floor-arrows__chevron" data-n="${n}" viewBox="0 0 100 46"><path d="M3 43 L50 4 L97 43 L76 43 L50 21 L24 43 Z" /></svg>`

/**
 * @param host element to draw in
 * @param o.getDeg the way to walk from where the phone faces, > 0 to the right; null when unknown
 */
export function createFloorArrows(host, {getDeg}) {
  render(
    host,
    html`
      <div class="floor-arrows__ground">
        <div class="floor-arrows__trail" data-trail hidden>${[0, 1, 2, 3].map(chevron)}</div>
        <svg class="floor-arrows__turn" data-turn viewBox="0 0 140 140" hidden>
          <path class="floor-arrows__turn-edge" d="M40 128 V64 A34 34 0 0 1 108 64 V80" />
          <path class="floor-arrows__turn-line" d="M40 128 V64 A34 34 0 0 1 108 64 V80" />
          <path class="floor-arrows__turn-head" d="M86 76 L108 108 L130 76 Z" />
        </svg>
      </div>
      <div class="floor-arrows__arrived" data-arrived hidden>
        <span class="floor-arrows__pin">${icon('pin', {size: 40})}</span>
        <p class="floor-arrows__arrived-text">You've arrived</p>
      </div>
    `,
  )
  const ground = host.querySelector('.floor-arrows__ground')
  const trail = host.querySelector('[data-trail]')
  const turn = host.querySelector('[data-turn]')
  const marker = host.querySelector('[data-arrived]')
  let active = false
  let arrived = false
  let shown = null
  let mode = 'trail'
  let last = null
  let frame = 0

  /** One frame: ease towards the way to walk, and choose straight chevrons or a turn arrow. */
  function step(dt) {
    const target = active && !arrived ? getDeg() : null
    marker.hidden = !(active && arrived)
    if (target == null) {
      trail.hidden = true
      turn.toggleAttribute('hidden', true) // an <svg> has no .hidden property
      shown = null
      mode = 'trail'
      return
    }
    shown = easeAngle(shown, target, dt)
    mode = arrowMode(shown, mode)
    trail.hidden = mode !== 'trail'
    turn.toggleAttribute('hidden', mode !== 'turn')
    ground.style.setProperty('--yaw', `${shown.toFixed(1)}deg`)
    ground.style.setProperty('--side', shown < 0 ? '-1' : '1')
  }

  function loop(now) {
    step(last == null ? 0 : Math.min(0.1, (now - last) / 1000))
    last = now
    frame = requestAnimationFrame(loop)
  }
  frame = requestAnimationFrame(loop)

  return {
    step,
    get mode() {
      return mode
    },
    get shownDeg() {
      return shown
    },
    /** Show the arrows while a walk is under way. */
    setActive(value) {
      active = value
    },
    /** Close to the entrance: a pin and "You've arrived" instead of arrows. */
    setArrived(value) {
      arrived = value
    },
    destroy() {
      cancelAnimationFrame(frame)
      render(host, html``)
    },
  }
}
