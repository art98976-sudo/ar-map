'use client';

/**
 * AR navigation. Two ways of putting arrows on the ground:
 *  - Ground tracking (WebXR, e.g. Android Chrome): the phone finds the real ground; arrows are laid on it.
 *  - Camera overlay (e.g. iPhone Safari, which has no WebXR AR): the ground is a flat plane a
 *    calibrated height below the phone, and arrows are only drawn nearby, where that holds.
 * In both, arrows follow the exact route polyline and are hidden (with a message) whenever
 * tracking, compass or GPS is not good enough, instead of being shown in the wrong place.
 *
 * This file wires the pieces together:
 *  - engine/   the live state, one step of the frame loop, the debug text
 *  - overlay/  drawing for the camera overlay
 *  - xr/       ground tracking (three.js + WebXR)
 *  - hooks/    camera, sensors, wake lock, messages, idle fade
 *  - ui/       the controls on screen
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_CONFIG } from '@/config/appConfig';
import { Alignment } from '@/lib/ar/alignment';
import { makeCamera, type Camera } from '@/lib/ar/camera';
import { depressionAt, eyeHeightFromTap } from '@/lib/ar/ground';
import { requestMotionPermission } from '@/lib/ar/orientation';
import { RouteTrack, angleDiff } from '@/lib/ar/track';
import { markOnboardingSeen } from '@/lib/state/onboarding';
import type { Route } from '@/lib/types';
import { Onboarding } from '../onboarding/Onboarding';
import { cx } from '../ui/ui';
import { DEBUG_AT_START, debugLines } from './engine/debug';
import { checkArrival, makeHud, stepOverlay, stepXr, xrScene } from './engine/frame';
import { EYE_HEIGHT_KEY, OFFSET_KEY, createArState, norm360, type ArEffects, type ArGeo, type Engine, type Hud } from './engine/state';
import { useCameraStream } from './hooks/useCameraStream';
import { useDeviceOrientation } from './hooks/useDeviceOrientation';
import { useIdle } from './hooks/useIdle';
import { useToastQueue } from './hooks/useToastQueue';
import { useWakeLock } from './hooks/useWakeLock';
import { drawOverlay } from './overlay/drawOverlay';
import { ArBottomBar } from './ui/ArBottomBar';
import { ArrivedCard, CalibrationCard, DebugPanel, FloorPrompt, StartArCard } from './ui/ArCards';
import { ArMenu } from './ui/ArMenu';
import { ArStatus, ArTopBar } from './ui/ArTopBar';
import type { XrFrameInfo, XrGround } from './xr/XrGround';

/** A short buzz; phones that cannot vibrate (e.g. iPhone) just skip it. */
function vibrate(pattern: readonly number[]) {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    // Not supported: arriving still shows the card.
  }
}

interface ArViewProps {
  route: Route;
  geo: ArGeo;
  /** Start in simulated mode (no GPS needed), e.g. for demos. */
  simulate?: boolean;
  /** Leave AR (the End button). */
  onExit(): void;
  /** Leave AR and show the route on the 2D map. */
  onShowMap?(): void;
  /** Leave AR and search for a new destination (from the arrival card). */
  onNavigateElsewhere?(): void;
}

