/**
 * Where each AR arrow goes: evenly spaced along the exact route polyline (the same route the 2D map
 * draws), pointing along the direction of travel, with a turn arrow just past each sharp turn.
 * Arrows sit at fixed distances along the route, so they stay put on the ground as you walk past
 * them instead of sliding along with you. Used by both AR renderers.
 */
import { distanceFade } from './wave';
import { bearingXY, type RouteTrack, type XY } from './track';

export interface ArrowPlacement extends XY {
  /** Metres along the route. Fixed for an arrow, so it also identifies it from frame to frame. */
  along: number;
  /** Compass direction the arrow points (degrees, 0 = north). */
  heading: number;
  kind: 'chevron' | 'turn';
  /** 0..1: full near you, fading further ahead. */
  opacity: number;
}

const SHARP_TURNS = new Set(['left', 'right', 'sharp-left', 'sharp-right', 'u-turn']);

/** Direction of travel at `d`, averaged over a short stretch so arrows on curves and corners turn smoothly. */
export function travelHeading(track: RouteTrack, d: number, span = 1.5): number {
  const a = track.pointAt(d - span);
  const b = track.pointAt(d + span);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) return track.headingAt(d);
  return bearingXY(a, b);
}

/**
 * Arrows between `from` (where you are, metres along) and `to`.
 * `reach` is the distance over which they fade out (default: to - from).
 */
export function arrowPlacements(
  track: RouteTrack,
  from: number,
  to: number,
  opts: { spacing?: number; startGap?: number; reach?: number } = {},
): ArrowPlacement[] {
  const spacing = opts.spacing ?? 2.5;
  const end = Math.min(to, track.total);
  const reach = opts.reach ?? Math.max(1, end - from);
  const fade = (d: number) => distanceFade(d - from, reach);
  // Fixed spots every `spacing` metres from the start of the route: the first one past your feet.
  const first = Math.ceil((from + (opts.startGap ?? 1.2)) / spacing - 1e-9) * spacing;

  // Turn arrows: just after each sharp turn that is within range, pointing the new way.
  const turns: ArrowPlacement[] = [];
  for (const s of track.steps) {
    const step = track.route.steps[s.index];
    if (step.type !== 'turn' || !step.turn || !SHARP_TURNS.has(step.turn)) continue;
    const d = s.start + 1;
    if (d <= from + 0.5 || d > end) continue;
    const p = track.pointAt(d);
    turns.push({ ...p, along: d, heading: track.headingAt(s.start + 2.5), kind: 'turn', opacity: fade(d) });
  }

  const chevrons: ArrowPlacement[] = [];
  for (let i = 0; first + i * spacing < end; i++) {
    const d = first + i * spacing;
    // Leave room around turn arrows so the corner reads clearly.
    if (turns.some((t) => Math.abs(t.along - d) < 1.6)) continue;
    const p = track.pointAt(d);
    chevrons.push({ ...p, along: d, heading: travelHeading(track, d), kind: 'chevron', opacity: fade(d) });
  }
  return [...chevrons, ...turns].sort((a, b) => a.along - b.along);
}
