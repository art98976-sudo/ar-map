/**
 * Where each AR arrow goes: evenly spaced along the exact route polyline (the same route the 2D map
 * draws), pointing along the direction of travel, with a turn arrow just past each sharp turn.
 * Used by both AR renderers.
 */
import { bearingXY, type RouteTrack, type XY } from './track';

export interface ArrowPlacement extends XY {
  /** Metres along the route. */
  along: number;
  /** Compass direction the arrow points (degrees, 0 = north). */
  heading: number;
  kind: 'chevron' | 'turn';
  /** 0..1, fading with distance. */
  opacity: number;
}

const SHARP_TURNS = new Set(['left', 'right', 'sharp-left', 'sharp-right', 'u-turn']);

/** Direction of travel at `d`, averaged over a short stretch so arrows on curves do not wobble. */
export function travelHeading(track: RouteTrack, d: number, span = 1.5): number {
  const a = track.pointAt(d - span);
  const b = track.pointAt(d + span);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) return track.headingAt(d);
  return bearingXY(a, b);
}

export function arrowPlacements(
  track: RouteTrack,
  from: number,
  to: number,
  opts: { spacing?: number; phase?: number; startGap?: number } = {},
): ArrowPlacement[] {
  const spacing = opts.spacing ?? 2.5;
  const start = from + (opts.startGap ?? 1.2) + (opts.phase ?? 0);
  const end = Math.min(to, track.total);
  const range = Math.max(1, end - from);
  const fade = (d: number) => Math.max(0.35, Math.min(1, 1 - (d - from) / (range + 6)));

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
  for (let d = start; d < end; d += spacing) {
    // Leave room around turn arrows so the corner reads clearly.
    if (turns.some((t) => Math.abs(t.along - d) < 1.6)) continue;
    const p = track.pointAt(d);
    chevrons.push({ ...p, along: d, heading: travelHeading(track, d), kind: 'chevron', opacity: fade(d) });
  }
  return [...chevrons, ...turns].sort((a, b) => a.along - b.along);
}
