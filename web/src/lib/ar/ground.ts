/**
 * Where the ground is, for AR.
 *
 * Camera-overlay mode (no ground tracking, e.g. iPhone Safari): the ground is a flat plane a known
 * distance below the phone. That distance is calibrated once by tapping the ground, and arrows are
 * only drawn where small errors cannot lift them off the ground visibly (not near the horizon).
 *
 * Ground-tracking mode (WebXR): the ground height comes from hit tests against real surfaces.
 */
import { DEFAULT_EYE_HEIGHT_M, type Camera } from './camera';

export { DEFAULT_EYE_HEIGHT_M };

/**
 * Arrows closer than this angle to the horizon are hidden. Near the horizon, a 1° tilt or lens
 * error moves a ground point several metres, which is what makes distant arrows look like they float.
 */
export const MIN_DEPRESSION_DEG = 6;
/** Never draw arrows further than this ahead. */
const MAX_ARROW_DISTANCE_M = 15;

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** How far ahead arrows may be drawn for this phone height (overlay mode). */
export function maxArrowDistance(eyeHeight: number): number {
  return Math.min(MAX_ARROW_DISTANCE_M, eyeHeight / Math.tan(rad(MIN_DEPRESSION_DEG)));
}

/** Angle below the horizon of a screen point (degrees), undoing the phone's sideways lean. */
export function depressionAt(cam: Camera, screenX: number, screenY: number): number {
  // Undo roll: rotate the point back around the screen centre.
  const dx = screenX - cam.cx;
  const dy = screenY - cam.cy;
  const c = Math.cos(-cam.roll);
  const s = Math.sin(-cam.roll);
  const y = dx * s + dy * c;
  const pitch = deg(Math.atan2(cam.sinPitch, cam.cosPitch));
  return pitch + deg(Math.atan2(y, cam.f));
}

/**
 * One-time calibration: the user taps the ground a known distance ahead (default 2 m, about three
 * steps). From the tap's angle below the horizon we get the phone's height above the ground.
 * Returns null when the tap cannot be on the ground (at or above the horizon).
 */
export function eyeHeightFromTap(depressionDeg: number, distanceM = 2): number | null {
  if (depressionDeg <= 2 || depressionDeg >= 88) return null;
  const h = distanceM * Math.tan(rad(depressionDeg));
  return Math.min(2.2, Math.max(0.6, h));
}

/**
 * Ground height from WebXR hit tests. Only near-horizontal surfaces count, and the median of recent
 * hits is used so single bad hits (a bench, a wall edge) cannot move the arrows.
 */
export class GroundEstimator {
  private ys: number[] = [];

  constructor(private readonly size = 15) {}

  /** `normalY` is the vertical component of the surface normal (1 = flat floor). */
  add(y: number, normalY: number): boolean {
    if (!Number.isFinite(y) || normalY < 0.9) return false;
    // A hit far from the current estimate (another level, a table) needs to repeat before it wins.
    this.ys.push(y);
    if (this.ys.length > this.size) this.ys.shift();
    return true;
  }

  get samples(): number {
    return this.ys.length;
  }

  /** Median ground height, or null until there are enough hits to trust. */
  get height(): number | null {
    if (this.ys.length < 3) return null;
    const sorted = [...this.ys].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset() {
    this.ys = [];
  }
}
