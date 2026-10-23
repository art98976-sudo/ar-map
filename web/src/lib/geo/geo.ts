import { centroid, distance, point } from '@turf/turf';
import type { LatLng } from '../types';

/** Distance in metres between two points. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'meters' });
}

/** Centre point of a polygon. */
export function polygonCentroid(polygon: GeoJSON.Polygon): LatLng {
  const [lng, lat] = centroid(polygon).geometry.coordinates;
  return { lat, lng };
}

export const toLatLng = ([lng, lat]: GeoJSON.Position): LatLng => ({ lat, lng });
