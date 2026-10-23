/**
 * MazeMapProvider tests with a fake fetch. The fixtures are made up: they copy the *shape* of
 * MazeMap's responses (checked against the live services) but none of its data.
 * For a check against the real services, run `npm run test:live`.
 */
import { describe, expect, it } from 'vitest';
import { createMapProvider, LocalProvider, MazeMapProvider, ProviderNotConfiguredError, type MapProvider } from '@/lib/providers';
import {
  categoriesFromText,
  floorLabel,
  mazemapRouteToRoute,
  poiToDestination,
  searchResultToDestination,
  stripTags,
  tidyInstruction,
  toBuilding,
  toFloors,
} from '@/lib/providers/mazemap/adapters';
import { MazemapClient, type MazemapDirections, type MazemapPath } from '@/lib/providers/mazemap/client';
import { validateRoute } from '@/lib/route/validateRoute';
import { fsDataSource } from './helpers';

const sq = (lng: number, lat: number, d = 0.0002): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]],
});
const pt = (lng: number, lat: number): GeoJSON.Point => ({ type: 'Point', coordinates: [lng, lat] });

const SEARCH = {
  result: [
    { solrId: 'poi11', poiId: 11, title: '<em>Example</em> Café', dispTypeNames: ['Café'], dispBldNames: ['Example Hall'], buildingId: 7, zValue: 2, zName: '2', poiNames: ['Example Café', 'EX/2/01'], identifier: 'EX/2/01', point: pt(10, 50) },
    { solrId: 'poi12', poiId: 12, title: 'Store', dispTypeNames: ['Hidden'], buildingId: 7, zValue: 1, point: pt(10, 50) },
    { solrId: 'poi13', poiId: 13, title: 'Car Park A', dispTypeNames: ['Parking Space'], point: pt(10.001, 50) },
    { solrId: 'poi14', poiId: 14, title: 'Car Park A', dispTypeNames: ['Parking Space'], point: pt(10.0011, 50) },
    { solrId: 'bld7', poiId: 70, id: 7, buildingId: 7, title: 'Example Hall', dispBldNames: ['Example Hall'], dispTypeNames: [], point: pt(10.0001, 50.0001) },
    { solrId: 'poi15', poiId: 15, title: 'null', point: pt(10, 50) },
  ],
};

const BUILDINGS = {
  buildings: [
    { id: 7, name: 'Example Hall', fullOutline: sq(10, 50), floors: [{ id: 72, buildingId: 7, z: 2, name: '2' }, { id: 71, buildingId: 7, z: 1, name: '1' }] },
    { id: 8, name: 'No Outline' },
  ],
};

const POI = { poiId: 11, title: 'Example Café', buildingId: 7, buildingName: 'Example Hall', floorName: '2', z: 2, types: [{ name: 'Café' }], point: pt(10, 50) };

const line = (coords: number[][], z: number | null, buildingId: number | null): GeoJSON.Feature<GeoJSON.LineString, { m: number; z: number | null; buildingId: number | null; flags: string[] }> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: { m: 1, z, buildingId, flags: [] },
});

// Outside -> enter Example Hall on floor 1 -> lift to floor 2 -> room.
const PATH: MazemapPath = {
  path: {
    type: 'FeatureCollection',
    features: [
      line([[9.999, 49.999], [10, 49.9995]], 1, null),
      line([[10, 49.9995], [10, 50]], 1, 7),
      line([[10, 50], [10.0001, 50]], 1, 7),
      line([[10.0001, 50], [10.0001, 50]], 2, 7),
      line([[10.0001, 50], [10.0001, 50.0001]], 2, 7),
    ],
  },
};
const DIRECTIONS: MazemapDirections = {
  routes: [{
    legs: [{
      steps: [
        { instruction: 'You are starting your route guidance. Face north.', geometry: null },
        { instruction: 'Walk forward 55 meters.', geometry: { type: 'LineString', coordinates: [[9.999, 49.999], [10, 49.9995]] } },
        { instruction: 'Entering the Example Hall building walk forward 55 meters.', geometry: { type: 'LineString', coordinates: [[10, 49.9995], [10, 50]] } },
        { instruction: 'Turn right and walk 7 meters. There should be an elevator to your left.', geometry: { type: 'LineString', coordinates: [[10, 50], [10.0001, 50]] } },
        { instruction: 'Take the elevator up to floor 2.', geometry: { type: 'LineString', coordinates: [[10.0001, 50], [10.0001, 50]] } },
        { instruction: 'Exit the elevator and walk forward 11 meters.', geometry: { type: 'LineString', coordinates: [[10.0001, 50], [10.0001, 50.0001]] } },
        { instruction: 'You have reached Example Café. You should now be at your destination.', geometry: null },
      ],
    }],
  }],
};

