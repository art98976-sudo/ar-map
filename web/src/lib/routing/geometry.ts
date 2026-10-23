import type { LatLng, TurnDirection } from '../types';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. Fast enough to run inside A*. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0-360 degrees clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed change of direction in degrees, -180..180. Positive is a right turn. */
export function turnAngle(fromBearing: number, toBearing: number): number {
  return ((toBearing - fromBearing + 540) % 360) - 180;
}

/** Turns smaller than this are treated as "keep going". */
export const TURN_THRESHOLD_DEGREES = 35;

export function classifyTurn(angle: number): TurnDirection {
  const a = Math.abs(angle);
  const side = angle > 0 ? 'right' : 'left';
  if (a < 20) return 'straight';
  if (a < 45) return `slight-${side}`;
  if (a < 135) return side;
  if (a < 170) return `sharp-${side}`;
  return 'u-turn';
}

export const TURN_WORDS: Record<TurnDirection, string> = {
  straight: 'Continue straight',
  'slight-left': 'Bear left',
  left: 'Turn left',
  'sharp-left': 'Turn sharp left',
  'slight-right': 'Bear right',
  right: 'Turn right',
  'sharp-right': 'Turn sharp right',
  'u-turn': 'Turn around',
};

const CARDINALS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const cardinal = (b: number) => CARDINALS[Math.round(b / 45) % 8];

/**
 * Closest point to p on segment a-b, using a local flat projection (accurate at campus scale).
 * Returns the point and t, its position along the segment (0 = a, 1 = b).
 */
export function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number } {
  const k = Math.cos(rad(p.lat));
  const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = p.lng * k, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, t };
}
