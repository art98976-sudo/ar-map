// The debug tools on the AR screen, shown only with ?debug=1.
import {formatDistance} from '../../ar/pin.js'

export function setStat(root, name, text, tone) {
  const el = root.querySelector(`[data-stat="${name}"]`)
  if (!el) return
  el.textContent = text
  if (tone) el.dataset.tone = tone
}

export function paintDebugStats(root, s) {
  const stat = (name, text, tone) => setStat(root, name, text, tone)
  const fmt = (m) => (m == null ? '–' : formatDistance(m))
  stat('gps', s.gpsAccuracy == null ? 'waiting…' : `±${Math.round(s.gpsAccuracy)} m`, s.gpsAccuracy != null && s.gpsAccuracy <= 20 ? 'ok' : 'warn')
  stat(
    'heading',
    s.heading == null ? (s.compassSource === 'none' ? 'no compass' : 'waiting…') : `${Math.round(s.heading)}° (${s.compassSource})`,
  )
  stat('remaining', fmt(s.remainingM))
  stat('gpsdist', fmt(s.gpsToEntranceM))
  stat('offroute', s.offRouteM == null ? '–' : `${s.offRouteM.toFixed(1)} m`)
  stat('match', `${s.matchOffsetM.toFixed(1)} m, ${s.matchYawDeg.toFixed(1)}°${s.matchFlipped ? ', flipped' : ''}`)
  stat('quality', s.matchResidualM == null ? 'walk 8 m first' : `${s.matchResidualM.toFixed(2)} m`, s.matchResidualM != null && s.matchResidualM < 1 ? 'ok' : 'warn')
  stat('turn', s.nextManoeuvre ? `${s.nextManoeuvre.type}, ${formatDistance(Math.max(0, s.nextManoeuvre.s - s.userS))}` : '–')
  stat('source', `${s.source}, ${s.routePoints} points`, s.source === 'direct' ? 'warn' : 'ok')
  stat('route-points', String(s.routePoints))
  stat('turns', String(s.turns))
  stat('start-gap', `${Math.round(s.startGapM)} m`)
  stat('height', `${s.cameraHeight.toFixed(2)} m`)
  if (s.floorEyeM != null) stat('floor', `${s.floorEyeM.toFixed(2)} m`)
  if (s.groundHeight != null) {
    stat('ground', `${s.groundHeight.toFixed(2)} m, ${(s.groundSlope * 100).toFixed(0)}%, ${s.groundHits} hits (${s.groundSource})`, s.groundSource === 'hits' ? 'ok' : 'warn')
  }
}

export function paintLiveDebug(root, s) {
  const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`)
  const live = {
    compass: deg(s.heading),
    source: s.compassSource ?? '–',
    beta: deg(s.debug.beta),
    camera: deg(s.debug.cameraYawDeg),
    align: deg(s.yawDeg),
    segment: deg(s.debug.firstSegmentDeg),
    look: deg(s.debug.lookDeg),
  }
  for (const [name, text] of Object.entries(live)) {
    const el = root.querySelector(`[data-live="${name}"]`)
    if (el) el.textContent = text
  }
}

export function toggleDebugPanel(root, force) {
  const panel = root.querySelector('[data-debug]')
  const btn = root.querySelector('[data-action="debug"]')
  if (!panel) return
  const show = force ?? panel.hidden
  panel.hidden = !show
  btn?.setAttribute('aria-expanded', String(show))
  btn?.setAttribute('aria-label', show ? 'Hide debug panel' : 'Show debug panel')
}
