// B7: the smart fallback. While tracking is WEAK or LOST the floor arrows cannot be trusted, so
// one big arrow floats over the camera instead, turned towards the way to walk from where the
// phone points (compass), with the distance left. Back to the floor arrows once it is GOOD again.
import {formatDistance} from '../../ar/pin.js'
import {wrap360} from '../../geo/geo.js'

/**
 * What the fallback shows for these trip stats: {show, turnDeg, text}. turnDeg: how far to turn
 * from where the phone points, -180..180 (> 0 right), or null when there is no compass. Pure.
 */
export function fallbackArrow(s) {
  const weak = s?.trackingState === 'WEAK' || s?.trackingState === 'LOST'
  // Only once the floor arrows are hidden: a short tracking blip keeps them, and the two never show at once.
  if (!weak || s.arrowsShown || s.phase !== 'ready' || s.arrived) return {show: false, turnDeg: null, text: ''}
  const turn = Number.isFinite(s.arrowBearingDeg) && Number.isFinite(s.heading) ? ((wrap360(s.arrowBearingDeg - s.heading) + 180) % 360) - 180 : null
  const left = Number.isFinite(s.remainingM) ? formatDistance(s.remainingM) : ''
  return {show: true, turnDeg: turn, text: turn == null ? (left ? `Follow the map · ${left}` : 'Follow the map') : left}
}

/** The angle to draw next: `target` reached the short way from `shown`, so CSS never spins round. */
export function unwrapTowards(shown, target) {
  if (!Number.isFinite(shown)) return target
  return shown + (((target - shown + 540) % 360) - 180)
}

/** Paint the fallback in the AR view. Keeps the drawn angle between calls in el.dataset. */
export function paintFallback(root, s) {
  const el = root.querySelector('[data-fallback]')
  if (!el) return
  const f = fallbackArrow(s)
  el.hidden = !f.show
  if (!f.show) return
  const arrow = el.querySelector('[data-fallback-arrow]')
  arrow.hidden = f.turnDeg == null
  if (f.turnDeg != null) {
    const angle = unwrapTowards(Number(el.dataset.angle), f.turnDeg)
    el.dataset.angle = String(angle)
    arrow.style.transform = `rotate(${angle}deg)`
  }
  const text = el.querySelector('[data-fallback-text]')
  if (text.textContent !== f.text) text.textContent = f.text
}
