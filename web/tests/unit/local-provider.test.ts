import { describe, expect, it } from 'vitest';
import {
  createMapProvider,
  LocalProvider,
  MazeMapProvider,
  NotImplementedError,
  ProviderNotConfiguredError,
} from '@/lib/providers';
import { normaliseText } from '@/lib/providers/local/search';
import { fsDataSource } from './helpers';

const provider = new LocalProvider(fsDataSource);

describe('LocalProvider', () => {
  it('lists all nine sample buildings with centroids and entrances', async () => {
    const buildings = await provider.getBuildings();
    expect(buildings).toHaveLength(9);
    const cottrell = buildings.find((b) => b.id === 'cottrell')!;
    expect(cottrell.hasIndoorData).toBe(true);
    expect(cottrell.entrances.map((e) => e.id).sort()).toEqual(['cottrell-east', 'cottrell-main', 'cottrell-north']);
    expect(cottrell.centroid.lat).toBeCloseTo(56.14465, 3);
  });

  it('finds a building by name, with the building first', async () => {
    const [first] = await provider.searchDestinations('library');
    expect(first.id).toBe('building:library');
  });

  it('ignores case, apostrophes and accents', async () => {
    expect(normaliseText("Students' Union Café")).toBe('students union cafe');
    const results = await provider.searchDestinations('STUDENTS UNION');
    expect(results[0].name).toBe("Students' Union");
  });

  it('finds by alias and short name', async () => {
    expect((await provider.searchDestinations('coffee')).map((d) => d.kind)).toContain('cafe');
    expect((await provider.searchDestinations('pathfoot'))[0].id).toBe('building:pathfoot');
  });

  it('finds indoor rooms with building and floor', async () => {
    const [room] = await provider.searchDestinations('seminar room 1.01');
    expect(room).toMatchObject({
      id: 'room:cottrell-1-101',
      buildingName: 'Cottrell Building',
      floorId: 'cottrell-1',
      floorName: 'Floor 2',
      level: 1,
    });
  });

  it('filters by category', async () => {
    const transport = await provider.searchDestinations('', { categories: ['transport'] });
    expect(transport.length).toBeGreaterThan(0);
    expect(transport.every((d) => d.kind === 'bus-stop' || d.kind === 'car-park')).toBe(true);
    const food = await provider.searchDestinations('cottrell', { categories: ['food'] });
    expect(food.map((d) => d.id)).toEqual(['room:cottrell-0-cafe']);
  });

  it('returns nothing for a query that matches nothing', async () => {
    expect(await provider.searchDestinations('zzzz')).toEqual([]);
  });

  it('respects the result limit', async () => {
    expect(await provider.searchDestinations('', { limit: 3 })).toHaveLength(3);
  });

  it('gets a destination by id, or null', async () => {
    expect((await provider.getDestination('place:bus-cottrell'))?.name).toBe('Cottrell bus stop');
    expect(await provider.getDestination('place:nope')).toBeNull();
  });

  it('returns floors lowest first, and none for buildings without indoor data', async () => {
    expect((await provider.getFloors('cottrell')).map((f) => f.name)).toEqual(['Floor 1', 'Floor 2']);
    expect(await provider.getFloors('library')).toEqual([]);
  });

  it('does not route yet (Step 2)', async () => {
    await expect(
      provider.getRoute(
        { type: 'destination', destinationId: 'building:library' },
        { type: 'destination', destinationId: 'room:cottrell-1-101' },
        { accessible: false },
      ),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('provides overlay layers for the plain map', async () => {
    const overlay = await provider.getMapOverlay();
    expect(Object.keys(overlay).sort()).toEqual(['areas', 'buildings', 'entrances', 'paths', 'places']);
  });
});

describe('createMapProvider', () => {
  it('defaults to local sample data', () => {
    const { provider: p, warning } = createMapProvider({ dataSource: fsDataSource });
    expect(p.id).toBe('local');
    expect(p.isSampleData).toBe(true);
    expect(warning).toBeUndefined();
  });

  it('falls back to local when MazeMap has no campus id', () => {
    const choice = createMapProvider({ provider: 'mazemap', mazemap: { campusId: 'TODO' }, dataSource: fsDataSource });
    expect(choice.provider.id).toBe('local');
    expect(choice.warning).toMatch(/MAZEMAP_CAMPUS_ID/);
  });

  it('falls back to local for an unknown provider name', () => {
    expect(createMapProvider({ provider: 'google', dataSource: fsDataSource }).warning).toMatch(/Unknown/);
  });

  it('selects MazeMap when configured', () => {
    expect(createMapProvider({ provider: 'MazeMap', mazemap: { campusId: '123' } }).provider.id).toBe('mazemap');
  });

  it('MazeMap reports missing configuration clearly', async () => {
    await expect(new MazeMapProvider({}).getBuildings()).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
