import type { DataSource } from '../../data/dataSource';
import {
  SAMPLE_FILES,
  type AreaProps,
  type BuildingProps,
  type EntranceProps,
  type IndoorData,
  type PathProps,
  type PlaceProps,
  type SampleCollection,
} from '../../data/sampleTypes';
import { polygonCentroid, toLatLng } from '../../geo/geo';
import type {
  Building,
  Destination,
  Entrance,
  Floor,
  IndoorFeatureProperties,
  IndoorMap,
  Route,
  RouteEndpoint,
  RouteOptions,
  SearchFilters,
} from '../../types';
import { buildWalkGraph } from '../../routing/graph';
import { LocalRouter } from '../../routing/router';
import type { MapOverlay, MapProvider } from '../MapProvider';
import { searchDestinationList } from './search';

/** Everything LocalProvider needs, loaded once. */
export interface LocalDataset {
  buildings: SampleCollection<GeoJSON.Polygon, BuildingProps>;
  paths: SampleCollection<GeoJSON.LineString, PathProps>;
  entrances: SampleCollection<GeoJSON.Point, EntranceProps>;
  places: SampleCollection<GeoJSON.Point, PlaceProps>;
  areas: SampleCollection<GeoJSON.Polygon, AreaProps>;
  indoor: Map<string, IndoorData>;
}

interface Index {
  data: LocalDataset;
  buildings: Building[];
  destinations: Destination[];
  destinationById: Map<string, Destination>;
  router: LocalRouter;
}

export interface LocalProviderOptions {
  /** Clock used for route timestamps (tests pass a fixed one). */
  now?: () => Date;
}

/**
 * Reads the approximate sample dataset in public/data and routes with A*
 * over its outdoor paths and the indoor corridors, stairs and lifts.
 */
export class LocalProvider implements MapProvider {
  readonly id = 'local' as const;
  readonly isSampleData = true;

  private index?: Promise<Index>;

  constructor(
    private readonly source: DataSource,
    private readonly options: LocalProviderOptions = {},
  ) {}

  /** Loads and indexes the dataset once; later calls reuse it. */
  private load(): Promise<Index> {
    if (!this.index) {
      this.index = loadDataset(this.source).then((data) => buildIndex(data, this.options));
      // Let a failed load be retried (e.g. after a network blip).
      this.index.catch(() => (this.index = undefined));
    }
    return this.index;
  }

  async getDataset(): Promise<LocalDataset> {
    return (await this.load()).data;
  }

  async searchDestinations(query: string, filters?: SearchFilters): Promise<Destination[]> {
    return searchDestinationList((await this.load()).destinations, query, filters);
  }

  async getDestination(id: string): Promise<Destination | null> {
    return (await this.load()).destinationById.get(id) ?? null;
  }

  async getBuildings(): Promise<Building[]> {
    return (await this.load()).buildings;
  }

  async getFloors(buildingId: string): Promise<Floor[]> {
    const { data } = await this.load();
    const floors = data.indoor.get(buildingId)?.floors ?? [];
    return [...floors].sort((a, b) => a.level - b.level);
  }

  async getRoute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Promise<Route> {
    return (await this.load()).router.route(from, to, options);
  }

  async getIndoorMap(buildingId: string): Promise<IndoorMap | null> {
    const { data } = await this.load();
    const indoor = data.indoor.get(buildingId);
    if (!indoor) return null;
    const features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.Point, IndoorFeatureProperties>[] = [];
    for (const f of indoor.features.features) {
      const p = f.properties;
      features.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          featureType: p.featureType,
          id: p.id,
          level: p.level,
          floorId: p.floorId,
          ...(p.name ? { name: p.name } : {}),
          ...(p.featureType === 'room' ? { destinationId: 'room:' + p.id } : {}),
        },
      });
    }
    const stepFree = new Map(data.entrances.features.map((f) => [f.properties.id, f.properties.stepFree]));
    for (const n of indoor.nodes.filter((x) => x.kind === 'entrance')) {
      const id = n.id.replace(/^entrance:/, '');
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
        properties: { featureType: 'entrance', id, name: n.name, level: n.level, stepFree: stepFree.get(id) ?? true },
      });
    }
    return { buildingId, floors: [...indoor.floors].sort((a, b) => a.level - b.level), features: { type: 'FeatureCollection', features } };
  }

  async getMapOverlay(): Promise<MapOverlay> {
    const { data } = await this.load();
    return { areas: data.areas, buildings: data.buildings, paths: data.paths, entrances: data.entrances, places: data.places };
  }
}

