import { centroid } from '@turf/turf';
import type { LatLng } from '../types';

/** Centre point of a polygon. */
export function polygonCentroid(polygon: GeoJSON.Polygon): LatLng {
  const [lng, lat] = centroid(polygon).geometry.coordinates;
  return { lat, lng };
}

export const toLatLng = ([lng, lat]: GeoJSON.Position): LatLng => ({ lat, lng });