/** A fetch that answers from the fixtures and records the URLs it was asked for. */
function fakeFetch(calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes('/search/equery/')) return json(SEARCH);
    if (url.includes('/api/buildings/')) return json(BUILDINGS);
    if (url.includes('/api/pois/closestpoi/')) return json({}, 404);
    if (url.includes('/api/pois/')) return json(POI);
    if (url.includes('/routing/path/')) return json(PATH);
    if (url.includes('/routing/directions/')) return json(DIRECTIONS);
    return json({}, 404);
  }) as typeof fetch;
}

const make = (calls: string[] = [], now = () => new Date('2026-10-23T12:00:00Z')) =>
  new MazeMapProvider({ campusId: '42' }, new MazemapClient(42, fakeFetch(calls)), now);

describe('MazeMap adapters', () => {
  it('cleans names, floors and wording', () => {
    expect(stripTags('<em>Cafe</em>  Bar')).toBe('Cafe Bar');
    expect(floorLabel('2')).toBe('Floor 2');
    expect(floorLabel('Ground')).toBe('Ground');
    expect(floorLabel(null, -1)).toBe('Floor -1');
    expect(tidyInstruction('Take the elevator  up . Walk 1 meter and 3 meters')).toBe('Take the lift up. Walk 1 metre and 3 metres');
    expect(tidyInstruction('You are starting your route guidance. Face east and follow the directions to reach your destination.')).toBe('Start facing east');
    expect(tidyInstruction('You are starting inside the room Library. Face south and follow the directions to reach your destination.')).toBe('Start in Library, facing south');
    expect(categoriesFromText('Learning Spaces')).toEqual(['study']);
    expect(categoriesFromText('Parking Space')).toEqual(['transport']);
  });

  it('turns search hits into destinations and skips hidden or nameless ones', () => {
    const list = SEARCH.result.map((r) => searchResultToDestination(r as never)).filter(Boolean);
    expect(list.map((d) => d!.id)).toEqual(['mmpoi:11', 'mmpoi:13', 'mmpoi:14', 'mmbuilding:7']);
    expect(list[0]).toMatchObject({ name: 'Example Café', kind: 'cafe', categories: ['food'], buildingName: 'Example Hall', level: 2, floorName: 'Floor 2', aliases: ['EX/2/01'] });
    expect(list[3]).toMatchObject({ kind: 'building', name: 'Example Hall' });
  });

  it('converts a POI, buildings and floors', () => {
    expect(poiToDestination(POI as never)).toMatchObject({ id: 'mmpoi:11', buildingId: 'mmbuilding:7', level: 2, floorName: 'Floor 2' });
    expect(toBuilding(BUILDINGS.buildings[0] as never)).toMatchObject({ id: 'mmbuilding:7', hasIndoorData: true });
    expect(toBuilding(BUILDINGS.buildings[1] as never)).toBeUndefined();
    expect(toFloors(BUILDINGS.buildings[0] as never).map((f) => f.name)).toEqual(['Floor 1', 'Floor 2']);
  });

  it('turns a MazeMap path and directions into a schema-valid route', () => {
    const route = mazemapRouteToRoute(PATH, DIRECTIONS, {
      from: { name: 'My location', point: { lat: 49.999, lng: 9.999 } },
      to: { name: 'Example Café', point: { lat: 50.0001, lng: 10.0001 }, destinationId: 'mmpoi:11' },
      accessible: true,
      id: 'mm-test',
      now: new Date('2026-10-23T12:00:00Z'),
      floorName: (_b, z) => `Floor ${z}`,
    });
    expect(validateRoute(route)).toEqual({ valid: true, errors: [] });
    expect(route.steps.map((s) => s.type)).toEqual(['walk', 'walk', 'enter-building', 'turn', 'change-floor', 'walk', 'arrive']);
    expect(route.steps[4]).toMatchObject({ instruction: 'Take the lift up to floor 2.', floorChange: { via: 'lift', fromLevel: 1, toLevel: 2, toFloorName: 'Floor 2' } });
    expect(route.steps[2].buildingId).toBe('mmbuilding:7');
    expect(route.steps.at(-1)!.instruction).toBe('You have arrived at Example Café, Floor 2');
    // Outdoor points have no level; indoor points carry building and level.
    expect(route.steps[1].path[0].level).toBeUndefined();
    expect(route.steps[5].path[0]).toMatchObject({ buildingId: 'mmbuilding:7', level: 2 });
  });

  it('builds steps from the path alone when written directions are missing', () => {
    const route = mazemapRouteToRoute(PATH, null, {
      from: { name: 'A', point: { lat: 49.999, lng: 9.999 } },
      to: { name: 'B', point: { lat: 50, lng: 10 } },
      accessible: false,
      id: 'x',
      now: new Date(),
    });
    expect(validateRoute(route).valid).toBe(true);
    expect(route.steps.some((s) => s.type === 'change-floor')).toBe(true);
  });
});

