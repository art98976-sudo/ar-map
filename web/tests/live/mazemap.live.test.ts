/**
 * Optional check against MazeMap's live services for the University of Stirling (campus 2058).
 * Not part of `npm test`; run with `npm run test:live`. Makes a handful of requests only.
 */
import { describe, expect, it } from 'vitest';
import { MazeMapProvider } from '@/lib/providers';
import { validateRoute } from '@/lib/route/validateRoute';

const CAMPUS = process.env.MAZEMAP_CAMPUS_ID ?? '2058';

describe('MazeMap live', () => {
  it('searches, lists buildings and floors', async () => {
    const p = new MazeMapProvider({ campusId: CAMPUS });
    const results = await p.searchDestinations('library');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((d) => d.name && !/<em>/.test(d.name))).toBe(true);
    const buildings = await p.getBuildings();
    expect(buildings.length).toBeGreaterThan(3);
    const floors = await p.getFloors(buildings[0].id);
    expect(floors.length).toBeGreaterThan(0);
  });

  it('returns schema-valid routes, with a floor change by lift when step-free', async () => {
    const p = new MazeMapProvider({ campusId: CAMPUS });
    const [library] = await p.searchDestinations('library');
    const [cafe] = await p.searchDestinations('', { categories: ['food'] });
    const route = await p.getRoute(
      { type: 'destination', destinationId: library.id },
      { type: 'destination', destinationId: cafe.id },
      { accessible: true },
    );
    expect(validateRoute(route)).toEqual({ valid: true, errors: [] });
    expect(route.steps.filter((s) => s.floorChange).every((s) => s.floorChange!.via === 'lift')).toBe(true);
  });
}, 60_000);
