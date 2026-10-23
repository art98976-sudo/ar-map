'use client';

import { ChevronLeft, ChevronRight, Compass, Flag, LocateFixed, MoveUp, Pause, Play, TriangleAlert, Video, VideoOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoStatus } from '@/hooks/useGeolocation';
import { makeCamera, project, toViewer, type Camera } from '@/lib/ar/camera';
import { readOrientation, type OrientationLike } from '@/lib/ar/orientation';
import { RouteTrack, angleDiff, bearingXY, type XY } from '@/lib/ar/track';
import { formatDistance, formatDuration, WALKING_SPEED_MPS } from '@/lib/route/constants';
import type { LatLng, Route } from '@/lib/types';
import { StepIcon } from '../navigate/NavigatePanel';
import { cx } from '../ui/ui';

const OFFSET_KEY = 'stirling-campus-map:ar-heading-offset';
const AHEAD_M = 22;
const CHEVRON_GAP_M = 2.5;
const CHEVRON = [[0, 1.05], [0.75, 0.05], [0.38, 0.05], [0, -0.55], [-0.38, 0.05], [-0.75, 0.05]] as const;

export interface ArViewProps {
  route: Route;
  geo: { status: GeoStatus; position?: LatLng; accuracy?: number; request(): void };
  /** Start in simulated mode (no GPS needed), e.g. for demos. */
  simulate?: boolean;
  onExit(): void;
}

interface Hud {
  stepIndex: number;
  toNextStep: number;
  remaining: number;
  arrowDeg: number;
  offRoute: boolean;
  arrived: boolean;
  floorPrompt: number | null; // index of the change-floor step waiting for confirmation
  heading: number;
  headingSource: 'compass' | 'route' | 'drag';
  accuracy?: number;
}

/**
 * AR navigation: the camera view with the route drawn on the ground, the current step and a
 * direction arrow. Follows GPS (snapped to the route), the compass and phone tilt. Floor changes
 * are confirmed by the walker, because GPS cannot tell floors apart.
 */