describe('MazeMapProvider', () => {
  it('searches the configured campus and merges repeated car-park spaces', async () => {
    const calls: string[] = [];
    const results = await make(calls).searchDestinations('example');
    expect(results.map((d) => d.name)).toEqual(['Example Café', 'Car Park A', 'Example Hall']);
    expect(calls[0]).toContain('campusid=42');
  });

  it('applies filter chips', async () => {
    const food = await make().searchDestinations('example', { categories: ['food'] });
    expect(food.map((d) => d.id)).toEqual(['mmpoi:11']);
  });

  it('returns buildings, sorted floors and single places', async () => {
    const p = make();
    expect((await p.getBuildings()).map((b) => b.name)).toEqual(['Example Hall']);
    expect((await p.getFloors('mmbuilding:7')).map((f) => f.level)).toEqual([1, 2]);
    expect((await p.getDestination('mmpoi:11'))?.name).toBe('Example Café');
    expect(await p.getDestination('room:not-mazemap')).toBeNull();
    expect(await p.getDestinationAt({ lat: 50, lng: 10 }, 1)).toBeNull();
  });

  it('asks for a step-free route with hc=true and returns our route format', async () => {
    const calls: string[] = [];
    const route = await make(calls).getRoute(
      { type: 'position', point: { lat: 49.999, lng: 9.999 } },
      { type: 'destination', destinationId: 'mmpoi:11' },
      { accessible: true },
    );
    expect(validateRoute(route).valid).toBe(true);
    const routing = calls.find((u) => u.includes('/routing/path/'))!;
    expect(routing).toContain('hc=true');
    expect(routing).toContain('targetpoi=11');
    expect(routing).toContain('sourcelat=49.999');
  });

  it('routes to a building found in search through its POI', async () => {
    const calls: string[] = [];
    const p = make(calls);
    await p.searchDestinations('example');
    await p.getRoute({ type: 'position', point: { lat: 49.999, lng: 9.999 } }, { type: 'destination', destinationId: 'mmbuilding:7' }, { accessible: false });
    expect(calls.find((u) => u.includes('/routing/path/'))).toContain('targetpoi=70');
  });

  it('does not ask MazeMap again within 30 seconds while only "My location" moves', async () => {
    const calls: string[] = [];
    let t = Date.parse('2026-10-23T12:00:00Z');
    const p = make(calls, () => new Date(t));
    const to = { type: 'destination' as const, destinationId: 'mmpoi:11' };
    const count = () => calls.filter((u) => u.includes('/routing/path/')).length;
    await p.getRoute({ type: 'position', point: { lat: 49.999, lng: 9.999 } }, to, { accessible: false });
    t += 10_000;
    await p.getRoute({ type: 'position', point: { lat: 49.9991, lng: 9.999 } }, to, { accessible: false });
    expect(count()).toBe(1);
    t += 30_000;
    await p.getRoute({ type: 'position', point: { lat: 49.9992, lng: 9.999 } }, to, { accessible: false });
    expect(count()).toBe(2);
  });

  it('tells the UI to draw MazeMap\'s own map', () => {
    expect(make().baseMap).toMatchObject({ kind: 'mazemap', campusId: 42 });
  });

  it('refuses to run without a numeric campus id', async () => {
    await expect(new MazeMapProvider({ campusId: 'TODO' }).getBuildings()).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('switching MAP_PROVIDER', () => {
  it('gives the UI the same interface either way', () => {
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
    const a = await new LocalProvider(fsDataSource).getRoute(
      { type: 'destination', destinationId: 'building:library' },
      { type: 'destination', destinationId: 'room:cottrell-1-101' },
      { accessible: true },
    );
    const b = await make().getRoute({ type: 'position', point: { lat: 49.999, lng: 9.999 } }, { type: 'destination', destinationId: 'mmpoi:11' }, { accessible: true });
    expect(validateRoute(a).valid).toBe(true);
    expect(validateRoute(b).valid).toBe(true);
  });
});
