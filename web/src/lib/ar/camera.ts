/**
 * A simple camera model for AR (camera-overlay mode): the phone is held `eyeHeight` above flat ground, looking along the
 * compass heading and tilted down by `pitch`. Points on the ground are projected onto the screen,
 * so the route arrows appear to lie on the floor. (Ported from the Stirling AR prototype.)
 */

/** Typical height of a phone held in front of the chest while walking (calibrated per person). */
export const DEFAULT_EYE_HEIGHT_M = 1.4;
/** Typical phone camera field of view along the long side of the picture. */
const DEFAULT_LENS_FOV = 65;

export interface Camera {
  width: number;
  height: number;
  /** Focal length in screen pixels. */
  f: number;
  cx: number;
  cy: number;
  cosPitch: number;
  sinPitch: number;
  /** Sideways lean of the phone, radians. */
  roll: number;
  /** Height of the phone above the ground, metres. */
  eyeHeight: number;
}

/**
 * Focal length from the video: the camera sees `lensFov` along the picture's long side, and the
 * picture is scaled to cover the screen, so a portrait screen sees less than that across.
 */
export function makeCamera(opts: {
  width: number;
  height: number;
  pitchDeg: number;
  rollRad?: number;
  eyeHeight?: number;
  video?: { width: number; height: number } | null;
  lensFov?: number;
}): Camera {
  const { width: W, height: H } = opts;
  const lens = ((opts.lensFov ?? DEFAULT_LENS_FOV) * Math.PI) / 180;
  let f: number;
  if (opts.video && opts.video.width && opts.video.height) {
    const { width: vw, height: vh } = opts.video;
    const scale = Math.max(W / vw, H / vh);
    f = (Math.max(vw, vh) / 2 / Math.tan(lens / 2)) * scale;
  } else {
    f = W / 2 / Math.tan((60 * Math.PI) / 180 / 2);
  }
  const p = (opts.pitchDeg * Math.PI) / 180;
  return { width: W, height: H, f, cx: W / 2, cy: H / 2, cosPitch: Math.cos(p), sinPitch: Math.sin(p), roll: opts.rollRad ?? 0, eyeHeight: opts.eyeHeight ?? DEFAULT_EYE_HEIGHT_M };
}

/**
 * Projects a point given relative to the viewer (metres to the right, ahead and above the ground)
 * onto the screen. Returns null when the point is behind the camera or too close.
 */
export function project(cam: Camera, right: number, ahead: number, up = 0): [number, number, number] | null {
  const h = cam.eyeHeight - up;
  const z = ahead * cam.cosPitch + h * cam.sinPitch;
  const y = h * cam.cosPitch - ahead * cam.sinPitch;
  if (z < 0.35) return null;
  return [cam.cx + (cam.f * right) / z, cam.cy + (cam.f * y) / z, z];
}

/** Turns world offsets (east, north from the viewer) into viewer-relative (right, ahead) for a heading. */
export function toViewer(dx: number, dy: number, headingDeg: number): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  const c = Math.cos(h);
  const s = Math.sin(h);
  return [dx * c - dy * s, dx * s + dy * c];
}