export default function ArView({ route, geo, simulate: startSimulated = false, onExit }: ArViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const track = useMemo(() => new RouteTrack(route), [route]);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(startSimulated);
  const [simSpeed, setSimSpeed] = useState(1);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Everything the animation loop needs, kept in refs so it runs without re-rendering.
  const s = useRef({
    heading: 0,
    targetHeading: 0,
    pitch: 20,
    targetPitch: 20,
    roll: 0,
    targetRoll: 0,
    hasCompass: false,
    lastCompass: 0,
    rawHeading: null as number | null,
    headingOffset: 0,
    dragOffset: 0,
    hasTilt: false,
    along: 0,
    alongReady: false,
    confirmedFloor: -1, // last confirmed change-floor step index
    floorWaitStarted: 0,
    offSince: 0,
    off: 0,
    viewer: { x: 0, y: 0 } as XY,
    simulating: startSimulated,
    simSpeed: 1,
    geo,
    track,
  });
  useEffect(() => {
    s.current.geo = geo;
    s.current.simulating = simulating;
    s.current.simSpeed = simSpeed;
  });

  // Keep progress when the route is replaced (e.g. re-planned from a new position).
  useEffect(() => {
    const st = s.current;
    if (st.track !== track) {
      const here = st.track.frame.toLatLng(st.viewer);
      st.track = track;
      st.along = track.project(track.frame.toXY(here)).along;
      st.confirmedFloor = -1;
    }
  }, [track]);

  useEffect(() => {
    try {
      s.current.headingOffset = Number(localStorage.getItem(OFFSET_KEY)) || 0;
    } catch {
      // Storage unavailable: no saved compass correction.
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- camera ----------
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotSupportedError' });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamOn(true);
      } catch (e) {
        const name = (e as Error)?.name;
        setCamError(
          name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow the camera for this site in your browser settings. Showing a simulated view.'
            : !window.isSecureContext
              ? 'The camera needs a secure (https) link. Showing a simulated view.'
              : 'No camera available. Showing a simulated view.',
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---------- compass and tilt ----------
  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      const screenAngle = screen.orientation?.angle ?? 0;
      const r = readOrientation(e as unknown as OrientationLike, screenAngle);
      if (!r) return;
      const st = s.current;
      st.hasTilt = true;
      st.targetPitch = r.pitch;
      st.targetRoll = r.roll;
      if (r.heading !== null) {
        st.hasCompass = true;
        st.lastCompass = performance.now();
        st.rawHeading = r.heading;
        st.targetHeading = st.heading + angleDiff(st.heading, r.heading + st.headingOffset);
      }
    };
    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    const absolute = (e: Event) => onOrientation(e as DeviceOrientationEvent);
    const relative = (e: Event) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      if (typeof ev.webkitCompassHeading === 'number' || ev.absolute || !hasAbsolute) onOrientation(ev);
    };
    if (hasAbsolute) window.addEventListener('deviceorientationabsolute', absolute, true);
    window.addEventListener('deviceorientation', relative, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', absolute, true);
      window.removeEventListener('deviceorientation', relative, true);
    };
  }, []);

  // ---------- keep the screen on ----------
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const ask = () => {
      if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      document.removeEventListener('visibilitychange', ask);
      lock?.release().catch(() => {});
    };
  }, []);

  // ---------- location ----------
  useEffect(() => {
    if (!startSimulated && geo.status === 'idle') geo.request();
  }, [geo, startSimulated]);

  // ---------- drag to look around (no compass, e.g. a laptop) ----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, [data-ar-ui]')) return;
      if (s.current.hasCompass) return;
      dragging = true;
      lastX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      s.current.dragOffset -= ((e.clientX - lastX) * 60) / el.clientWidth;
      lastX = e.clientX;
    };
    const up = () => (dragging = false);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  // ---------- main loop ----------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = s.current;
      const t = st.track;

      // The next floor change that has not been confirmed yet, and how far we may go before it.
      const gate = t.nextFloorChange(st.confirmedFloor + 1);
      const limit = gate ? gate.start : t.total;

      // Position along the route.
      if (st.simulating) {
        if (st.along < limit) st.along = Math.min(limit, st.along + WALKING_SPEED_MPS * 1.1 * st.simSpeed * dt);
        st.viewer = t.pointAt(st.along);
        st.off = 0;
        st.alongReady = true;
        // In the simulation, take the lift or stairs by itself after a short pause.
        if (gate && st.along >= limit - 0.01) {
          st.floorWaitStarted ||= now;
          if (now - st.floorWaitStarted > 1800) {
            st.confirmedFloor = gate.index;
            st.floorWaitStarted = 0;
          }
        }
      } else if (st.geo.position) {
        const q = t.frame.toXY(st.geo.position);
        const proj = t.project(q, st.alongReady ? st.along : undefined);
        st.off = proj.off;
        // Move smoothly to the new spot; never past an unconfirmed floor change.
        const target = Math.min(limit, proj.along);
        st.along = st.alongReady ? st.along + (target - st.along) * Math.min(1, dt * 3) : target;
        st.alongReady = true;
        // Close to the route (within GPS error): stand on the route, so the arrows line up.
        const acc = st.geo.accuracy ?? 20;
        st.viewer = proj.off <= Math.max(8, acc) ? t.pointAt(st.along) : q;
        st.offSince = proj.off > Math.max(25, 2 * acc) ? st.offSince || now : 0;
      }

      // Heading: compass when there is one; otherwise the route's direction (plus any drag).
      const routeHeading = t.headingAt(st.along + 2);
      if (!st.hasCompass || now - st.lastCompass > 3000) {
        st.hasCompass = st.hasCompass && now - st.lastCompass <= 3000;
        st.targetHeading = st.heading + angleDiff(st.heading, routeHeading + st.dragOffset);
      }
      st.heading += angleDiff(st.heading, st.targetHeading) * Math.min(1, dt * 6);
      st.heading = ((st.heading % 360) + 360) % 360;
      st.targetHeading = st.heading + angleDiff(st.heading, st.targetHeading);
      if (!st.hasTilt) st.targetPitch = 20;
      st.pitch += (st.targetPitch - st.pitch) * Math.min(1, dt * 5);
      st.roll += (st.targetRoll - st.roll) * Math.min(1, dt * 6);

      draw(now);

      if (now - lastHud > 150) {
        lastHud = now;
        const stepIndex = gate && st.along >= limit - 3 ? gate.index : t.stepIndexAt(st.along);
        const nextStart = t.steps.find((x) => x.index > stepIndex)?.start ?? t.total;
        const remaining = Math.max(0, t.total - st.along);
        const aim = t.pointAt(Math.min(t.total, st.along + Math.min(10, Math.max(2, remaining))));
        setHud({
          stepIndex,
          toNextStep: Math.max(0, nextStart - st.along),
          remaining,
          arrowDeg: angleDiff(st.heading, bearingXY(st.viewer, aim)),
          offRoute: !st.simulating && st.offSince > 0 && now - st.offSince > 5000,
          arrived: !gate && remaining < 4,
          floorPrompt: gate && st.along >= limit - 3 ? gate.index : null,
          heading: st.heading,
          headingSource: st.hasCompass ? 'compass' : st.dragOffset ? 'drag' : 'route',
          accuracy: st.simulating ? undefined : st.geo.accuracy,
        });
      }
      raf = requestAnimationFrame(loop);
    };

    const draw = (now: number) => {
      const cv = canvasRef.current;
      const root = rootRef.current;
      if (!cv || !root) return;
      const st = s.current;
      const t = st.track;
      const W = root.clientWidth;
      const H = root.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const v = videoRef.current;
      const cam = makeCamera({
        width: W,
        height: H,
        pitchDeg: st.pitch,
        rollRad: st.roll,
        video: v && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null,
      });
      if (cam.roll) {
        g.translate(cam.cx, cam.cy);
        g.rotate(cam.roll);
        g.translate(-cam.cx, -cam.cy);
      }
      if (!v?.videoWidth) drawSimulatedScene(g, cam);

      const gate = t.nextFloorChange(st.confirmedFloor + 1);
      const end = Math.min(t.total, st.along + AHEAD_M, gate ? gate.start : Infinity);
      const ground = (x: number, y: number) => {
        const [r, a] = toViewer(x - st.viewer.x, y - st.viewer.y, st.heading);
        return project(cam, r, a, 0);
      };
      const frameAt = (d: number) => {
        const a = t.pointAt(d);
        const b = t.pointAt(d - 0.6);
        const e = t.pointAt(d + 0.6);
        const L = Math.hypot(e.x - b.x, e.y - b.y) || 1;
        return { x: a.x, y: a.y, tx: (e.x - b.x) / L, ty: (e.y - b.y) / L };
      };
      const chevron = (fr: { x: number; y: number; tx: number; ty: number }, size: number) =>
        CHEVRON.map(([side, ahead]) =>
          ground(fr.x + fr.tx * ahead * size + fr.ty * side * size, fr.y + fr.ty * ahead * size - fr.tx * side * size),
        );
      const onScreen = (p: [number, number, number]) => p[0] > -30 && p[0] < W + 30 && p[1] > -30 && p[1] < H + 30;

      // Arrows march gently forward so the direction of travel is obvious.
      const phase = ((now / 1000) * 0.8) % CHEVRON_GAP_M;
      let drawn = 0;
      for (let d = st.along + 1.2 + phase; d < end; d += CHEVRON_GAP_M) {
        const pts = chevron(frameAt(d), 0.75);
        if (pts.some((p) => !p) || !pts.some((p) => onScreen(p!))) continue;
        paintChevron(g, pts as [number, number, number][], Math.max(0.4, 1 - (d - st.along) / (AHEAD_M + 6)));
        drawn++;
      }
      // Route behind or beside you: one arrow on the ground ahead, turned toward the route.
      if (!drawn && t.total - st.along > 3 && !(gate && st.along >= gate.start - 1)) {
        const fwd = Math.max(1.8, Math.min(4, cam.sinPitch > 0.05 ? (1.5 * cam.cosPitch) / cam.sinPitch : 4));
        const h = (st.heading * Math.PI) / 180;
        const ox = st.viewer.x + Math.sin(h) * fwd;
        const oy = st.viewer.y + Math.cos(h) * fwd;
        const aim = t.pointAt(Math.min(t.total, st.along + 10));
        const L = Math.hypot(aim.x - ox, aim.y - oy);
        if (L > 0.5) {
          const pts = chevron({ x: ox, y: oy, tx: (aim.x - ox) / L, ty: (aim.y - oy) / L }, 0.85);
          if (pts.every(Boolean) && pts.some((p) => onScreen(p!))) paintChevron(g, pts as [number, number, number][], 0.95);
        }
      }
      // Destination pin when it is close and on this floor.
      if (!gate && t.total - st.along < 60) {
        const dest = t.pointAt(t.total);
        const [r, a] = toViewer(dest.x - st.viewer.x, dest.y - st.viewer.y, st.heading);
        const base = project(cam, r, a, 0);
        const top = project(cam, r, a, 2.2);
        if (base && top) paintPin(g, base, top);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------- actions ----------
  const align = useCallback(() => {
    const st = s.current;
    if (st.rawHeading === null) {
      setToast('No compass reading yet. Move the phone a little and try again.');
      return;
    }
    st.headingOffset = Math.round(angleDiff(st.rawHeading, st.track.headingAt(st.along + 3)));
    try {
      localStorage.setItem(OFFSET_KEY, String(st.headingOffset));
    } catch {
      // Not saved; still used for this session.
    }
    setToast(`Compass aligned with the path (${st.headingOffset > 0 ? '+' : ''}${st.headingOffset}°).`);
  }, []);

  const confirmFloor = (index: number) => {
    const st = s.current;
    st.confirmedFloor = index;
    st.along = st.track.stepStart(index) + 0.1;
  };

  const goToStep = (index: number) => {
    const st = s.current;
    const i = Math.max(0, Math.min(route.steps.length - 1, index));
    // Moving past a floor change counts as having taken it.
    const passed = st.track.steps.filter((x) => x.type === 'change-floor' && x.index < i);
    st.confirmedFloor = passed.length ? passed.at(-1)!.index : -1;
    st.along = st.track.stepStart(i) + 0.1;
    if (!st.simulating) setSimulating(true);
  };

  const step = hud ? route.steps[hud.stepIndex] : route.steps[0];
  const destName = route.to.name;
  const gpsText = simulating
    ? 'Simulated walk'
    : geo.status === 'ok'
      ? `GPS ±${Math.round(geo.accuracy ?? 0)} m`
      : geo.status === 'locating' || geo.status === 'idle'
        ? 'Finding GPS…'
        : 'No GPS';
  const noGps = !simulating && (geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error');

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="AR navigation" className="fixed inset-0 z-50 touch-none overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} playsInline muted className={cx('absolute inset-0 h-full w-full object-cover', !camOn && 'hidden')} data-testid="ar-video" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      {/* Top bar */}
      <div data-ar-ui className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onExit} aria-label="Exit AR" className="grid size-11 place-items-center rounded-full bg-black/50 backdrop-blur">
          <X aria-hidden className="size-6" />
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 text-xs font-medium">
          <span className="rounded-full bg-black/50 px-2.5 py-1 backdrop-blur" data-testid="ar-gps">
            <LocateFixed aria-hidden className="mr-1 inline size-3.5" />
            {gpsText}
          </span>
          <span className="rounded-full bg-black/50 px-2.5 py-1 backdrop-blur">
            <Compass aria-hidden className="mr-1 inline size-3.5" />
            {hud?.headingSource === 'compass' ? `${Math.round(hud.heading)}°` : hud?.headingSource === 'drag' ? 'Drag to look' : 'No compass'}
          </span>
          <span className="rounded-full bg-black/50 px-2.5 py-1 backdrop-blur">
            {camOn ? <Video aria-hidden className="mr-1 inline size-3.5" /> : <VideoOff aria-hidden className="mr-1 inline size-3.5" />}
            {camOn ? 'Camera' : 'Simulated view'}
          </span>
        </div>
        <button type="button" onClick={align} className="min-h-11 rounded-full bg-black/50 px-3 text-sm font-semibold backdrop-blur" title="Point the phone along the path you are on, then tap">
          Align
        </button>
      </div>

      {/* Current step */}
      {hud && !hud.arrived && (
        <div data-ar-ui className="absolute inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-[#0b1f3a]/85 p-3 shadow-xl backdrop-blur" aria-live="polite">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-[#0b7a85]" style={{ transform: `rotate(${hud.floorPrompt === null ? hud.arrowDeg : 0}deg)` }}>
            {hud.floorPrompt === null ? <MoveUp aria-hidden className="size-7" /> : <StepIcon step={step} className="size-7" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base leading-snug font-semibold" data-testid="ar-instruction">{step.instruction}</p>
            <p className="text-sm text-white/80">
              {hud.floorPrompt === null && hud.toNextStep > 1 ? `${formatDistance(hud.toNextStep)} · ` : ''}
              Step {hud.stepIndex + 1} of {route.steps.length}
            </p>
          </div>
          <div className="flex">
            <button type="button" aria-label="Previous step" onClick={() => goToStep(hud.stepIndex - 1)} disabled={hud.stepIndex === 0} className="grid size-9 place-items-center rounded-full disabled:opacity-30">
              <ChevronLeft aria-hidden className="size-5" />
            </button>
            <button type="button" aria-label="Next step" onClick={() => goToStep(hud.stepIndex + 1)} disabled={hud.stepIndex >= route.steps.length - 1} className="grid size-9 place-items-center rounded-full disabled:opacity-30">
              <ChevronRight aria-hidden className="size-5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom area */}
      <div data-ar-ui className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/75 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {camError && <p className="rounded-xl bg-black/60 p-2.5 text-sm">{camError}</p>}
        {noGps && (
          <div className="flex items-center gap-2 rounded-xl bg-black/60 p-2.5 text-sm">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-300" />
            <span className="flex-1">Couldn&apos;t find your location. Allow location, or try the simulated walk.</span>
          </div>
        )}
        {hud?.offRoute && (
          <div role="alert" className="flex items-center gap-2 rounded-xl bg-amber-500/90 p-2.5 text-sm font-medium text-black">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            You seem to be away from the route. Follow the arrow back, or re-plan from Navigate.
          </div>
        )}
        {hud?.floorPrompt !== null && hud?.floorPrompt !== undefined && !simulating && (
          <button type="button" onClick={() => confirmFloor(hud.floorPrompt!)} className="w-full rounded-2xl bg-[#0b7a85] p-4 text-left font-semibold shadow-lg">
            {route.steps[hud.floorPrompt].instruction}
            <span className="block text-sm font-normal text-white/85">
              Tap when you are on {route.steps[hud.floorPrompt].floorChange?.toFloorName ?? 'the new floor'}
            </span>
          </button>
        )}
        {hud?.arrived ? (
          <div className="rounded-2xl bg-[#0b1f3a]/90 p-4 text-center shadow-xl" role="status">
            <Flag aria-hidden className="mx-auto size-8 text-[#68d391]" />
            <p className="mt-1 text-lg font-semibold" data-testid="ar-arrived">You have arrived at {destName}</p>
            <button type="button" onClick={onExit} className="mt-3 min-h-11 rounded-full bg-white px-6 font-semibold text-[#0b1f3a]">
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-medium">
              {hud ? `${formatDistance(hud.remaining)} · ${formatDuration(hud.remaining / WALKING_SPEED_MPS)} to ${destName}` : `Starting AR…`}
            </p>
            <button
              type="button"
              onClick={() => setSimulating((v) => !v)}
              aria-pressed={simulating}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold backdrop-blur"
            >
              {simulating ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
              {simulating ? 'Pause walk' : 'Simulate walk'}
            </button>
            {simulating && (
              <button type="button" onClick={() => setSimSpeed((v) => (v === 1 ? 3 : 1))} className="min-h-11 rounded-full bg-white/15 px-3 text-sm font-semibold backdrop-blur" aria-label="Simulation speed">
                {simSpeed}×
              </button>
            )}
          </div>
        )}
      </div>

      {toast && (
        <p aria-live="polite" className="absolute inset-x-6 top-1/2 rounded-xl bg-black/75 p-3 text-center text-sm">
          {toast}
        </p>
      )}

      {/* AR works with the phone held upright. */}
      <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/80 p-6 text-center text-lg font-semibold landscape:max-lg:flex [@media(pointer:fine)]:!hidden">
        Turn your phone upright to use AR.
      </div>
    </div>
  );
}

function paintChevron(g: CanvasRenderingContext2D, pts: [number, number, number][], alpha: number) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = 3;
  g.shadowOffsetY = 2;
  g.fillStyle = `rgba(255,190,0,${alpha})`;
  g.fill();
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.stroke();
}

function paintPin(g: CanvasRenderingContext2D, base: [number, number, number], top: [number, number, number]) {
  const r = Math.max(8, Math.min(26, 260 / base[2]));
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(base[0], base[1]);
  g.lineTo(top[0], top[1]);
  g.stroke();
  g.fillStyle = '#2f855a';
  g.beginPath();
  g.arc(top[0], top[1] - r, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3;
  g.stroke();
}

/** Sky and ground split at the horizon, for when there is no camera. */
function drawSimulatedScene(g: CanvasRenderingContext2D, cam: Camera) {
  const tan = cam.sinPitch / (cam.cosPitch || 1e-6);
  const horizon = cam.cy - cam.f * tan;
  const big = Math.max(cam.width, cam.height) * 2;
  const sky = g.createLinearGradient(0, horizon - cam.height, 0, horizon);
  sky.addColorStop(0, '#0b3a66');
  sky.addColorStop(1, '#8cc8e8');
  g.fillStyle = sky;
  g.fillRect(-big, horizon - big, cam.width + 2 * big, big);
  const ground = g.createLinearGradient(0, horizon, 0, horizon + cam.height);
  ground.addColorStop(0, '#6f8f5a');
  ground.addColorStop(1, '#3a5530');
  g.fillStyle = ground;
  g.fillRect(-big, horizon, cam.width + 2 * big, big);
  // A faint grid on the ground gives a sense of depth.
  g.strokeStyle = 'rgba(255,255,255,.12)';
  g.lineWidth = 1;
  for (let a = 2; a <= 40; a += 2) {
    const p = project(cam, 0, a, 0);
    if (!p) continue;
    g.beginPath();
    g.moveTo(-big, p[1]);
    g.lineTo(cam.width + big, p[1]);
    g.stroke();
  }
}
