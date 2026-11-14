// The one message slot at the top of the AR view: only the most urgent message shows, in this order.
// Plain words, short, each with a small icon. Pure, so the order is tested without a camera.
// Group C: only messages that ask the user to do something. "Finding a new route", "Approximate
// route" and "Locating you…" are gone: the arrows and the map already show it, and nobody can act.

/** The message for these trip stats, or null. {key, icon, text}. */
export function statusMessage(s) {
  if (!s) return null
  const ready = s.phase === 'ready' && !s.arrived
  const rules = [
    // Safety first: walking fast looking down at the phone (B9), or a while with it held up.
    [ready && s.headDown, {key: 'head-down', icon: 'alert', text: 'Look up. Watch where you’re walking'}],
    [ready && s.lookUp, {key: 'look-up', icon: 'alert', text: 'Look up while you walk'}],
    // Tracking lost long enough to hide the arrows.
    [ready && (s.trackingState === 'LOST' || (s.tracking && s.tracking !== 'NORMAL' && s.arrowsShown === false)), {key: 'tracking', icon: 'alert', text: 'Tracking lost. Move slowly'}],
    // Group B: the walk has not matched the route for 10 s: the arrows may be off.
    [ready && s.offerRealign, {key: 'realign', icon: 'drag', text: 'Arrows off the path? Tap Re-align'}],
    [ready && s.positionUncertain, {key: 'position', icon: 'compass', text: 'Finding your position. Follow the map for now.'}],
    // Indoors, the walk keeps missing the route: the user can say where they are.
    [ready && s.offerReanchor, {key: 'reanchor', icon: 'pin', text: "Lost? Tap I'm here"}],
    [s.compassUnsteady || s.compassPoor, {key: 'compass', icon: 'compass', text: 'Wave your phone in a figure-8'}],
  ]
  return rules.find(([show]) => show)?.[1] ?? null
}
