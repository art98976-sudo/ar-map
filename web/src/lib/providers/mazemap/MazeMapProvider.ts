import { searchDestinationList } from '../local/search';
import type {
  Building,
  Destination,
  Floor,
  FilterCategory,
  Route,
  RouteEnd,
  RouteEndpoint,
  RouteOptions,
  SearchFilters,
} from '../../types';
import { FILTER_LABELS } from '../../types';
import { NoRouteError, NotFoundError, ProviderNotConfiguredError } from '../errors';
import type { MapProvider } from '../MapProvider';
import {
  mazemapBuildingId,
  parseMazemapPoiId,
  poiToDestination,
  toBuilding,
  toFloor,
  tripToRoute,
} from './adapters';
import { loadMazemapSdk, type MazemapGlobal, type MazemapSearchController } from './sdk';

export interface MazeMapConfig {
  /** MazeMap campus id. Must be confirmed by the University; never guessed. */
  campusId?: string;
  /** Campus view token, if the University's campus needs one. */
  viewToken?: string;
  /** Campus access token, for private maps. */
  authToken?: string;
}

/** MazeMap asks apps to request routes sparingly (each takes 1–5 s). */
const MIN_ROUTE_INTERVAL_MS = 30_000;

/**
 * Official MazeMap integration, behind the same MapProvider interface as LocalProvider.
 * Uses MazeMap's JS API for search, POI data, buildings, floors and routing.
 * Stays off until MAP_PROVIDER=mazemap and MAZEMAP_CAMPUS_ID are set.
 *
 * Not yet tested against the live API: payload shapes follow MazeMap's public docs.
 */
export class MazeMapProvider implements MapProvider {
  readonly id = 'mazemap' as const;
  readonly isSampleData = false;

  private search?: MazemapSearchController;
  private buildings?: Promise<Building[]>;
  private floors?: Promise<Floor[]>;
  private seen = new Map<string, Destination>();
  private lastRoute?: { key: string; at: number; route: Route };

