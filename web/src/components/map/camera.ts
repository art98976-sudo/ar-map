/** Camera helpers for the map. */
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl';
import type { LatLng } from '@/lib/types';
import type { Padding } from './types';

export function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Shrinks padding that would leave no room on a small map (keeps at least 40% of each side). */
export function fitPadding(map: MapLibreMap, p: Padding): Padding {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const scale = (a: number, b: number, size: number) => (a + b > size * 0.6 ? (size * 0.6) / (a + b) : 1);
  const v = scale(p.top, p.bottom, h);
  const hz = scale(p.left, p.right, w);
  return { top: p.top * v, bottom: p.bottom * v, left: p.left * hz, right: p.right * hz };
}

export function addPadding(p: Padding, extra: number): Padding {
  return { top: p.top + extra, bottom: p.bottom + extra, left: p.left + extra, right: p.right + extra };
}

export function boundsOf(points: LatLng[]): LngLatBoundsLike {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [[w, s], [e, n]];
}
