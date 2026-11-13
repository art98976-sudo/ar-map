// The one message slot at the top of the AR view: only the most urgent message shows, in this order.
// Plain words, short, each with a small icon. Pure, so the order is tested without a camera.

/** The message for these trip stats, or null. {key, icon, text}. */
export function statusMessage(s) {
  if (!s) return null
  const ready = s.phase === 'ready' && !s.arrived
  const rules = [
    // Safety first: walking for a while with the phone held up.
    [ready && s.lookUp, {key: 'look-up', icon: 'alert', text: 'Look up while you walk'}],
    // Tracking lost long enough to hide the arrows.
    [ready && s.tracking && s.tracking !== 'NORMAL' && s.arrowsShown === false, {key: 'tracking', icon: 'alert', text: 'Tracking lost. Move slowly'}],
    [ready && s.pointAtFloor, {key: 'floor', icon: 'arrowDown', text: 'Point your phone at the floor'}],
    // Group B: the walk has not matched the route for 10 s: the arrows may be off.
    [ready && s.offerRealign, {key: 'realign', icon: 'drag', text: 'Arrows off the path? Tap Re-align'}],
    [ready && s.positionUncertain, {key: 'position', icon: 'compass', text: 'Finding your position. Follow the map for now.'}],
    [ready && s.rerouting, {key: 'reroute', icon: 'refresh', text: 'Finding a new route'}],
    [ready && s.source === 'direct', {key: 'approximate', icon: 'map', text: 'Approximate route'}],
    [!s.manual && !s.startBlocked && (s.phase === 'await-start' || (s.phase === 'ready' && !s.directionKnown)), {key: 'locating', icon: 'locate', text: 'Locating you…'}],
    [s.compassUnsteady || s.compassPoor, {key: 'compass', icon: 'compass', text: 'Wave your phone in a figure-8'}],
  ]
  return rules.find(([show]) => show)?.[1] ?? null
}
