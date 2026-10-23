/**
 * Core campus types shared by every MapProvider.
 * The UI only ever sees these types, never raw GeoJSON or MazeMap objects.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** The filter chips shown in the UI. */
export const FILTER_CATEGORIES = [
  'teaching',
  'food',
  'study',
  'sports',
  'accommodation',
  'transport',
] as const;
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

export const FILTER_LABELS: Record<FilterCategory, string> = {
  teaching: 'Teaching rooms',
  food: 'Food',
  study: 'Study spaces',
  sports: 'Sports',
  accommodation: 'Accommodation',
  transport: 'Transport',
};

export type DestinationKind =
  | 'building'
  | 'room'
  | 'cafe'
  | 'study-space'
  | 'sports'
  | 'bus-stop'
  | 'car-park'
  | 'landmark';

/** Anything a user can search for and route to. */
export interface Destination {
  /** Stable, provider-scoped id, e.g. "building:cottrell" or "room:cottrell-1-101". */
  id: string;
  name: string;
  kind: DestinationKind;
  categories: FilterCategory[];
  location: LatLng;
  buildingId?: string;
  buildingName?: string;
  floorId?: string;
  floorName?: string;
  /** Z-level: 0 is the ground floor of the building. Only set for indoor destinations. */
  level?: number;
  description?: string;
  aliases?: string[];
  photoUrl?: string;
}

export interface Floor {
  id: string;
  buildingId: string;
  /** Z-level: 0 is the ground floor. */
  level: number;
  /** Label shown to people, e.g. "Floor 2". */
  name: string;
}

export interface Entrance {
  id: string;
  buildingId: string;
  name: string;
  location: LatLng;
  stepFree: boolean;
  level: number;
}

export interface Building {
  id: string;
  name: string;
  shortName?: string;
  description?: string;
  categories: FilterCategory[];
  centroid: LatLng;
  /** GeoJSON polygon of the footprint. */
  footprint: GeoJSON.Polygon;
  entrances: Entrance[];
  /** True when floors, rooms and indoor routing exist for this building. */
  hasIndoorData: boolean;
}

export interface SearchFilters {
  /** Only return destinations in at least one of these categories. Empty means all. */
  categories?: FilterCategory[];
  /** Maximum number of results. */
  limit?: number;
}