async function loadDataset(source: DataSource): Promise<LocalDataset> {
  const [buildings, paths, entrances, places, areas] = await Promise.all([
    source.loadJson<LocalDataset['buildings']>(SAMPLE_FILES.buildings),
    source.loadJson<LocalDataset['paths']>(SAMPLE_FILES.paths),
    source.loadJson<LocalDataset['entrances']>(SAMPLE_FILES.entrances),
    source.loadJson<LocalDataset['places']>(SAMPLE_FILES.places),
    source.loadJson<LocalDataset['areas']>(SAMPLE_FILES.areas),
  ]);
  const indoorIds = buildings.features.filter((f) => f.properties.hasIndoorData).map((f) => f.properties.id);
  const indoorFiles = await Promise.all(indoorIds.map((id) => source.loadJson<IndoorData>(SAMPLE_FILES.indoor(id))));
  const indoor = new Map(indoorFiles.map((d) => [d.buildingId, d]));
  return { buildings, paths, entrances, places, areas, indoor };
}

function buildIndex(data: LocalDataset, options: LocalProviderOptions): Index {
  const entrancesByBuilding = new Map<string, Entrance[]>();
  for (const f of data.entrances.features) {
    const p = f.properties;
    const list = entrancesByBuilding.get(p.buildingId) ?? [];
    list.push({ ...p, location: toLatLng(f.geometry.coordinates) });
    entrancesByBuilding.set(p.buildingId, list);
  }

  const buildings: Building[] = data.buildings.features.map((f) => ({
    ...f.properties,
    centroid: polygonCentroid(f.geometry),
    footprint: f.geometry,
    entrances: entrancesByBuilding.get(f.properties.id) ?? [],
  }));
  const buildingName = new Map(buildings.map((b) => [b.id, b.name]));

  const destinations: Destination[] = [];

  for (const b of buildings) {
    destinations.push({
      id: `building:${b.id}`,
      name: b.name,
      kind: 'building',
      categories: b.categories,
      location: b.centroid,
      buildingId: b.id,
      buildingName: b.name,
      description: b.description,
      aliases: b.shortName ? [b.shortName] : [],
    });
  }

  for (const f of data.places.features) {
    const { id, buildingId, aliases, ...p } = f.properties;
    destinations.push({
      ...p,
      id: `place:${id}`,
      location: toLatLng(f.geometry.coordinates),
      aliases: aliases ?? [],
      ...(buildingId ? { buildingId, buildingName: buildingName.get(buildingId) } : {}),
    });
  }

  for (const indoor of data.indoor.values()) {
    for (const f of indoor.features.features) {
      const p = f.properties;
      if (p.featureType !== 'room' || !p.name) continue;
      destinations.push({
        id: `room:${p.id}`,
        name: p.name,
        kind: p.kind ?? 'room',
        categories: p.categories ?? [],
        location: polygonCentroid(f.geometry),
        buildingId: p.buildingId,
        buildingName: buildingName.get(p.buildingId),
        floorId: p.floorId,
        floorName: indoor.floors.find((fl) => fl.id === p.floorId)?.name,
        level: p.level,
      });
    }
  }

  const destinationById = new Map(destinations.map((d) => [d.id, d]));
  const router = new LocalRouter({
    built: buildWalkGraph(data.paths, data.indoor.values()),
    buildings,
    getDestination: (id) => destinationById.get(id),
    provider: 'local',
    isSampleData: true,
    now: options.now,
  });

  return { data, buildings, destinations, destinationById, router };
}
