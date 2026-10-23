import { describe, expect, it } from 'vitest';
import type {
  AreaProps,
  BuildingProps,
  EntranceProps,
  IndoorData,
  PathProps,
  PlaceProps,
  SampleCollection,
} from '@/lib/data/sampleTypes';
import { FILTER_CATEGORIES } from '@/lib/types';
import { readJson } from './helpers';

const buildings = readJson<SampleCollection<GeoJSON.Polygon, BuildingProps>>('campus/buildings.geojson');
const paths = readJson<SampleCollection<GeoJSON.LineString, PathProps>>('campus/paths.geojson');
const entrances = readJson<SampleCollection<GeoJSON.Point, EntranceProps>>('campus/entrances.geojson');
const places = readJson<SampleCollection<GeoJSON.Point, PlaceProps>>('campus/places.geojson');
const areas = readJson<SampleCollection<GeoJSON.Polygon, AreaProps>>('campus/areas.geojson');
const cottrell = readJson<IndoorData>('indoor/cottrell.json');

/** Rough box around the University of Stirling campus, to catch typos in coordinates. */
const CAMPUS = { south: 56.14, north: 56.152, west: -3.93, east: -3.91 };
const onCampus = ([lng, lat]: GeoJSON.Position) =>
  lat > CAMPUS.south && lat < CAMPUS.north && lng > CAMPUS.west && lng < CAMPUS.east;
const key = ([lng, lat]: GeoJSON.Position) => `${lng},${lat}`;

function isConnected(nodes: string[], edges: [string, string][]): boolean {
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const seen = new Set([nodes[0]]);
  const queue = [nodes[0]];
  while (queue.length) {
    for (const n of adj.get(queue.shift()!)!) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size === nodes.length;
}

describe('sample data', () => {
  it('marks every file as sample data', () => {
    for (const file of [buildings, paths, entrances, places, areas, cottrell]) {
      expect(file._meta?.sample).toBe(true);
      expect(file._meta?.notice).toMatch(/SAMPLE DATA/);
    }
  });

  it('contains the required main buildings', () => {
    expect(buildings.features.map((f) => f.properties.name)).toEqual(
      expect.arrayContaining([
        'Cottrell Building', 'Library', 'Campus Central', 'INTO Building', 'Pathfoot Building',
        'Sports Centre', "Students' Union", 'Airthrey Castle', 'Accommodation Village',
      ]),
    );
  });

  it('has unique ids in each file', () => {
    for (const fc of [buildings, paths, entrances, places, areas]) {
      const ids = fc.features.map((f) => (f.properties as { id: string }).id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps every coordinate on campus', () => {
    const all = [
      ...buildings.features.flatMap((f) => f.geometry.coordinates[0]),
      ...paths.features.flatMap((f) => f.geometry.coordinates),
      ...entrances.features.map((f) => f.geometry.coordinates),
      ...places.features.map((f) => f.geometry.coordinates),
      ...cottrell.nodes.map((n) => [n.lng, n.lat]),
    ];
    expect(all.filter((c) => !onCampus(c))).toEqual([]);
  });

  it('uses only known filter categories', () => {
    const used = [...buildings.features, ...places.features].flatMap((f) => f.properties.categories);
    expect(used.filter((c) => !FILTER_CATEGORIES.includes(c))).toEqual([]);
  });

  it('has a single connected outdoor path network', () => {
    const edges = paths.features.map((f) => {
      const c = f.geometry.coordinates;
      return [key(c[0]), key(c[c.length - 1])] as [string, string];
    });
    expect(isConnected([...new Set(edges.flat())], edges)).toBe(true);
  });

  it('places every entrance on the path network and on a known building', () => {
    const pathNodes = new Set(paths.features.flatMap((f) => f.geometry.coordinates.map(key)));
    const buildingIds = new Set(buildings.features.map((f) => f.properties.id));
    for (const e of entrances.features) {
      expect(pathNodes.has(key(e.geometry.coordinates)), e.properties.id).toBe(true);
      expect(buildingIds.has(e.properties.buildingId), e.properties.id).toBe(true);
    }
  });

  it('has steps with a step-free alternative', () => {
    expect(paths.features.some((f) => f.properties.kind === 'steps' && !f.properties.stepFree)).toBe(true);
    expect(paths.features.some((f) => f.properties.kind === 'ramp' && f.properties.stepFree)).toBe(true);
  });

  describe('Cottrell indoor pilot', () => {
    it('has two floors', () => {
      expect(cottrell.floors.map((f) => f.level)).toEqual([0, 1]);
    });

    it('has edges that only reference known nodes', () => {
      const ids = new Set(cottrell.nodes.map((n) => n.id));
      expect(ids.size).toBe(cottrell.nodes.length);
      for (const e of cottrell.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from}-${e.to}`).toBe(true);
    });

    it('is fully connected, and connected without stairs', () => {
      const ids = cottrell.nodes.map((n) => n.id);
      const all = cottrell.edges.map((e) => [e.from, e.to] as [string, string]);
      const stepFree = cottrell.edges.filter((e) => e.stepFree).map((e) => [e.from, e.to] as [string, string]);
      expect(isConnected(ids, all)).toBe(true);
      expect(isConnected(ids, stepFree)).toBe(true);
    });

    it('has stairs and a lift between the floors', () => {
      expect(cottrell.edges.find((e) => e.kind === 'stairs')).toMatchObject({ stepFree: false });
      expect(cottrell.edges.find((e) => e.kind === 'lift')).toMatchObject({ stepFree: true });
    });

    it('gives every room a door node on its own floor', () => {
      const nodes = new Map(cottrell.nodes.map((n) => [n.id, n]));
      const rooms = cottrell.features.features.filter((f) => f.properties.featureType === 'room');
      expect(rooms.length).toBeGreaterThanOrEqual(4);
      for (const r of rooms) expect(nodes.get(r.properties.doorNodeId!)?.level, r.properties.id).toBe(r.properties.level);
    });

    it('links its entrances to the outdoor entrances at the same position', () => {
      const outdoor = new Map(entrances.features.map((f) => [f.properties.id, key(f.geometry.coordinates)]));
      const indoorEntrances = cottrell.nodes.filter((n) => n.kind === 'entrance');
      expect(indoorEntrances).toHaveLength(3);
      for (const n of indoorEntrances) expect(outdoor.get(n.id.replace('entrance:', ''))).toBe(key([n.lng, n.lat]));
    });
  });
});
