import type {
  Building,
  Destination,
  FilterCategory,
  Floor,
  LatLng,
  Route,
  RouteEnd,
  RouteEndpoint,
  RouteOptions,
  SearchFilters,
} from '../../types';
import { NoRouteError, NotFoundError, ProviderNotConfiguredError } from '../errors';
import type { MapProvider, MazeMapBaseMap } from '../MapProvider';
import {
  CATEGORY_SEARCH_WORDS,
  buildingPoiFromSearch,
  mazemapRouteToRoute,
  parseMazemapBuildingId,
  parseMazemapPoiId,
  poiToDestination,
  searchResultToDestination,
  toBuilding,
  toFloors,
} from './adapters';
import { MazemapClient, type MazemapBuildingRaw, type RouteEndParam } from './client';
import { MAZEMAP_SDK_VERSION } from './sdk';

export interface MazeMapConfig {
  /** MazeMap campus id (University of Stirling: 2058). */
  campusId?: string;
  /** Campus view token, if the campus needs one. */
  viewToken?: string;
  /** Campus access token, for private maps. */
  authToken?: string;
}

/** MazeMap asks apps to request routes sparingly (each takes 1–5 s). */
export const MIN_ROUTE_INTERVAL_MS = 30_000;

/**
 * The University's real campus data from MazeMap, behind the same MapProvider interface as
 * LocalProvider: search, places, buildings, floors and official indoor/outdoor routes.
 * The map itself is MazeMap's own (see `baseMap`), with indoor floor plans.
 */
export class MazeMapProvider implements MapProvider {
  readonly id = 'mazemap' as const;
  readonly isSampleData = false;

  private readonly client?: MazemapClient;
  /** Tells the UI to draw MazeMap's campus map (with indoor floors) instead of the plain base map. Fixed per provider. */
  readonly baseMap?: MazeMapBaseMap;
  private rawBuildings?: Promise<MazemapBuildingRaw[]>;
  private allPlaces?: Promise<Destination[]>;
  private readonly seen = new Map<string, Destination>();
  private readonly buildingPoi = new Map<string, number>();
  private lastRoute?: { tripKey: string; at: number; route: Route };

  constructor(
    private readonly config: MazeMapConfig,
    client?: MazemapClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (MazeMapProvider.isConfigured(config)) {
      this.client = client ?? new MazemapClient(Number(config.campusId));
      this.baseMap = {
        kind: 'mazemap',
        campusId: Number(config.campusId),
        sdkVersion: MAZEMAP_SDK_VERSION,
        viewToken: config.viewToken,
        authToken: config.authToken,
      };
    }
  }

  /** True when every value MazeMap needs is present. */
  static isConfigured(config: MazeMapConfig): boolean {
    return Boolean(config.campusId && /^\d+$/.test(config.campusId));
  }


  private get api(): MazemapClient {
    if (!this.client) throw new ProviderNotConfiguredError('MazeMapProvider', ['MAZEMAP_CAMPUS_ID']);
    return this.client;
  }

  private remember(list: Destination[]): Destination[] {
    for (const d of list) this.seen.set(d.id, d);
    return list;
  }

  private async searchRaw(q: string, rows: number): Promise<Destination[]> {
    const raw = await this.api.search(q, rows);
    for (const r of raw) {
      const bp = buildingPoiFromSearch(r);
      if (bp) this.buildingPoi.set(bp[0], bp[1]);
    }
    // Car parks list every space under one name: keep one per name and building.
    const seenNames = new Set<string>();
    const out: Destination[] = [];
    for (const d of raw.map(searchResultToDestination)) {
      if (!d) continue;
      const k = `${d.name.toLowerCase()}|${d.buildingId ?? ''}|${d.kind}`;
      if (seenNames.has(k)) continue;
      seenNames.add(k);
      out.push(d);
    }
    return this.remember(out);
  }

  async searchDestinations(query: string, filters: SearchFilters = {}): Promise<Destination[]> {
    const cats = filters.categories ?? [];
    const limit = filters.limit ?? 20;
    const inCats = (d: Destination) => !cats.length || d.categories.some((c) => cats.includes(c));

    if (!query.trim()) {
      // No words: list places for the chosen filters (or everything, for Explore).
      const all = await this.listPlaces(cats);
      return all.filter(inCats).slice(0, limit);
    }
    const results = await this.searchRaw(query.trim(), Math.min(50, Math.max(limit, 20)));
    return results.filter(inCats).slice(0, limit);
  }

  /** Buildings plus a few keyword searches per category. Fetched once, on demand. */
  private async listPlaces(cats: FilterCategory[]): Promise<Destination[]> {
    if (cats.length) {
      const words = [...new Set(cats.flatMap((c) => CATEGORY_SEARCH_WORDS[c]))];
      const lists = await Promise.all(words.map((w) => this.searchRaw(w, 30).catch(() => [])));
      return dedupe(lists.flat());
    }
    if (!this.allPlaces) {
      const load = (async () => {
        const buildings = (await this.getBuildings()).map(buildingDestination);
        const words = [...new Set(Object.values(CATEGORY_SEARCH_WORDS).flat())];
        const lists = await Promise.all(words.map((w) => this.searchRaw(w, 30).catch(() => [])));
        return this.remember(dedupe([...buildings, ...lists.flat()]));
      })();
      load.catch(() => (this.allPlaces = undefined));
      this.allPlaces = load;
    }
    return this.allPlaces;
  }

