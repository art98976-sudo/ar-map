/**
 * MazeMapProvider tests with a fake MazeMap SDK.
 * The fixtures are made up: they only mimic the shapes in MazeMap's public docs
 * (no real MazeMap or University data is stored in this repo).
 */
import { describe, expect, it } from 'vitest';
import { createMapProvider, LocalProvider, MazeMapProvider, ProviderNotConfiguredError } from '@/lib/providers';
import { categoriesFromText, poiToDestination, toBuilding, toFloor, tripToRoute } from '@/lib/providers/mazemap/adapters';
import type { MazemapGlobal, MazemapInstructionStep } from '@/lib/providers/mazemap/sdk';
import type { MapProvider } from '@/lib/providers';
import { validateRoute } from '@/lib/route/validateRoute';
import { fsDataSource } from './helpers';

const square = (lng: number, lat: number, d = 0.0002): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]],
});

const FAKE_POI: GeoJSON.Feature = {
  type: 'Feature',
  geometry: square(10, 50, 0.0001),
  properties: { poiId: 111, title: 'Example Seminar Room', buildingId: 7, buildingName: 'Example Hall', zLevel: 2, floorName: 'Level 2', types: [{ name: 'Seminar room' }] },
};

const FAKE_TRIP: MazemapInstructionStep[] = [
  { instruction: 'Walk north', geometry: { type: 'LineString', coordinates: [[10, 49.999], [10, 49.9995]] }, zLevel: null, buildingName: null },
  { instruction: 'Enter Example Hall', geometry: { type: 'LineString', coordinates: [[10, 49.9995], [10, 50]] }, zLevel: 1, buildingName: 'Example Hall' },
  { instruction: 'Turn left', geometry: { type: 'LineString', coordinates: [[10, 50], [10.0001, 50]] }, zLevel: 1, buildingName: 'Example Hall' },
  { instruction: 'Take the elevator to Level 2', geometry: null, zLevel: 1, buildingName: 'Example Hall' },
  { instruction: 'Walk to the room', geometry: { type: 'LineString', coordinates: [[10.0001, 50], [10.0001, 50.00005]] }, zLevel: 2, buildingName: 'Example Hall' },
  { instruction: 'You have reached your destination', geometry: null, zLevel: 2, buildingName: 'Example Hall' },
];

function fakeSdk(calls: Record<string, unknown[]> = {}): MazemapGlobal {
  const log = (name: string, arg: unknown) => (calls[name] ??= []).push(arg);
  return {
    Config: { setMazemapViewToken: () => {}, setMazemapAuthToken: () => {} },
    Search: {
      SearchController: class {
        constructor(opts: Record<string, unknown>) {
          log('searchOptions', opts);
        }
        async search(q: string) {
          log('search', q);
          return { results: { type: 'FeatureCollection' as const, features: [FAKE_POI] } };
        }
      },
    },
    Data: {
      getPoi: async (id: number) => (log('getPoi', id), FAKE_POI),
      getBuildingsByCampusId: async () => [{ id: 7, name: 'Example Hall', geometry: square(10, 50) }],
      getFloorsByCampusId: async () => [
        { id: 70, buildingId: 7, z: 2, name: 'Level 2' },
        { id: 71, buildingId: 7, z: 1, name: 'Level 1' },
      ],
      getAtoBTrip: async (params: Record<string, unknown>) => (log('trip', params), { getInstructionsSteps: () => FAKE_TRIP }),
    },
  };
}

describe('MazeMap adapters', () => {
  it('turns a POI into a destination with building and floor', () => {
    expect(poiToDestination(FAKE_POI)).toMatchObject({
      id: 'mmpoi:111',
      name: 'Example Seminar Room',
      kind: 'room',
      categories: ['teaching'],
      buildingId: 'mmbuilding:7',
      buildingName: 'Example Hall',
      level: 2,
      floorName: 'Level 2',
    });
  });

  it('skips POIs without an id or position', () => {
    expect(poiToDestination({ type: 'Feature', geometry: null as never, properties: { poiId: 1 } })).toBeUndefined();
    expect(poiToDestination({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })).toBeUndefined();
  });

  it('maps type names to filter categories', () => {
    expect(categoriesFromText('Café')).toEqual(['food']);
    expect(categoriesFromText('Bus stop')).toEqual(['transport']);
    expect(categoriesFromText('Lecture theatre')).toEqual(['teaching']);
  });

  it('converts buildings and floors', () => {
    expect(toBuilding({ id: 7, name: 'Example Hall', geometry: square(10, 50) })).toMatchObject({ id: 'mmbuilding:7', hasIndoorData: true });
    expect(toFloor({ id: 70, buildingId: 7, z: 2, name: 'Level 2' })).toEqual({ id: 'mmfloor:70', buildingId: 'mmbuilding:7', level: 2, name: 'Level 2' });
    expect(toBuilding({ id: 1 })).toBeUndefined();
  });

  it('turns a MazeMap trip into a schema-valid route with a floor change', () => {
    const route = tripToRoute(FAKE_TRIP, {
      from: { name: 'My location', point: { lat: 49.999, lng: 10 } },
      to: { name: 'Example Seminar Room', point: { lat: 50, lng: 10.0001 }, destinationId: 'mmpoi:111' },
      accessible: true,
      id: 'mm-test',
      now: new Date('2026-10-23T12:00:00Z'),
    });
    expect(validateRoute(route)).toEqual({ valid: true, errors: [] });
    expect(route.steps.map((s) => s.type)).toEqual(['walk', 'enter-building', 'turn', 'change-floor', 'walk', 'arrive']);
    expect(route.steps[3].floorChange).toMatchObject({ via: 'lift', fromLevel: 1, toLevel: 2 });
    expect(route.provider).toBe('mazemap');
    expect(route.isSampleData).toBe(false);
  });
});

