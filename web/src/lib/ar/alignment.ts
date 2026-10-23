/**
 * Map ↔ AR world conversion, in one place.
 *
 * Map side: local metres east (x) and north (y) of the route's start (see track.ts).
 * AR side (WebXR): metres, x to the right, y up, -z straight ahead of where the phone pointed when
 * AR started. Ground height (y) is handled separately (ground.ts), never from GPS altitude.
 *
 * The two are related by a rotation about the vertical axis (`offset`: the compass heading of the
 * AR -z axis) and a shift (`originEN` on the map = `originXR` in AR).
 */
import type { XY } from './track';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

export interface XZ {
  x: number;
  z: number;
}

/** Direction of a horizontal AR vector, in degrees clockwise from AR -z. */
export function xrYaw(dx: number, dz: number): number {
  return norm360(deg(Math.atan2(dx, -dz)));
}

/** Average of angles (handles the 359°/1° wrap). Returns null for an empty list. */
export function circularMean(angles: number[]): number | null {
  if (!angles.length) return null;
  let s = 0;
  let c = 0;
  for (const a of angles) {
    s += Math.sin(rad(a));
    c += Math.cos(rad(a));
  }
  return norm360(deg(Math.atan2(s, c)));
}

/** How spread out a set of angles is (0 = identical, larger = noisier), in degrees. */
export function circularSpread(angles: number[]): number {
  if (angles.length < 2) return 180;
  let s = 0;
  let c = 0;
  for (const a of angles) {
    s += Math.sin(rad(a));
    c += Math.cos(rad(a));
  }
  const r = Math.min(1, Math.hypot(s, c) / angles.length);
  // Circular standard deviation.
  return deg(Math.sqrt(-2 * Math.log(Math.max(r, 1e-9))));
}

export class Alignment {
  constructor(
    /** Compass heading (degrees) of the AR -z axis. */
    public offset: number,
    public originEN: XY,
    public originXR: XZ,
  ) {}

  /** Map metres → AR position (horizontal). */
  enToXr(p: XY): XZ {
    const e = p.x - this.originEN.x;
    const n = p.y - this.originEN.y;
    const c = Math.cos(rad(this.offset));
    const s = Math.sin(rad(this.offset));
    return { x: this.originXR.x + e * c - n * s, z: this.originXR.z - (n * c + e * s) };
  }

  /** AR position → map metres. */
  xrToEn(q: XZ): XY {
    const dx = q.x - this.originXR.x;
    const back = -(q.z - this.originXR.z);
    const c = Math.cos(rad(this.offset));
    const s = Math.sin(rad(this.offset));
    return { x: this.originEN.x + dx * c + back * s, y: this.originEN.y - dx * s + back * c };
  }

  /** Compass heading → AR yaw (for orienting arrows). */
  headingToXrYaw(heading: number): number {
    return norm360(heading - this.offset);
  }

  /** AR yaw → compass heading (for the direction the phone faces). */
  xrYawToHeading(yaw: number): number {
    return norm360(yaw + this.offset);
  }
}
