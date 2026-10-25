/**
 * A route turned into one continuous line in local metres, for AR.
 * Positions are measured "along" the route (metres from the start), which makes it easy to find
 * the current step, what is just ahead, and how far is left.
 */
import type { LatLng, Route } from '../types';

export interface XY {
  x: number; // metres east of the origin
  y: number; // metres north of the origin
}

/** Flat local projection around an origin; accurate to centimetres across a campus. */
export function makeLocalFrame(origin: LatLng) {
  const kx = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: (p: LatLng): XY => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky }),
    toLatLng: (q: XY): LatLng => ({ lat: origin.lat + q.y / ky, lng: origin.lng + q.x / kx }),
  };
}

interface TrackStep {
  index: number;
  /** Metres along the route where the step starts. */
  start: number;
  type: Route['steps'][number]['type'];
}

interface Projection {
  along: number;
  /** Distance from the route, in metres. */
  off: number;
}

export class RouteTrack {
  readonly frame: ReturnType<typeof makeLocalFrame>;
  readonly points: XY[] = [];
  /** cum[i] = metres from the start to points[i]. */
  readonly cum: number[] = [];
  readonly steps: TrackStep[] = [];
  readonly total: number;

  constructor(readonly route: Route) {
    this.frame = makeLocalFrame(route.steps[0].location);
    for (const step of route.steps) {
      this.steps.push({ index: step.index, start: this.cum.at(-1) ?? 0, type: step.type });
      for (const p of step.path) this.push(this.frame.toXY(p));
    }
    if (!this.points.length) this.push(this.frame.toXY(route.steps[0].location));
    this.total = this.cum.at(-1)!;
  }

  private push(q: XY) {
    const last = this.points.at(-1);
    if (last && Math.hypot(q.x - last.x, q.y - last.y) < 0.01) return; // same spot (e.g. both ends of a lift ride)
    this.cum.push(last ? this.cum.at(-1)! + Math.hypot(q.x - last.x, q.y - last.y) : 0);
    this.points.push(q);
  }

  /** The point `d` metres along the route. */
  pointAt(d: number): XY {
    const t = Math.max(0, Math.min(this.total, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < t) i++;
    if (this.points.length < 2) return this.points[0];
    const a = this.points[i - 1];
    const b = this.points[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const k = (t - this.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  /** Compass bearing of the route at `d` (degrees, 0 = north). */
  headingAt(d: number): number {
    const a = this.pointAt(d - 1);
    const b = this.pointAt(d + 1);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) {
      const c = this.pointAt(d + 4);
      return bearingXY(a, c);
    }
    return bearingXY(a, b);
  }

  /**
   * Nearest point on the route to `q`. When `near` is given, a window around it is searched first,
   * so stretches that pass over each other (different floors) do not make the position jump.
   */
  project(q: XY, near?: number): Projection {
    const best = { along: 0, off: Infinity };
    const scan = (from: number, to: number) => {
      for (let i = 1; i < this.points.length; i++) {
        if (this.cum[i] < from || this.cum[i - 1] > to) continue;
        const a = this.points[i - 1];
        const b = this.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
        const off = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
        if (off < best.off) {
          best.off = off;
          best.along = this.cum[i - 1] + Math.sqrt(len2) * t;
        }
      }
    };
    if (near !== undefined) scan(near - 20, near + 80);
    if (near === undefined || best.off > 40) scan(-Infinity, Infinity);
    return best;
  }

  /** Index (into route.steps) of the step being walked at `along`. */
  stepIndexAt(along: number): number {
    let idx = 0;
    for (const s of this.steps) {
      if (s.start <= along + 0.5) idx = s.index;
      else break;
    }
    return idx;
  }

  /** Where the step at `index` starts, in metres along. */
  stepStart(index: number): number {
    return this.steps[index]?.start ?? 0;
  }

  /** The first floor change at or after `fromIndex`, if any. */
  nextFloorChange(fromIndex: number): TrackStep | undefined {
    return this.steps.find((s) => s.index >= fromIndex && s.type === 'change-floor');
  }
}

export function bearingXY(a: XY, b: XY): number {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
}

/** Signed difference b - a in degrees, -180..180. */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;