describe('MazeMapProvider', () => {
  const make = (calls: Record<string, unknown[]> = {}, now = () => new Date('2026-10-23T12:00:00Z')) =>
    new MazeMapProvider({ campusId: '42' }, async () => fakeSdk(calls), now);

  it('searches within the configured campus', async () => {
    const calls: Record<string, unknown[]> = {};
    const results = await make(calls).searchDestinations('seminar');
    expect(results.map((d) => d.id)).toEqual(['mmpoi:111']);
    expect(calls.searchOptions[0]).toMatchObject({ campusid: 42, withpois: true, resultsFormat: 'geojson' });
  });

  it('returns buildings and sorted floors', async () => {
    const p = make();
    expect((await p.getBuildings()).map((b) => b.name)).toEqual(['Example Hall']);
    expect((await p.getFloors('mmbuilding:7')).map((f) => f.level)).toEqual([1, 2]);
  });

  it('asks MazeMap for an accessible route and returns our route format', async () => {
    const calls: Record<string, unknown[]> = {};
    const p = make(calls);
    const route = await p.getRoute(
      { type: 'position', point: { lat: 49.999, lng: 10 } },
      { type: 'destination', destinationId: 'mmpoi:111' },
      { accessible: true },
    );
    expect(validateRoute(route).valid).toBe(true);
    expect(calls.trip[0]).toMatchObject({ mode: 'PEDESTRIAN', constraint: 'PREFER_ACCESSIBLE', toPoiId: 111, fromLngLatZ: { lng: 10, lat: 49.999 } });
  });

  it('does not ask MazeMap again within 30 seconds for the same trip', async () => {
    const calls: Record<string, unknown[]> = {};
    let t = Date.parse('2026-10-23T12:00:00Z');
    const p = make(calls, () => new Date(t));
    const to = { type: 'destination' as const, destinationId: 'mmpoi:111' };
    await p.getRoute({ type: 'position', point: { lat: 49.999, lng: 10 } }, to, { accessible: false });
    t += 10_000;
    await p.getRoute({ type: 'position', point: { lat: 49.9991, lng: 10 } }, to, { accessible: false });
    expect(calls.trip).toHaveLength(1);
    t += 30_000;
    await p.getRoute({ type: 'position', point: { lat: 49.9992, lng: 10 } }, to, { accessible: false });
    expect(calls.trip).toHaveLength(2);
  });

  it('refuses to run without a numeric campus id', async () => {
    await expect(new MazeMapProvider({ campusId: 'TODO' }, async () => fakeSdk()).getBuildings()).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('switching MAP_PROVIDER', () => {
  it('gives the UI the same interface either way', async () => {
    const local = createMapProvider({ provider: 'local', dataSource: fsDataSource }).provider;
    const mazemap = createMapProvider({ provider: 'mazemap', mazemap: { campusId: '42' } }).provider;
    expect(local).toBeInstanceOf(LocalProvider);
    expect(mazemap).toBeInstanceOf(MazeMapProvider);
    const methods: (keyof MapProvider)[] = ['searchDestinations', 'getDestination', 'getBuildings', 'getFloors', 'getRoute'];
    for (const m of methods) {
      expect(typeof local[m]).toBe('function');
      expect(typeof mazemap[m]).toBe('function');
    }
  });

  it('both providers produce routes that pass the same schema', async () => {
    const local = new LocalProvider(fsDataSource);
    const a = await local.getRoute({ type: 'destination', destinationId: 'building:library' }, { type: 'destination', destinationId: 'room:cottrell-1-101' }, { accessible: true });
    const b = await new MazeMapProvider({ campusId: '42' }, async () => fakeSdk()).getRoute(
      { type: 'position', point: { lat: 49.999, lng: 10 } },
      { type: 'destination', destinationId: 'mmpoi:111' },
      { accessible: true },
    );
    expect(validateRoute(a).valid).toBe(true);
    expect(validateRoute(b).valid).toBe(true);
  });
});
