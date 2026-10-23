import { describe, expect, it } from 'vitest';
import { LocalProvider, NoRouteError, NotFoundError, OutOfAreaError } from '@/lib/providers';
import { validateRoute } from '@/lib/route/validateRoute';
import { aStar } from '@/lib/routing/astar';
import { classifyTurn, turnAngle } from '@/lib/routing/geometry';
import { WalkGraph } from '@/lib/routing/graph';
import type { Route, RouteEndpoint } from '@/lib/types';
import { fsDataSource } from './helpers';

const provider = new LocalProvider(fsDataSource, { now: () => new Date('2026-10-23T12:00:00Z') });
const dest = (destinationId: string): RouteEndpoint => ({ type: 'destination', destinationId });
const route = (from: string, to: string, accessible = false) => provider.getRoute(dest(from), dest(to), { accessible });

const usesStepsOrStairs = (r: Route) =>
  r.steps.some((s) => s.floorChange?.via === 'stairs' || /\bsteps\b/i.test(s.instruction));

describe('checkpoint: Library to a room in Cottrell', () => {
  it('produces a valid route that enters Cottrell and goes up a floor', async () => {
    const r = await route('building:library', 'room:cottrell-1-101');
    expect(validateRoute(r)).toEqual({ valid: true, errors: [] });
    const types = r.steps.map((s) => s.type);
    expect(types[0]).toBe('walk');
    expect(types).toContain('enter-building');
    expect(types).toContain('change-floor');
    expect(types.at(-1)).toBe('arrive');
    expect(r.to).toMatchObject({ destinationId: 'room:cottrell-1-101', point: { buildingId: 'cottrell', level: 1 } });
    expect(r.steps.at(-1)!.instruction).toMatch(/Seminar room 1\.01.*Floor 2/);
  });

  it('takes the Library steps when step-free is off', async () => {
    const r = await route('building:library', 'room:cottrell-1-101');
    expect(r.steps.map((s) => s.instruction)).toContain('Take the Library steps');
  });

  it('avoids all steps and stairs when step-free is on', async () => {
    const r = await route('building:library', 'room:cottrell-1-101', true);
    expect(validateRoute(r).valid).toBe(true);
    expect(r.accessible).toBe(true);
    expect(usesStepsOrStairs(r)).toBe(false);
    expect(r.steps.find((s) => s.type === 'change-floor')?.floorChange?.via).toBe('lift');
    expect(r.steps.map((s) => s.instruction).join(' ')).toMatch(/ramp/);
  });

  it('step-free is longer here, because the steps are a shortcut', async () => {
    const normal = await route('building:library', 'room:cottrell-1-101');
    const stepFree = await route('building:library', 'room:cottrell-1-101', true);
    expect(stepFree.distanceMetres).toBeGreaterThan(normal.distanceMetres);
  });
});

describe('floor changes', () => {
  it('uses the nearer stairs when allowed, and the lift when step-free', async () => {
    const normal = await route('building:library', 'room:cottrell-1-102');
    const stepFree = await route('building:library', 'room:cottrell-1-102', true);
    expect(normal.steps.find((s) => s.type === 'change-floor')).toMatchObject({
      instruction: 'Take the stairs up to Floor 2',
      floorChange: { via: 'stairs', fromLevel: 0, toLevel: 1, toFloorId: 'cottrell-1' },
    });
    expect(stepFree.steps.find((s) => s.type === 'change-floor')?.instruction).toBe('Take the lift to Floor 2');
  });

  it('does not change floor for a ground-floor room', async () => {
    const r = await route('building:library', 'room:cottrell-0-cafe');
    expect(r.steps.some((s) => s.type === 'change-floor')).toBe(false);
  });

  it('routes from an indoor position down and out of the building', async () => {
    const r = await provider.getRoute(
      { type: 'position', point: { lat: 56.14465, lng: -3.9202, buildingId: 'cottrell', floorId: 'cottrell-1', level: 1 } },
      dest('place:bus-cottrell'),
      { accessible: false },
    );
    expect(validateRoute(r).valid).toBe(true);
    expect(r.from.name).toBe('My location');
    const types = r.steps.map((s) => s.type);
    expect(types).toContain('change-floor');
    expect(types).toContain('exit-building');
    expect(r.steps.find((s) => s.type === 'change-floor')!.floorChange!.toLevel).toBe(0);
  });

  it('marks indoor points with building and level, outdoor points without', async () => {
    const r = await route('building:library', 'room:cottrell-1-101');
    const points = r.steps.flatMap((s) => s.path);
    expect(points.some((p) => p.buildingId === 'cottrell' && p.level === 1)).toBe(true);
    expect(points[0].buildingId).toBeUndefined();
  });
});