export default function ArView({ route, geo, simulate: startSimulated = false, onExit, onShowMap, onNavigateElsewhere }: ArViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xrRef = useRef<XrGround | null>(null);
  const onExitRef = useRef(onExit);
  const onShowMapRef = useRef(onShowMap);
  const onNavigateElsewhereRef = useRef(onNavigateElsewhere);
  /** Where to go once AR has closed (ground tracking closes asynchronously). */
  const leaveToRef = useRef<LeaveTo>('exit');

  const track = useMemo(() => new RouteTrack(route), [route]);
  const [engine, setEngine] = useState<Engine>(startSimulated ? 'overlay' : 'starting');
  const [xrAvailable, setXrAvailable] = useState(false);
  const [simulating, setSimulating] = useState(startSimulated);
  const [simSpeed, setSimSpeed] = useState(1);
  const [hud, setHud] = useState<Hud | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  // The tutorial, opened again from the menu. Drawn inside AR: ground tracking only shows what is inside this view.
  const [tutorial, setTutorial] = useState(false);
  // Debug overlay: off by default; the config switch or ?ardebug=1 turns it on from the start.
  const [debug, setDebug] = useState(DEBUG_AT_START);
  const { toast, showToast } = useToastQueue();
  const { idle, wake } = useIdle(APP_CONFIG.arScreen.idleFadeMs);

  // Everything the animation loop needs, kept in a ref so it runs without re-rendering.
  const s = useRef(createArState({ simulating: startSimulated, geo, track }));
  useEffect(() => {
    const st = s.current;
    st.geo = geo;
    st.simulating = simulating;
    st.simSpeed = simSpeed;
    st.calibrating = calibrating;
    st.debug = debug;
    st.engine = engine;
    onExitRef.current = onExit;
    onShowMapRef.current = onShowMap;
    onNavigateElsewhereRef.current = onNavigateElsewhere;
    if (xrRef.current) xrRef.current.debug = debug;
  });

  const { videoRef, on: camOn } = useCameraStream(engine === 'overlay', showToast);
  useWakeLock();

  // ---------- compass and tilt ----------
  useEffect(() => {
    s.current.openedAt = performance.now();
    s.current.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);
  useDeviceOrientation((r) => {
    const st = s.current;
    st.hasTilt = true;
    st.targetPitch = r.pitch;
    st.targetRoll = r.roll;
    st.compassAccuracy = r.accuracy;
    if (r.heading !== null) {
      st.hasCompass = true;
      st.lastCompass = performance.now();
      st.rawHeading = r.heading;
      if (st.engine !== 'xr') st.targetHeading = st.heading + angleDiff(st.heading, r.heading + st.headingOffset);
    }
  });

  // Keep progress when the route is replaced (e.g. re-planned from a new position).
  useEffect(() => {
    const st = s.current;
    if (st.track !== track) {
      const here = st.track.frame.toLatLng(st.viewer);
      st.track = track;
      st.along = track.project(track.frame.toXY(here)).along;
      st.confirmedFloor = -1;
      st.align = null; // the map frame changed with the new route; align again
      st.arrivedAt = 0; // a new route can be arrived at again
      st.pinShownAt = 0;
      xrRef.current?.anchorOrigin(null);
      st.compassSamples = [];
    }
  }, [track]);

  // Saved settings: compass correction and phone height.
  useEffect(() => {
    try {
      s.current.headingOffset = Number(localStorage.getItem(OFFSET_KEY)) || 0;
      const h = Number(localStorage.getItem(EYE_HEIGHT_KEY));
      if (h > 0.5 && h < 2.5) s.current.eyeHeight = h;
    } catch {
      // Storage unavailable: defaults.
    }
  }, []);

  useEffect(() => {
    if (!startSimulated && geo.status === 'idle') geo.request();
  }, [geo, startSimulated]);

  /** The camera model for the overlay, as drawn right now. */
  const overlayCamera = (): Camera | null => {
    const root = rootRef.current;
    if (!root) return null;
    const st = s.current;
    const v = videoRef.current;
    return makeCamera({
      width: root.clientWidth,
      height: root.clientHeight,
      pitchDeg: st.pitch,
      rollRad: st.roll,
      eyeHeight: st.eyeHeight,
      video: v && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null,
    });
  };

  /** One-time ground calibration: the tap is on the ground 2 m ahead, which gives the phone's height. */
  const calibrateAt = (x: number, y: number) => {
    const cam = overlayCamera();
    if (!cam) return;
    const h = eyeHeightFromTap(depressionAt(cam, x, y), 2);
    if (h === null) {
      showToast('That point is not on the ground. Tilt the phone down and tap the ground about 3 steps ahead.');
      return;
    }
    s.current.eyeHeight = h;
    try {
      localStorage.setItem(EYE_HEIGHT_KEY, h.toFixed(2));
    } catch {
      // Not saved; used for this session.
    }
    setCalibrating(false);
    showToast(`Ground calibrated: phone held ${h.toFixed(2)} m above the ground.`);
  };

  // ---------- the frame loop (shared by both engines) ----------
  // In ground tracking the AR session calls tick() every frame; otherwise the window does.
  const effects: ArEffects = { toast: showToast, anchorOrigin: (p) => xrRef.current?.anchorOrigin(p) };
  const tick = (now: number, xr?: XrFrameInfo) => {
    const st = s.current;
    const dt = Math.min(0.1, Math.max(0, (now - (st.lastTick || now)) / 1000));
    if (dt > 0) st.fps += (1 / dt - st.fps) * 0.05;
    st.lastTick = now;

    let status: string | null;
    if (xr) {
      status = stepXr(st, xr, now, dt, effects);
      const scene = status ? null : xrScene(st, now);
      xrRef.current?.update(scene?.arrows ?? [], scene?.dest ?? null, scene?.line ?? null);
    } else {
      status = stepOverlay(st, now, dt);
      const cv = canvasRef.current;
      const cam = overlayCamera();
      if (cv && cam) drawOverlay(cv, cam, st, now, status, Boolean(videoRef.current?.videoWidth));
    }
    // Arriving happens once per route: buzz, and show the arrival card straight away.
    if (checkArrival(st, now)) {
      vibrate(APP_CONFIG.arrival.vibrationMs);
      st.lastHud = 0;
    }

    if (now - st.lastHud > 150) {
      st.lastHud = now;
      setHud(makeHud(st, now, status, st.debug ? debugLines(st, xr, status) : [], effects));
    }
  };

  // ---------- choose the engine: ground tracking (WebXR) when the device has it ----------
  const startXr = useCallback(async () => {
    const { XrGround } = await import('./xr/XrGround');
    const root = rootRef.current;
    if (!root) return;
    xrRef.current = await XrGround.start(
      root,
      (info) => tick(performance.now(), info),
      () => {
        xrRef.current = null;
        leaveTo(leaveToRef.current, { exit: onExitRef.current, map: onShowMapRef.current, search: onNavigateElsewhereRef.current });
      },
    );
    xrRef.current.debug = s.current.debug;
    setEngine('xr');
    // tick only uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startSimulated) return;
    let cancelled = false;
    (async () => {
      const { xrArSupported } = await import('./xr/XrGround');
      const ok = await xrArSupported();
      if (cancelled) return;
      setXrAvailable(ok);
      // Browsers only start AR from a tap, so ask for one. The 3D code is already loaded by now,
      // so the tap starts AR straight away instead of timing out while it downloads.
      setEngine(ok ? 'choose' : 'overlay');
    })().catch(() => !cancelled && setEngine('overlay'));
    return () => {
      cancelled = true;
      xrRef.current?.end();
    };
  }, [startSimulated]);

  // Overlay mode runs on the window's animation frames (ground tracking uses the AR session's).
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      if (s.current.engine !== 'xr') tick(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // tick only uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- pointer: drag to look around (simulation without compass), or the calibration tap ----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, [data-ar-ui]')) return;
      const st = s.current;
      if (st.calibrating) {
        calibrateAt(e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top);
        return;
      }
      if (st.hasCompass || !st.simulating) return;
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
    // calibrateAt only uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- actions ----------
  // Must run straight from a tap: iPhone only shows the Motion & Orientation prompt then.
  const askMotion = () => {
    requestMotionPermission().then((r) => {
      if (r === 'denied') showToast('Motion access is blocked for this site. Fully close Safari, open this page again and choose Allow.');
    });
  };

  const startGroundTracking = () => {
    startXr().catch((e) => {
      setEngine('overlay');
      showToast(`Ground tracking could not start (${(e as Error)?.message ?? e}). Using the camera view.`);
    });
  };

  const align = () => {
    const st = s.current;
    const routeHeading = st.track.headingAt(st.along + 3);
    if (st.engine === 'xr') {
      const pose = st.lastPose;
      if (!pose) return showToast('Tracking has not started yet.');
      const offset = norm360(routeHeading - pose.yaw);
      if (st.align) {
        st.align.offset = offset;
      } else {
        const origin = st.geo.position && st.geo.status === 'ok' ? st.track.frame.toXY(st.geo.position) : st.track.pointAt(st.along);
        st.align = new Alignment(offset, origin, { x: pose.x, z: pose.z });
        xrRef.current?.anchorOrigin(st.align.originXR);
      }
      st.manualAlign = true;
      return showToast('Aligned with the path you are facing.');
    }
    if (st.rawHeading === null) return showToast('No compass reading yet. Move the phone a little and try again.');
    st.headingOffset = Math.round(angleDiff(st.rawHeading, routeHeading));
    try {
      localStorage.setItem(OFFSET_KEY, String(st.headingOffset));
    } catch {
      // Not saved; still used for this session.
    }
    showToast(`Compass aligned with the path (${st.headingOffset > 0 ? '+' : ''}${st.headingOffset}°).`);
  };

  const confirmFloor = (index: number) => {
    const st = s.current;
    st.confirmedFloor = index;
    st.along = st.track.stepStart(index) + 0.1;
    // New floor: find the ground again before showing arrows.
    xrRef.current?.resetGround();
  };

  const goToStep = (index: number) => {
    const st = s.current;
    const i = Math.max(0, Math.min(route.steps.length - 1, index));
    // Moving past a floor change counts as having taken it.
    const passed = st.track.steps.filter((x) => x.type === 'change-floor' && x.index < i);
    st.confirmedFloor = passed.length ? passed.at(-1)!.index : -1;
    st.along = st.track.stepStart(i) + 0.1;
    if (!st.simulating && st.engine !== 'xr') setSimulating(true);
  };

  const leave = (to: LeaveTo) => {
    leaveToRef.current = to;
    if (xrRef.current) xrRef.current.end();
    else leaveTo(to, { exit: onExit, map: onShowMap, search: onNavigateElsewhere });
  };

  // ---------- screen ----------
  const isXr = engine === 'xr';
  // The menu button is part of the bottom bar, which the arrival card replaces: no menu after arriving.
  const showMenu = menuOpen && !hud?.arrived;
  const gpsText = simulating
    ? 'Simulated walk'
    : geo.status === 'ok'
      ? `GPS ±${Math.round(geo.accuracy ?? 0)} m`
      : geo.status === 'locating' || geo.status === 'idle'
        ? 'Finding GPS…'
        : 'No GPS';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="AR navigation"
      onPointerDownCapture={wake}
      className={cx('fixed inset-0 z-50 touch-none overflow-hidden text-white select-none', isXr ? 'bg-transparent' : 'bg-black')}
    >
      {!isXr && (
        <>
          <video ref={videoRef} playsInline muted className={cx('absolute inset-0 h-full w-full object-cover', !camOn && 'hidden')} data-testid="ar-video" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        </>
      )}

      <ArTopBar hud={hud} route={route} />
      {hud?.status && !hud.arrived && !calibrating && <ArStatus status={hud.status} askMotion={hud.askMotion} onAskMotion={askMotion} />}
      {calibrating && <CalibrationCard onCancel={() => setCalibrating(false)} />}
      {debug && hud && <DebugPanel lines={hud.debug} />}

      {/* Tap outside the menu to close it */}
      {showMenu && <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 cursor-default" onClick={() => setMenuOpen(false)} />}

      {/* Bottom: one message at a time, the menu when open, the floor prompt, and the compact bar */}
      <div className="absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2">
        {toast && (
          <p aria-live="polite" data-ar-ui className="self-center rounded-xl bg-black/75 px-3 py-2 text-center text-sm backdrop-blur">
            {toast}
          </p>
        )}
        {showMenu && (
          <ArMenu
            gpsText={gpsText}
            compassText={hud?.headingSource === 'compass' ? `${Math.round(hud.heading)}°` : hud?.headingSource === 'drag' ? 'Drag to look' : 'No compass'}
            engineText={isXr ? 'Ground tracking' : engine === 'starting' ? 'Starting…' : camOn ? 'Camera' : 'Simulated view'}
            engineIcon={isXr ? 'xr' : camOn ? 'camera' : 'none'}
            step={hud ? { index: hud.stepIndex, count: route.steps.length } : null}
            onStep={goToStep}
            onAlign={align}
            onCalibrate={!isXr && engine === 'overlay' ? () => setCalibrating(true) : undefined}
            onGroundTracking={!isXr && xrAvailable ? () => startXr().catch((e) => showToast(`Ground tracking could not start: ${(e as Error)?.message ?? e}`)) : undefined}
            simulation={!isXr ? { on: simulating, speed: simSpeed, onToggle: () => setSimulating((v) => !v), onSpeed: () => setSimSpeed((v) => (v === 1 ? 3 : 1)) } : undefined}
            debug={debug}
            onDebug={() => setDebug((d) => !d)}
            onTutorial={() => setTutorial(true)}
            onClose={() => setMenuOpen(false)}
          />
        )}
        {hud?.floorPrompt != null && !simulating && <FloorPrompt step={route.steps[hud.floorPrompt]} onConfirm={() => confirmFloor(hud.floorPrompt!)} />}
        {engine === 'choose' ? (
          <StartArCard onStart={startGroundTracking} onSimple={() => setEngine('overlay')} />
        ) : hud?.arrived ? (
          <ArrivedCard
            destName={route.to.name}
            onDone={() => leave('exit')}
            onNavigateElsewhere={onNavigateElsewhere ? () => leave('search') : undefined}
          />
        ) : (
          <ArBottomBar
            destName={route.to.name}
            remaining={hud ? hud.remaining : null}
            faded={idle && !menuOpen}
            menuOpen={menuOpen}
            onMenu={() => setMenuOpen((o) => !o)}
            onEnd={() => leave('exit')}
            onShowMap={onShowMap ? () => leave('map') : undefined}
          />
        )}
      </div>

      {tutorial && (
        <Onboarding
          onClose={() => {
            markOnboardingSeen();
            setTutorial(false);
          }}
        />
      )}

      {/* AR works with the phone held upright. */}
      <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/80 p-6 text-center text-lg font-semibold landscape:max-lg:flex [@media(pointer:fine)]:!hidden">
        Turn your phone upright to use AR.
      </div>
    </div>
  );
}

type LeaveTo = 'exit' | 'map' | 'search';

/** Runs the handler for where to go after AR; falls back to plain exit when that one is not given. */
function leaveTo(to: LeaveTo, handlers: { exit(): void; map?: () => void; search?: () => void }) {
  const handler = to === 'map' ? handlers.map : to === 'search' ? handlers.search : undefined;
  (handler ?? handlers.exit)();
}
