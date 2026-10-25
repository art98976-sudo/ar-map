import { describe, expect, it } from 'vitest';
import { checkArrival, floorGate, groundArrows, makeHud } from '@/components/ar/engine/frame';
import { createArState, type Hud } from '@/components/ar/engine/state';
import { nextInstruction } from '@/components/ar/ui/ArTopBar';
import { APP_CONFIG } from '@/config/appConfig';
import { arrowPlacements } from '@/lib/ar/placement';
import { RouteTrack } from '@/lib/ar/track';
import { arrowLook, distanceFade, waveGlow } from '@/lib/ar/wave';
import { LocalProvider } from '@/lib/providers';
import { markOnboardingSeen, onboardingSeen } from '@/lib/state/onboarding';
import { fsDataSource } from './helpers';

const track = async () =>
  new RouteTrack(
    await new LocalProvider(fsDataSource).getRoute(
      { type: 'destination', destinationId: 'building:library' },
      { type: 'destination', destinationId: 'room:cottrell-1-101' },
      { accessible: true },
    ),
  );

const stateFor = (t: RouteTrack) => createArState({ simulating: true, geo: { status: 'idle', request: () => {} }, track: t });

describe('animated ground arrows', () => {
  const { spacingM, firstArrowM, showAheadM, waveCycleMs, scaleMin, scaleMax, dimLevel, farOpacity } = APP_CONFIG.arrows;

  it('keeps each arrow on the same spot as you walk, instead of sliding along with you', async () => {
    const t = await track();
    const at = (along: number) => arrowPlacements(t, along, along + showAheadM, { spacing: spacingM, startGap: firstArrowM }).filter((a) => a.kind === 'chevron');
    const before = at(10);
    const after = at(10.6);
    const shared = after.filter((a) => before.some((b) => Math.abs(b.along - a.along) < 1e-9));
    expect(shared.length).toBeGreaterThan(4);
    for (const a of shared) {
      const b = before.find((x) => Math.abs(x.along - a.along) < 1e-9)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    }
  });

  it('spaces arrows evenly, only over the next stretch of route', async () => {
    const t = await track();
    const list = arrowPlacements(t, 5, 5 + showAheadM, { spacing: spacingM, startGap: firstArrowM }).filter((a) => a.kind === 'chevron');
    const gaps = list.slice(1).map((a, i) => a.along - list[i].along);
    for (const g of gaps) expect(g).toBeCloseTo(spacingM, 6);
    expect(list.every((a) => a.along > 5 + firstArrowM && a.along < 5 + showAheadM)).toBe(true);
  });

  it('is brightest near you and fades out further ahead', () => {
    expect(distanceFade(2, showAheadM)).toBeGreaterThan(distanceFade(8, showAheadM));
    expect(distanceFade(8, showAheadM)).toBeGreaterThan(distanceFade(12, showAheadM));
    expect(distanceFade(showAheadM, showAheadM)).toBeCloseTo(farOpacity, 6);
    // Right at your feet the arrow fades in instead of blinking out.
    expect(distanceFade(firstArrowM, showAheadM)).toBe(0);
  });

  it('runs a wave of light forward along the arrows, once per cycle', () => {
    const peakAt = (now: number) => {
      let best = 0;
      for (let d = 0; d <= showAheadM; d += 0.1) if (waveGlow(d, now, showAheadM) > waveGlow(best, now, showAheadM)) best = d;
      return best;
    };
    expect(peakAt(waveCycleMs * 0.3)).toBeLessThan(peakAt(waveCycleMs * 0.6));
    expect(peakAt(waveCycleMs * 0.6)).toBeLessThan(peakAt(waveCycleMs * 0.9));
    expect(waveGlow(4, 200, showAheadM)).toBeCloseTo(waveGlow(4, 200 + waveCycleMs, showAheadM), 9);
  });

  it('pulses size and brightness gently, and stays steady with reduced motion', () => {
    for (let now = 0; now < waveCycleMs; now += 37) {
      const look = arrowLook(5, now, showAheadM);
      expect(look.scale).toBeGreaterThanOrEqual(scaleMin - 1e-9);
      expect(look.scale).toBeLessThanOrEqual(scaleMax + 1e-9);
      expect(look.alpha).toBeGreaterThanOrEqual(dimLevel - 1e-9);
      expect(look.alpha).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(arrowLook(5, 123, showAheadM, false)).toEqual({ glow: 0, alpha: 1, scale: 1 });
  });

  it('gives each arrow a key that stays the same from frame to frame', async () => {
    const t = await track();
    const st = stateFor(t);
    st.along = 20;
    const a = groundArrows(st, 0, st.along + showAheadM);
    st.along = 20.4;
    const b = groundArrows(st, 16, st.along + showAheadM);
    const keysA = new Set(a.map((x) => x.key));
    expect(b.filter((x) => keysA.has(x.key)).length).toBeGreaterThan(4);
    expect(new Set(b.map((x) => x.key)).size).toBe(b.length);
  });
});

describe('arrival moment', () => {
  const { radiusM, arrowFadeMs } = APP_CONFIG.arrival;
  const fx = { toast: () => {}, anchorOrigin: () => {} };

  /** A state standing `left` metres before the end of the route, past every floor change. */
  const near = async (left: number) => {
    const t = await track();
    const st = stateFor(t);
    st.confirmedFloor = t.steps.length; // all floor changes taken
    st.along = t.total - left;
    st.viewer = t.pointAt(st.along);
    st.alongReady = true;
    return st;
  };

  it('triggers within the arrival radius, not before', async () => {
    const far = await near(radiusM + 3);
    expect(checkArrival(far, 1000)).toBe(false);
    const st = await near(radiusM - 1);
    expect(checkArrival(st, 1000)).toBe(true);
    expect(makeHud(st, 1000, null, [], fx).arrived).toBe(true);
  });

  it('triggers only once per route, even if GPS wobbles back out of range', async () => {
    const st = await near(radiusM - 1);
    expect(checkArrival(st, 1000)).toBe(true);
    st.along = st.track.total - (radiusM + 4);
    st.viewer = st.track.pointAt(st.along);
    expect(checkArrival(st, 1200)).toBe(false);
    expect(makeHud(st, 1200, null, [], fx).arrived).toBe(true);
    st.along = st.track.total - 1;
    expect(checkArrival(st, 1400)).toBe(false);
    expect(st.arrivedAt).toBe(1000);
  });

  it('waits for a floor change that has not been taken yet', async () => {
    const st = await near(2);
    st.confirmedFloor = -1; // this route takes a lift to floor 1
    expect(floorGate(st).gate).toBeDefined();
    expect(checkArrival(st, 1000)).toBe(false);
  });

  it('fades the ground arrows out after arriving', async () => {
    const st = await near(radiusM + 6);
    expect(groundArrows(st, 0, st.track.total).length).toBeGreaterThan(0);
    st.arrivedAt = 1000;
    const half = groundArrows(st, 1000 + arrowFadeMs / 2, st.track.total);
    const full = groundArrows(st, 1000, st.track.total);
    expect(Math.max(...half.map((a) => a.alpha))).toBeLessThan(Math.max(...full.map((a) => a.alpha)));
    expect(groundArrows(st, 1000 + arrowFadeMs + 1, st.track.total)).toEqual([]);
  });
});

describe('AR top bar: the next instruction only', () => {
  const hud = (over: Partial<Hud>): Hud => ({
    stepIndex: 0,
    toNextStep: 20,
    remaining: 100,
    arrowDeg: 0,
    arrived: false,
    floorPrompt: null,
    heading: 0,
    headingSource: 'compass',
    status: null,
    askMotion: false,
    debug: [],
    ...over,
  });

  it('shows the next step with its distance, e.g. "Turn left in 20 m"', async () => {
    const t = await track();
    const r = t.route;
    const i = r.steps.findIndex((s, k) => k > 0 && s.type === 'turn');
    const { step, text } = nextInstruction(r, hud({ stepIndex: i - 1, toNextStep: 20 }));
    expect(step).toBe(r.steps[i]);
    expect(text).toBe(`${r.steps[i].instruction} in 20 m`);
    // Right at the turn, just the instruction.
    expect(nextInstruction(r, hud({ stepIndex: i - 1, toNextStep: 1 })).text).toBe(r.steps[i].instruction);
  });

  it('counts down to the destination, then says you have arrived', async () => {
    const r = (await track()).route;
    const last = r.steps.length - 1;
    expect(nextInstruction(r, hud({ stepIndex: last - 1, toNextStep: 12 })).text).toBe('Arrive in 12 m');
    expect(nextInstruction(r, hud({ stepIndex: last, arrived: true })).text).toBe(`You've arrived at ${r.to.name}`);
  });

  it('shows the floor change while it waits to be confirmed', async () => {
    const r = (await track()).route;
    const lift = r.steps.findIndex((s) => s.type === 'change-floor');
    expect(nextInstruction(r, hud({ stepIndex: lift, floorPrompt: lift })).text).toBe(r.steps[lift].instruction);
  });
});

describe('onboarding: remembered safely', () => {
  const key = APP_CONFIG.onboarding.storageKey;

  it('is shown until seen, then remembered', () => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    expect(onboardingSeen()).toBe(false);
    markOnboardingSeen();
    expect(store.get(key)).toBe('1');
    expect(onboardingSeen()).toBe(true);
  });

  it('does not crash when storage is unavailable', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(onboardingSeen()).toBe(false);
    expect(() => markOnboardingSeen()).not.toThrow();
  });
});
