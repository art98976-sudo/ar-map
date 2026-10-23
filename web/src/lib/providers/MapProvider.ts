import type {
  Building,
  Destination,
  Floor,
  Route,
  RouteEndpoint,
  RouteOptions,
  SearchFilters,
} from '../types';

export type ProviderId = 'local' | 'mazemap';

/** Extra GeoJSON a provider can hand to the map for drawing (LocalProvider only). */
export interface MapOverlay {
  areas: GeoJSON.FeatureCollection;
  buildings: GeoJSON.FeatureCollection;
  paths: GeoJSON.FeatureCollection;
  entrances: GeoJSON.FeatureCollection;
  places: GeoJSON.FeatureCollection;
}

/**
 * The only way the UI reads campus data. Swap implementations with the
 * MAP_PROVIDER environment variable; the UI must not change.
 */
export interface MapProvider {
  readonly id: ProviderId;
  /** True when the data is approximate sample data (shown in the UI footer). */
  readonly isSampleData: boolean;

  searchDestinations(query: string, filters?: SearchFilters): Promise<Destination[]>;
  /** Resolves to null when no destination has this id (e.g. an old share link). */
  getDestination(id: string): Promise<Destination | null>;
  getBuildings(): Promise<Building[]>;
  /** Floors ordered from lowest to highest. Empty when the building has no indoor data. */
  getFloors(buildingId: string): Promise<Floor[]>;
  getRoute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Promise<Route>;

  /** Optional: features to draw on a plain base map. MazeMap draws its own map instead. */
  getMapOverlay?(): Promise<MapOverlay>;
}
