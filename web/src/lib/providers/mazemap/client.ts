/**
 * Thin client for MazeMap's public web services: the same search, data and routing services
 * MazeMap's own JS API calls. Requests are made only on user actions (typing, tapping, routing),
 * in line with MazeMap's usage guidelines. Nothing is stored in the repo.
 */

export const MAZEMAP_URLS = {
  search: 'https://search.mazemap.com/search/equery/',
  api: 'https://api.mazemap.com/api',
  routing: 'https://routing.mazemap.com/routing',
} as const;

export interface MazemapSearchResult {
  poiId?: number;
  kind?: string;
  title?: string | null;
  identifier?: string | null;
  poiNames?: string[];
  dispTypeNames?: string[];
  typeNames?: string[];
  dispBldNames?: string[];
  buildingId?: number | null;
  bldId?: number | null;
  zValue?: number | null;
  zName?: string | null;
  description?: string | null;
  point?: GeoJSON.Point | null;
  geometry?: GeoJSON.Geometry | null;
}

export interface MazemapPoi {
  poiId: number;
  kind?: string;
  title?: string | null;
  identifier?: string | null;
  buildingId?: number | null;
  buildingName?: string | null;
  floorName?: string | null;
  z?: number | null;
  types?: { name?: string }[];
  infos?: { name?: string }[];
  description?: string | null;
  point?: GeoJSON.Point | null;
  geometry?: GeoJSON.Geometry | null;
}

export interface MazemapFloorRaw {
  id: number;
  buildingId: number;
  z: number;
  name?: string | null;
}

export interface MazemapBuildingRaw {
  id: number;
  name?: string | null;
  floors?: MazemapFloorRaw[];
  fullOutline?: GeoJSON.Geometry | null;
  visibleOutline?: GeoJSON.Geometry | null;
  simpleGeom?: GeoJSON.Geometry | null;
}

export interface MazemapPathFeatureProps {
  m?: number;
  z?: number | null;
  buildingId?: number | null;
  flags?: string[];
  timeEstimateSeconds?: number;
}

export interface MazemapPath {
  path: GeoJSON.FeatureCollection<GeoJSON.LineString, MazemapPathFeatureProps>;
}

export interface MazemapDirections {
  routes?: { legs?: { steps?: { instruction?: string; geometry?: GeoJSON.LineString | null }[] }[] }[];
}

export type RouteEndParam =
  | { poi: number }
  | { lat: number; lng: number; z?: number };

export class MazemapHttpError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`MazeMap returned ${status} for ${url.split('?')[0]}`);
    this.name = 'MazemapHttpError';
  }
}

type Fetch = typeof fetch;

export class MazemapClient {
  constructor(
    private readonly campusId: number,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
    private readonly timeoutMs = 10_000,
  ) {}

  private async get<T>(url: string): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) throw new MazemapHttpError(res.status, url);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async search(q: string, rows = 20): Promise<MazemapSearchResult[]> {
    const params = new URLSearchParams({
      q, rows: String(rows), withpois: 'true', withbuilding: 'true', withtype: 'true', withcampus: 'false', campusid: String(this.campusId),
    });
    const j = await this.get<{ result?: MazemapSearchResult[] }>(`${MAZEMAP_URLS.search}?${params}`);
    return j.result ?? [];
  }

  poi(poiId: number): Promise<MazemapPoi> {
    return this.get<MazemapPoi>(`${MAZEMAP_URLS.api}/pois/${poiId}/?srid=4326`);
  }

  /** The room or place at a point on a floor, or null when there is none. */
  async poiAt(lat: number, lng: number, z: number): Promise<MazemapPoi | null> {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), z: String(z), campusid: String(this.campusId), srid: '4326' });
    try {
      return await this.get<MazemapPoi>(`${MAZEMAP_URLS.api}/pois/closestpoi/?${params}`);
    } catch (e) {
      if (e instanceof MazemapHttpError && e.status === 404) return null;
      throw e;
    }
  }

  async buildings(): Promise<MazemapBuildingRaw[]> {
    const j = await this.get<{ buildings?: MazemapBuildingRaw[] }>(`${MAZEMAP_URLS.api}/buildings/?campusid=${this.campusId}&srid=4326`);
    return j.buildings ?? [];
  }

  /** Path (geometry with floors and buildings) plus MazeMap's written directions. */
  async route(from: RouteEndParam, to: RouteEndParam, accessible: boolean): Promise<{ path: MazemapPath; directions: MazemapDirections | null }> {
    const q = new URLSearchParams({ srid: '4326', hc: accessible ? 'true' : 'false', lang: 'en', distanceunitstype: 'metric', mode: 'PEDESTRIAN' });
    const put = (side: 'source' | 'target', e: RouteEndParam) => {
      if ('poi' in e) q.set(`${side}poi`, String(e.poi));
      else {
        q.set(`${side}lat`, String(e.lat));
        q.set(`${side}lon`, String(e.lng));
        if (e.z !== undefined) q.set(`${side}z`, String(e.z));
      }
    };
    put('source', from);
    put('target', to);
    const [path, directions] = await Promise.all([
      this.get<MazemapPath>(`${MAZEMAP_URLS.routing}/path/?${q}`),
      this.get<MazemapDirections>(`${MAZEMAP_URLS.routing}/directions/?${q}`).catch(() => null),
    ]);
    return { path, directions };
  }
}
