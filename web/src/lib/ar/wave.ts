/**
 * How each ground arrow looks at a moment in time: brighter near you, fading further ahead, with a
 * wave of light that runs forward along the arrows in a loop (like airport floor lights).
 * Pure functions, shared by both AR renderers and unit tested.
 */
import { APP_CONFIG } from '@/config/appConfig';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

/**
 * Opacity from distance alone: full near you, down to `farOpacity` at `reach` metres ahead.
 * Right at your feet the arrow fades in, so arrows never blink out as you step over them.
 */
export function distanceFade(ahead: number, reach: number): number {
  const { nearOpacity, farOpacity, firstArrowM } = APP_CONFIG.arrows;
  const far = nearOpacity + (farOpacity - nearOpacity) * smooth(clamp01(ahead / Math.max(1, reach)));
  const atFeet = clamp01(ahead - firstArrowM);
  return far * atFeet;
}

/**
 * Brightness of the wave (0..1) at `ahead` metres in front of you, at time `now` (ms).
 * The bright band starts just behind the nearest arrow and leaves past the farthest one, once per cycle.
 */
export function waveGlow(ahead: number, now: number, reach: number): number {
  const { waveCycleMs, waveWidthM } = APP_CONFIG.arrows;
  const travel = reach + waveWidthM;
  const band = ((((now % waveCycleMs) + waveCycleMs) % waveCycleMs) / waveCycleMs) * travel - waveWidthM / 2;
  const x = (ahead - band) / (waveWidthM / 2);
  return Math.exp(-2 * x * x);
}

/**
 * The wave's effect on one arrow: how much of its opacity it shows (dim between waves, full as the
 * wave passes) and its size (a gentle pulse). With `animate` off (reduced motion), arrows stay steady.
 */
export function arrowLook(ahead: number, now: number, reach: number, animate = true): { glow: number; alpha: number; scale: number } {
  const { dimLevel, scaleMin, scaleMax } = APP_CONFIG.arrows;
  if (!animate) return { glow: 0, alpha: 1, scale: 1 };
  const glow = waveGlow(ahead, now, reach);
  return { glow, alpha: dimLevel + (1 - dimLevel) * glow, scale: scaleMin + (scaleMax - scaleMin) * glow };
}
