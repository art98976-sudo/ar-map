/**
 * Phone orientation for AR: compass heading of the back camera, tilt (pitch) and sideways lean (roll).
 * (Ported from the Stirling AR prototype.)
 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface OrientationReading {
  /** Compass heading of the back camera in degrees, or null when the device gives no compass. */
  heading: number | null;
  /** Degrees below the horizon the camera points (0 = straight ahead, 90 = at the ground). */
  pitch: number;
  /** Sideways lean, radians. */
  roll: number;
  /** iPhone compass accuracy in degrees (negative or large = needs calibration). */
  accuracy: number | null;
}

/** Heading of the back camera from the full device orientation (works when the phone is upright). */
export function cameraHeading(alpha: number, beta: number, gamma: number): number {
  const x = rad(beta);
  const y = rad(gamma);
  const z = rad(alpha);
  const cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  return (deg(Math.atan2(vx, vy)) + 360) % 360;
}

export interface OrientationLike {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
  type?: string;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export function readOrientation(e: OrientationLike, screenAngle = 0): OrientationReading | null {
  if (e.beta == null || e.gamma == null) return null;
  // The world's "up" direction as seen from the phone gives tilt and lean, even when upright.
  const b = rad(e.beta);
  const g = rad(e.gamma);
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  const pitch = Math.max(-30, Math.min(80, deg(Math.asin(Math.max(-1, Math.min(1, uz))))));
  const roll = Math.abs(pitch) < 70 ? Math.atan2(ux, uy) : 0;

  let heading: number | null = null;
  let accuracy: number | null = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
    // iPhone: already the compass heading of the top of the phone.
    heading = e.webkitCompassHeading + screenAngle;
    accuracy = typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null;
  } else if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha != null) {
    // Android: absolute orientation; convert to the back camera's heading.
    heading = Math.abs(pitch) < 65 ? cameraHeading(e.alpha, e.beta, e.gamma) : 360 - e.alpha;
  }
  return { heading: heading === null ? null : ((heading % 360) + 360) % 360, pitch, roll, accuracy };
}

/** iPhone only shows the motion/compass prompt when asked straight from a tap. */
export async function requestMotionPermission(): Promise<'granted' | 'denied' | 'not-needed'> {
  type WithPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };
  const asks: Promise<string>[] = [];
  const DOE = (globalThis as { DeviceOrientationEvent?: WithPermission }).DeviceOrientationEvent;
  const DME = (globalThis as { DeviceMotionEvent?: WithPermission }).DeviceMotionEvent;
  if (typeof DOE?.requestPermission === 'function') asks.push(DOE.requestPermission().catch(() => 'denied'));
  if (typeof DME?.requestPermission === 'function') asks.push(DME.requestPermission().catch(() => 'denied'));
  if (!asks.length) return 'not-needed';
  const results = await Promise.all(asks);
  return results.every((r) => r === 'granted') ? 'granted' : 'denied';
}
