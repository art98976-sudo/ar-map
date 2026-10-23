import { describe, expect, it } from 'vitest';
import { Alignment, circularMean, circularSpread, xrYaw } from '@/lib/ar/alignment';
import { makeCamera, project } from '@/lib/ar/camera';
import { GroundEstimator, depressionAt, eyeHeightFromTap, maxArrowDistance, MIN_DEPRESSION_DEG } from '@/lib/ar/ground';
import { arrowPlacements, travelHeading } from '@/lib/ar/placement';
import { RouteTrack, angleDiff, makeLocalFrame } from '@/lib/ar/track';
import { LocalProvider } from '@/lib/providers';
import { fsDataSource } from './helpers';

const route = (accessible = true) =>
  new LocalProvider(fsDataSource).getRoute(
    { type: 'destination', destinationId: 'building:library' },
    { type: 'destination', destinationId: 'room:cottrell-1-101' },
    { accessible },
  );

describe('map ↔ AR conversion', () => {
  it('maps north/east onto AR axes for a given compass offset', () => {
    // AR -z points north: north is ahead (-z), east is to the right (+x).
    const north = new Alignment(0, { x: 0, y: 0 }, { x: 0, z: 0 });
    expect(north.enToXr({ x: 0, y: 10 })).toEqual({ x: 0, z: -10 });
    expect(north.enToXr({ x: 10, y: 0 }).x).toBeCloseTo(10);
    // AR -z points east: east is ahead, north is to the left.
    const east = new Alignment(90, { x: 0, y: 0 }, { x: 0, z: 0 });
    const n = east.enToXr({ x: 0, y: 10 });
    expect(n.x).toBeCloseTo(-10);
    expect(n.z).toBeCloseTo(0);
    const e = east.enToXr({ x: 10, y: 0 });
    expect(e.z).toBeCloseTo(-10);
  });

  it('round-trips map → AR → map with any offset and origin', () => {
    for (const offset of [0, 37, 180, 271.5]) {
      const a = new Alignment(offset, { x: 12, y: -40 }, { x: 0.4, z: -2.1 });
      const p = { x: -33.3, y: 57.9 };
      const back = a.xrToEn(a.enToXr(p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('keeps distances (no scale change between map and AR)', () => {
    const a = new Alignment(123, { x: 0, y: 0 }, { x: 0, z: 0 });
    const q = a.enToXr({ x: 3, y: 4 });
    expect(Math.hypot(q.x, q.z)).toBeCloseTo(5, 9);
  });

  it('converts compass headings and AR yaw both ways', () => {
    const a = new Alignment(250, { x: 0, y: 0 }, { x: 0, z: 0 });
    expect(a.xrYawToHeading(a.headingToXrYaw(10))).toBeCloseTo(10);
    expect(xrYaw(0, -1)).toBeCloseTo(0); // straight ahead
    expect(xrYaw(1, 0)).toBeCloseTo(90); // to the right
    expect(xrYaw(0, 1)).toBeCloseTo(180); // behind
  });

  it('a route heading becomes the matching AR direction', () => {
    const a = new Alignment(30, { x: 0, y: 0 }, { x: 0, z: 0 });
    // A point due east on the map should lie at the AR yaw for heading 90.
    const q = a.enToXr({ x: 10, y: 0 });
    expect(xrYaw(q.x, q.z)).toBeCloseTo(a.headingToXrYaw(90));
  });

  it('averages compass readings across north', () => {
    expect(circularMean([358, 2, 0])).toBeCloseTo(0, 6);
    expect(circularSpread([10, 10.5, 9.5])).toBeLessThan(1);
    expect(circularSpread([0, 90, 180, 270])).toBeGreaterThan(60);
  });

  it('local metres round-trip through lat/lng', () => {
    const f = makeLocalFrame({ lat: 56.1456, lng: -3.9215 });
    const q = f.toXY({ lat: 56.1466, lng: -3.9195 });
    // ~111 m north, ~124 m east at Stirling's latitude
    expect(q.y).toBeCloseTo(110.5, 0);
    expect(q.x).toBeCloseTo(124.1, 0);
  });
});

describe('arrow placement along the route', () => {
  it('spaces arrows evenly along the exact route and points them along it', async () => {
    const t = new RouteTrack(await route());
    const list = arrowPlacements(t, 0, 20, { spacing: 2.5 });
    const chevrons = list.filter((a) => a.kind === 'chevron');
    expect(chevrons.length).toBeGreaterThan(5);
    for (const a of chevrons) {
      // Each arrow sits on the route polyline...
      const proj = t.project(a, a.along);
      expect(proj.off).toBeLessThan(0.01);
      // ...and points along the direction of travel.
      expect(Math.abs(angleDiff(a.heading, travelHeading(t, a.along)))).toBeLessThan(0.001);
    }
    const gaps = chevrons.slice(1).map((a, i) => a.along - chevrons[i].along);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  });

  it('adds a turn arrow pointing the new way just after a sharp turn', async () => {
    const r = await route(true);
    const t = new RouteTrack(r);
    const turnStep = t.steps.find((s) => r.steps[s.index].type === 'turn' && ['left', 'right'].includes(r.steps[s.index].turn ?? ''))!;
    const list = arrowPlacements(t, turnStep.start - 5, turnStep.start + 10);
    const turn = list.find((a) => a.kind === 'turn')!;
    expect(turn).toBeDefined();
    expect(turn.along).toBeCloseTo(turnStep.start + 1, 6);
    expect(Math.abs(angleDiff(turn.heading, t.headingAt(turnStep.start + 2.5)))).toBeLessThan(0.001);
    // No chevron crowds the turn arrow.
    expect(list.filter((a) => a.kind === 'chevron').every((a) => Math.abs(a.along - turn.along) >= 1.6)).toBe(true);
  });

  it('fades arrows with distance and stops at the end of the route', async () => {
    const t = new RouteTrack(await route());
    const list = arrowPlacements(t, t.total - 6, t.total + 50);
    expect(list.every((a) => a.along <= t.total)).toBe(true);
    const near = arrowPlacements(t, 0, 20).filter((a) => a.kind === 'chevron');
    expect(near[0].opacity).toBeGreaterThan(near.at(-1)!.opacity);
  });
});

describe('ground (camera-overlay mode)', () => {
  it('limits arrows to where they cannot drift near the horizon', () => {
    // 1.4 m phone height: arrows stop where the ground is 6° below the horizon (~13 m).
    expect(maxArrowDistance(1.4)).toBeCloseTo(1.4 / Math.tan((MIN_DEPRESSION_DEG * Math.PI) / 180), 6);
    expect(maxArrowDistance(5)).toBe(15);
  });

  it('calibrates phone height from a tap on the ground 2 m ahead', () => {
    // A tap 35° below the horizon at 2 m means the phone is 2·tan(35°) ≈ 1.40 m up.
    expect(eyeHeightFromTap(35, 2)).toBeCloseTo(1.4, 2);
    expect(eyeHeightFromTap(1)).toBeNull(); // at the horizon: not the ground
  });

  it('reads the angle below the horizon of a screen point, consistent with the projection', () => {
    const cam = makeCamera({ width: 400, height: 800, pitchDeg: 30, eyeHeight: 1.4 });
    const p = project(cam, 0, 2)!; // ground point 2 m ahead
    const dep = depressionAt(cam, p[0], p[1]);
    expect(dep).toBeCloseTo((Math.atan(1.4 / 2) * 180) / Math.PI, 6);
    expect(eyeHeightFromTap(dep, 2)).toBeCloseTo(1.4, 6);
  });

  it('accounts for the phone leaning sideways', () => {
    const cam = makeCamera({ width: 400, height: 800, pitchDeg: 30, eyeHeight: 1.4, rollRad: 0.3 });
    const p = project(cam, 0, 2)!;
    // Screen point after the canvas rotation by the roll angle.
    const dx = p[0] - cam.cx;
    const dy = p[1] - cam.cy;
    const x = cam.cx + dx * Math.cos(0.3) - dy * Math.sin(0.3);
    const y = cam.cy + dx * Math.sin(0.3) + dy * Math.cos(0.3);
    expect(depressionAt(cam, x, y)).toBeCloseTo((Math.atan(1.4 / 2) * 180) / Math.PI, 6);
  });
});

describe('ground (tracking mode)', () => {
  it('uses only flat surfaces and the median of recent hits', () => {
    const g = new GroundEstimator(5);
    expect(g.height).toBeNull();
    g.add(-1.42, 0.99);
    g.add(-1.4, 0.98);
    expect(g.add(-0.6, 0.2)).toBe(false); // a wall: ignored
    g.add(-0.7, 0.99); // a bench top: outvoted
    g.add(-1.41, 1);
    expect(g.height!).toBeGreaterThan(-1.43);
    expect(g.height!).toBeLessThan(-1.39); // ground, not the bench
    g.reset();
    expect(g.height).toBeNull();
  });
});
