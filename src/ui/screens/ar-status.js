// The one message slot at the top of the AR view: only the most urgent message shows, in this order.
// Plain words, short, each with a small icon. Pure, so the order is tested without a camera.
// Group C: only messages that ask the user to do something. "Finding a new route", "Approximate
// route" and "Locating you…" are gone: the arrows and the map already show it, and nobody can act.
import {t} from '../../i18n/i18n.js'

/**
 * Why the floor arrows are hidden while the position is unsure. GPS: say so, with its error, since
 * the simple arrow and the distance carry on. Otherwise (the compass), the general words. Pure.
 */
export function positionHint({positionReason = null, gpsAccuracy = null} = {}) {
  if (positionReason !== 'gps') return t('status.finding')
  return Number.isFinite(gpsAccuracy) ? t('status.lowGpsM', {m: Math.round(gpsAccuracy)}) : t('status.lowGps')
}

/** The message for these trip stats, or null. {key, icon, text}. */
export function statusMessage(s) {
  if (!s) return null
  const ready = s.phase === 'ready' && !s.arrived
  const rules = [
    // Safety first: walking fast looking down at the phone (B9), or a while with it held up.
    [ready && s.headDown, {key: 'head-down', icon: 'alert', text: t('status.headDown')}],
    [ready && s.lookUp, {key: 'look-up', icon: 'alert', text: t('status.lookUp')}],
    // Coaching (item 1): tracking not normal yet, or the floor not found yet, or tracking lost
    // long enough to hide the arrows: one line, nothing drawn on the ground until it is.
    [ready && (s.coaching || s.trackingState === 'LOST' || (s.tracking && s.tracking !== 'NORMAL' && s.arrowsShown === false)), {key: 'tracking', icon: 'camera', text: t('status.pointAtPath')}],
    // Group B: the walk has not matched the route for 10 s: the arrows may be off.
    [ready && s.offerRealign, {key: 'realign', icon: 'drag', text: t('status.realign')}],
    [ready && s.positionUncertain, {key: 'position', icon: 'compass', text: positionHint(s)}],
    // Indoors, the walk keeps missing the route: the user can say where they are.
    [ready && s.offerReanchor, {key: 'reanchor', icon: 'pin', text: t('status.reanchor')}],
    [s.compassUnsteady || s.compassPoor, {key: 'compass', icon: 'compass', text: t('status.compass')}],
  ]
  return rules.find(([show]) => show)?.[1] ?? null
}