describe('endpoints', () => {
  it('routes from a raw position ("My location") to a bus stop', async () => {
    const r = await provider.getRoute(
      { type: 'position', point: { lat: 56.1462, lng: -3.9225 } },
      dest('place:bus-pathfoot'),
      { accessible: false },
    );
    expect(validateRoute(r).valid).toBe(true);
    expect(r.to.name).toBe('Pathfoot bus stop');
    expect(r.steps.at(-1)!.location.lat).toBeCloseTo(56.14885, 5);
  });

  it('routes to a place inside a building via its entrance', async () => {
    const r = await route('place:sports-pitches', 'place:library-cafe');
    expect(r.steps.at(-1)!.instruction).toBe('You have arrived at Library (Library café is inside)');
  });

  it('warns when a building has no step-free entrance', async () => {
    const r = await route('building:library', 'building:airthrey-castle', true);
    expect(validateRoute(r).valid).toBe(true);
    expect(r.warnings?.[0]).toMatch(/no step-free entrance/);
  });

  it('returns a single "arrive" step when start and end are the same', async () => {
    const r = await route('building:library', 'building:library');
    expect(r.steps.map((s) => s.type)).toEqual(['arrive']);
    expect(r.distanceMetres).toBe(0);
    expect(validateRoute(r).valid).toBe(true);
  });

  it('rejects an unknown destination', async () => {
    await expect(route('building:library', 'room:nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a position far off campus', async () => {
    await expect(
      provider.getRoute({ type: 'position', point: { lat: 55.95, lng: -3.19 } }, dest('building:library'), { accessible: false }),
    ).rejects.toBeInstanceOf(OutOfAreaError);
  });

  it('gives the same route id for the same request', async () => {
    const a = await route('building:library', 'room:cottrell-1-101');
    const b = await route('building:library', 'room:cottrell-1-101');
    const c = await route('building:library', 'room:cottrell-1-101', true);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});

describe('every destination pair', () => {
  it('produces a schema-valid route in both modes', async () => {
    const all = await provider.searchDestinations('', { limit: 1000 });
    expect(all.length).toBeGreaterThan(25);
    const failures: string[] = [];
    for (const from of all) {
      for (const to of all) {
        for (const accessible of [false, true]) {
          const r = await provider.getRoute(dest(from.id), dest(to.id), { accessible });
          const v = validateRoute(r);
          if (!v.valid) failures.push(`${from.id} -> ${to.id} (${accessible}): ${v.errors.join('; ')}`);
          if (accessible && r.steps.some((s) => s.floorChange?.via === 'stairs')) failures.push(`${from.id} -> ${to.id} used stairs`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('A* search', () => {
  // A square: a-b-c is short but b-c is stairs; a-d-c is longer and step-free.
  function square() {
    const g = new WalkGraph();
    g.addNode({ id: 'a', lat: 56.145, lng: -3.92, kind: 'outdoor' });
    g.addNode({ id: 'b', lat: 56.1452, lng: -3.92, kind: 'outdoor' });
    g.addNode({ id: 'c', lat: 56.1452, lng: -3.9196, kind: 'outdoor' });
    g.addNode({ id: 'd', lat: 56.1449, lng: -3.9194, kind: 'outdoor' });
    g.addNode({ id: 'island', lat: 56.146, lng: -3.92, kind: 'outdoor' });
    g.addEdge('a', 'b', { kind: 'footpath', stepFree: true });
    g.addEdge('b', 'c', { kind: 'steps', stepFree: false });
    g.addEdge('a', 'd', { kind: 'footpath', stepFree: true });
    g.addEdge('d', 'c', { kind: 'footpath', stepFree: true });
    return g;
  }

  it('finds the shortest path', () => {
    expect(aStar(square(), 'a', 'c', { accessible: false })?.nodeIds).toEqual(['a', 'b', 'c']);
  });

  it('skips steps when accessible', () => {
    expect(aStar(square(), 'a', 'c', { accessible: true })?.nodeIds).toEqual(['a', 'd', 'c']);
  });

  it('returns null when the goal is unreachable', () => {
    expect(aStar(square(), 'a', 'island', { accessible: false })).toBeNull();
  });

  it('NoRouteError is a real error type', () => {
    expect(new NoRouteError('x')).toBeInstanceOf(Error);
  });
});

describe('turns', () => {
  it.each([
    [0, 90, 'right'],
    [0, 270, 'left'],
    [0, 30, 'slight-right'],
    [355, 10, 'straight'],
    [0, 160, 'sharp-right'],
    [0, 180, 'u-turn'],
  ])('from %i° to %i° is %s', (a, b, expected) => {
    expect(classifyTurn(turnAngle(a, b))).toBe(expected);
  });
});