  constructor(
    private readonly config: MazeMapConfig,
    private readonly loadSdk: () => Promise<MazemapGlobal> = () => loadMazemapSdk({ viewToken: config.viewToken, authToken: config.authToken }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** True when every value MazeMap needs is present. */
  static isConfigured(config: MazeMapConfig): boolean {
    return Boolean(config.campusId && /^\d+$/.test(config.campusId));
  }

  private get campusId(): number {
    if (!MazeMapProvider.isConfigured(this.config)) throw new ProviderNotConfiguredError('MazeMapProvider', ['MAZEMAP_CAMPUS_ID']);
    return Number(this.config.campusId);
  }

  private async sdk(): Promise<MazemapGlobal> {
    void this.campusId; // throws first if not configured
    return this.loadSdk();
  }

  private remember(list: Destination[]) {
    for (const d of list) this.seen.set(d.id, d);
    return list;
  }

  async searchDestinations(query: string, filters: SearchFilters = {}): Promise<Destination[]> {
    const mm = await this.sdk();
    const cats = filters.categories ?? [];
    // MazeMap search needs words; a category filter alone searches for its label.
    const q = query.trim() || cats.map((c: FilterCategory) => FILTER_LABELS[c]).join(' ');
    if (!q) return [];
    this.search ??= new mm.Search.SearchController({
      campusid: this.campusId,
      rows: Math.min(filters.limit ?? 20, 50),
      withpois: true,
      withbuilding: true,
      withtype: false,
      withcampus: false,
      resultsFormat: 'geojson',
    });
    const response = await this.search.search(q);
    const results = (response.results?.features ?? [])
      .map((f) => poiToDestination(f))
      .filter((d): d is Destination => d !== undefined);
    this.remember(results);
    // Apply filters and our own ranking on top of MazeMap's results.
    return query.trim() ? searchDestinationList(results, query, filters) : results.filter((d) => !cats.length || d.categories.some((c) => cats.includes(c)));
  }

  async getDestination(id: string): Promise<Destination | null> {
    if (this.seen.has(id)) return this.seen.get(id)!;
    const mm = await this.sdk();
    if (id.startsWith('mmbuilding:')) {
      const b = (await this.getBuildings()).find((x) => x.id === id);
      return b ? { id: b.id, name: b.name, kind: 'building', categories: b.categories, location: b.centroid, buildingId: b.id, buildingName: b.name } : null;
    }
    const poiId = parseMazemapPoiId(id);
    if (poiId === undefined) return null;
    try {
      const d = poiToDestination(await mm.Data.getPoi(poiId));
      return d ? this.remember([d])[0] : null;
    } catch {
      return null;
    }
  }

  async getBuildings(): Promise<Building[]> {
    if (!this.buildings) {
      const load = this.sdk().then(async (mm) => (await mm.Data.getBuildingsByCampusId(this.campusId)).map(toBuilding).filter((b): b is Building => b !== undefined));
      load.catch(() => (this.buildings = undefined));
      this.buildings = load;
    }
    return this.buildings;
  }

  async getFloors(buildingId: string): Promise<Floor[]> {
    if (!this.floors) {
      const load = this.sdk().then(async (mm) => (await mm.Data.getFloorsByCampusId(this.campusId)).map(toFloor).filter((f): f is Floor => f !== undefined));
      load.catch(() => (this.floors = undefined));
      this.floors = load;
    }
    return (await this.floors).filter((f) => f.buildingId === buildingId).sort((a, b) => a.level - b.level);
  }

  async getRoute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Promise<Route> {
    const mm = await this.sdk();
    const key = `${JSON.stringify(from)}>${JSON.stringify(to)}>${options.accessible}`;
    const toKey = `${JSON.stringify(to)}>${options.accessible}`;
    // Follow MazeMap's guidance: at most one route request per 30 s for the same trip.
    if (this.lastRoute && this.lastRoute.key.endsWith(toKey) && this.now().getTime() - this.lastRoute.at < MIN_ROUTE_INTERVAL_MS) {
      return this.lastRoute.route;
    }

    const [fromEnd, fromParams] = await this.endpoint(from, 'from');
    const [toEnd, toParams] = await this.endpoint(to, 'to');
    const trip = await mm.Data.getAtoBTrip({
      mode: 'PEDESTRIAN',
      ...(options.accessible ? { constraint: 'PREFER_ACCESSIBLE' } : {}),
      lang: 'en',
      ...fromParams,
      ...toParams,
    });
    const steps = trip?.getInstructionsSteps?.() ?? [];
    if (!steps.length) throw new NoRouteError(`No route found from ${fromEnd.name} to ${toEnd.name}.`);

    const floors = await this.floors?.catch(() => []);
    const route = tripToRoute(steps, {
      from: fromEnd,
      to: toEnd,
      accessible: options.accessible,
      id: `mm-route-${Math.abs(hash(key)).toString(36)}`,
      now: this.now(),
      floorName: (_b, z) => floors?.find((f) => f.level === z)?.name,
    });
    this.lastRoute = { key, at: this.now().getTime(), route };
    return route;
  }

  private async endpoint(e: RouteEndpoint, side: 'from' | 'to'): Promise<[RouteEnd, Record<string, unknown>]> {
    if (e.type === 'position') {
      const z = e.point.level ?? 1; // MazeMap's ground floor is commonly z = 1.
      return [
        { name: e.name ?? 'My location', point: e.point },
        { [`${side}LngLatZ`]: { lng: e.point.lng, lat: e.point.lat, z } },
      ];
    }
    const dest = await this.getDestination(e.destinationId);
    if (!dest) throw new NotFoundError('Destination', e.destinationId);
    const poiId = parseMazemapPoiId(dest.id);
    const end: RouteEnd = { name: dest.name, point: { lat: dest.location.lat, lng: dest.location.lng }, destinationId: dest.id };
    return [end, poiId !== undefined ? { [`${side}PoiId`]: poiId } : { [`${side}LngLatZ`]: { ...dest.location, z: dest.level ?? 1 } }];
  }
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h | 0;
}

export { mazemapBuildingId };
