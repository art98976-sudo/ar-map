import { describe, expect, it } from 'vitest';
import { makeCamera, project, toViewer } from '@/lib/ar/camera';
import { cameraHeading, readOrientation } from '@/lib/ar/orientation';
import { RouteTrack, angleDiff, makeLocalFrame } from '@/lib/ar/track';
import { LocalProvider } from '@/lib/providers';
import { fsDataSource } from './helpers';

const route = () =>
  new LocalProvider(fsDataSource).getRoute(
    { type: 'destination', destinationId: 'building:library' },
    { type: 'destination', destinationId: 'room:cottrell-1-101' },
    { accessible: true },
  );

describe('route track', () => {
  it('measures the route like the route itself', async () => {
    const r = await route();
    const t = new RouteTrack(r);
    expect(t.total).toBeGreaterThan(r.distanceMetres - 2);
    expect(t.total).toBeLessThan(r.distanceMetres + 2);
  });

  it('finds points, headings and steps along the route', async () => {
    const r = await route();
    const t = new RouteTrack(r);
    expect(t.pointAt(0)).toEqual(t.points[0]);
    // The first stretch leaves the Library heading south.
    expect(Math.abs(angleDiff(t.headingAt(5), 180))).toBeLessThan(20);
    expect(t.stepIndexAt(0)).toBe(0);
    expect(t.stepIndexAt(t.total)).toBe(r.steps.length - 1);
  });

  it('projects a nearby position onto the route', async () => {
    const t = new RouteTrack(await route());
    const p = t.pointAt(30);
    const q = { x: p.x + 4, y: p.y };
    const proj = t.project(q, 25);
    expect(proj.along).toBeGreaterThan(25);
    expect(proj.along).toBeLessThan(35);
    expect(proj.off).toBeLessThan(5);
  });

  it('knows where the floor change is', async () => {
    const r = await route();
    const t = new RouteTrack(r);
    const fc = t.nextFloorChange(0)!;
    expect(r.steps[fc.index].type).toBe('change-floor');
    expect(fc.start).toBeGreaterThan(0);
  });

  it('round-trips local coordinates', () => {
    const f = makeLocalFrame({ lat: 56.145, lng: -3.92 });
    const ll = f.toLatLng(f.toXY({ lat: 56.146, lng: -3.921 }));
    expect(ll.lat).toBeCloseTo(56.146, 9);
    expect(ll.lng).toBeCloseTo(-3.921, 9);
  });
});

describe('camera projection', () => {
  const cam = makeCamera({ width: 400, height: 800, pitchDeg: 30 });

  it('puts a point straight ahead on the centre line, below the horizon', () => {
    const p = project(cam, 0, 5)!;
    const horizonY = cam.cy - cam.f * Math.tan((30 * Math.PI) / 180);
    expect(p[0]).toBeCloseTo(200, 6);
    expect(p[1]).toBeGreaterThan(horizonY);
    // A point at the feet (45° down) is below the screen centre when tilted 30° down.
    expect(project(cam, 0, 1.5)![1]).toBeGreaterThan(cam.cy);
  });

  it('puts points to the right on the right, and hides points behind', () => {
    expect(project(cam, 2, 5)![0]).toBeGreaterThan(200);
    expect(project(cam, 0, -3)).toBeNull();
  });

  it('places further points higher on screen', () => {
    expect(project(cam, 0, 20)![1]).toBeLessThan(project(cam, 0, 5)![1]);
  });

  it('turns world offsets into viewer offsets for the heading', () => {
    const [r1, a1] = toViewer(0, 10, 0); // 10 m north, facing north
    expect(r1).toBeCloseTo(0);
    expect(a1).toBeCloseTo(10);
    const [r2, a2] = toViewer(0, 10, 90); // 10 m north, facing east: it is on the left
    expect(r2).toBeCloseTo(-10);
    expect(a2).toBeCloseTo(0);
  });

  it('uses the video size for the focal length', () => {
    const withVideo = makeCamera({ width: 400, height: 800, pitchDeg: 0, video: { width: 1920, height: 1080 } });
    expect(withVideo.f).toBeGreaterThan(cam.f);
  });
});

describe('orientation', () => {
  it('reads iPhone compass heading and upright tilt', () => {
    const r = readOrientation({ alpha: 0, beta: 90, gamma: 0, webkitCompassHeading: 270, webkitCompassAccuracy: 10 })!;
    expect(r.heading).toBe(270);
    expect(r.pitch).toBeCloseTo(0, 6);
    expect(r.accuracy).toBe(10);
  });

  it('reports downward tilt when the phone leans back', () => {
    expect(readOrientation({ alpha: 0, beta: 45, gamma: 0, webkitCompassHeading: 0 })!.pitch).toBeCloseTo(45, 6);
  });

  it('reads Android absolute orientation', () => {
    const r = readOrientation({ alpha: 90, beta: 90, gamma: 0, absolute: true })!;
    expect(r.heading).toBeCloseTo(cameraHeading(90, 90, 0), 6);
  });

  it('gives no heading without a compass', () => {
    expect(readOrientation({ alpha: 10, beta: 80, gamma: 0 })!.heading).toBeNull();
  });
});
