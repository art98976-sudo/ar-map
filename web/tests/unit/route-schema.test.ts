import { describe, expect, it } from 'vitest';
import { validateRoute } from '@/lib/route/validateRoute';
import { ROUTE_STEP_TYPES, TURN_DIRECTIONS, type Route } from '@/lib/types';
import { readJson } from './helpers';

const schema = readJson<{ $defs: { step: { properties: { type: { enum: string[] }; turn: { enum: string[] } } } } }>(
  'schemas/route.schema.json',
);
const example = () => readJson<Route>('examples/route.example.json');
const byType = (r: Route, type: string) => r.steps.find((s) => s.type === type)!;

describe('route schema', () => {
  it('accepts the example route (Library to a room in Cottrell)', () => {
    expect(validateRoute(example())).toEqual({ valid: true, errors: [] });
  });

  it('lists the same step types and turn directions as the TypeScript type', () => {
    expect(schema.$defs.step.properties.type.enum).toEqual([...ROUTE_STEP_TYPES]);
    expect(schema.$defs.step.properties.turn.enum).toEqual([...TURN_DIRECTIONS]);
  });

  it('example covers indoor points, entering a building and a floor change', () => {
    const r = example();
    const types = r.steps.map((s) => s.type);
    expect(types).toContain('enter-building');
    expect(types).toContain('change-floor');
    expect(r.to.point).toMatchObject({ buildingId: 'cottrell', level: 1 });
  });

  it.each<[string, (r: Route) => void, RegExp]>([
    ['a turn without a direction', (r) => delete byType(r, 'turn').turn, /turn/],
    ['a floor change without details', (r) => delete byType(r, 'change-floor').floorChange, /floorChange/],
    ['an indoor point without a level', (r) => delete byType(r, 'change-floor').location.level, /level/],
    ['a level without a building', (r) => (r.steps[0].location.level = 0), /buildingId/],
    ['an unknown step type', (r) => ((r.steps[0] as { type: string }).type = 'fly'), /allowed values/],
    ['an empty path', (r) => (r.steps[0].path = []), /fewer than 1/],
    ['negative distance', (r) => (r.steps[0].distanceMetres = -1), />= 0/],
    ['an extra property', (r) => Object.assign(r, { colour: 'red' }), /additional properties/],
    ['a bad timestamp', (r) => (r.generatedAt = 'yesterday'), /date-time/],
  ])('rejects %s', (_label, mutate, message) => {
    const r = example();
    mutate(r);
    const result = validateRoute(r);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(message);
  });

  it('rejects a route that does not end with "arrive"', () => {
    const r = example();
    r.steps.pop();
    r.distanceMetres = r.steps.reduce((s, x) => s + x.distanceMetres, 0);
    expect(validateRoute(r).errors.join()).toMatch(/last step must be "arrive"/);
  });

  it('rejects steps out of order', () => {
    const r = example();
    r.steps[1].index = 5;
    expect(validateRoute(r).errors.join()).toMatch(/index should be 1/);
  });

  it('rejects totals that do not match the steps', () => {
    const r = example();
    r.distanceMetres += 50;
    expect(validateRoute(r).errors.join()).toMatch(/distanceMetres/);
  });

  it('rejects a floor change that stays on the same level', () => {
    const r = example();
    byType(r, 'change-floor').floorChange!.toLevel = 0;
    expect(validateRoute(r).errors.join()).toMatch(/must change level/);
  });
});