  async getDestination(id: string): Promise<Destination | null> {
    const cached = this.seen.get(id);
    if (cached) return cached;
    const buildingNum = parseMazemapBuildingId(id);
    if (buildingNum !== undefined) {
      const b = (await this.getBuildings()).find((x) => x.id === id);
      return b ? this.remember([buildingDestination(b)])[0] : null;
    }
    const poiId = parseMazemapPoiId(id);
    if (poiId === undefined) return null;
    try {
      const d = poiToDestination(await this.api.poi(poiId));
      return d ? this.remember([d])[0] : null;
    } catch {
      return null;
    }
  }

  /** The room or place at a tapped point on the map's current floor. */
  async getDestinationAt(point: LatLng, level: number): Promise<Destination | null> {
    const poi = await this.api.poiAt(point.lat, point.lng, level).catch(() => null);
    const d = poi ? poiToDestination(poi) : undefined;
    return d ? this.remember([d])[0] : null;
  }

  private buildingsRaw(): Promise<MazemapBuildingRaw[]> {
    if (!this.rawBuildings) {
      const load = this.api.buildings();
      load.catch(() => (this.rawBuildings = undefined));
      this.rawBuildings = load;
    }
    return this.rawBuildings;
  }

  async getBuildings(): Promise<Building[]> {
    return (await this.buildingsRaw()).map(toBuilding).filter((b): b is Building => b !== undefined);
  }

  async getFloors(buildingId: string): Promise<Floor[]> {
    const id = parseMazemapBuildingId(buildingId);
    const raw = (await this.buildingsRaw()).find((b) => b.id === id);
    return raw ? toFloors(raw) : [];
  }

  async getRoute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Promise<Route> {
    const tripKey = `${JSON.stringify(to)}>${options.accessible}`;
    const fromKey = JSON.stringify(from);
    // Follow MazeMap's guidance: when only "My location" moved, reuse the route for 30 s.
    if (
      this.lastRoute &&
      this.lastRoute.tripKey === tripKey &&
      from.type === 'position' &&
      this.now().getTime() - this.lastRoute.at < MIN_ROUTE_INTERVAL_MS
    ) {
      return this.lastRoute.route;
    }

    const [fromEnd, fromParam] = await this.endpoint(from);
    const [toEnd, toParam] = await this.endpoint(to);
    const { path, directions } = await this.api.route(fromParam, toParam, options.accessible);
    if (!path?.path?.features?.length) throw new NoRouteError(`No route found from ${fromEnd.name} to ${toEnd.name}.`);

    const raw = await this.buildingsRaw().catch(() => []);
    const route = mazemapRouteToRoute(path, directions, {
      from: fromEnd,
      to: toEnd,
      accessible: options.accessible,
      id: `mm-route-${hash(`${fromKey}>${tripKey}`)}`,
      now: this.now(),
      floorName: (b, z) => {
        const floors = raw.find((x) => x.id === b)?.floors;
        const f = floors?.find((x) => x.z === z);
        return f ? toFloors({ id: b!, floors: [f] })[0]?.name : undefined;
      },
    });
    this.lastRoute = { tripKey, at: this.now().getTime(), route };
    return route;
  }

  private async endpoint(e: RouteEndpoint): Promise<[RouteEnd, RouteEndParam]> {
    if (e.type === 'position') {
      return [
        { name: e.name ?? 'My location', point: e.point },
        { lat: e.point.lat, lng: e.point.lng, ...(e.point.level !== undefined ? { z: e.point.level } : {}) },
      ];
    }
    const dest = await this.getDestination(e.destinationId);
    if (!dest) throw new NotFoundError('Destination', e.destinationId);
    const end: RouteEnd = { name: dest.name, point: { lat: dest.location.lat, lng: dest.location.lng }, destinationId: dest.id };
    const poi = parseMazemapPoiId(dest.id) ?? this.buildingPoi.get(dest.id);
    if (poi !== undefined) return [end, { poi }];
    // A building without a known POI: route to its outline centre on the lowest floor.
    const floors = await this.getFloors(dest.id);
    return [end, { lat: dest.location.lat, lng: dest.location.lng, ...(floors[0] ? { z: floors[0].level } : {}) }];
  }
}

function buildingDestination(b: Building): Destination {
  return { id: b.id, name: b.name, kind: 'building', categories: b.categories, location: b.centroid, buildingId: b.id, buildingName: b.name };
}

function dedupe(list: Destination[]): Destination[] {
  const seen = new Set<string>();
  return list.filter((d) => !seen.has(d.id) && (seen.add(d.id), true));
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
