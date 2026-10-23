'use client';

import {
  Bug,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  Footprints,
  LocateFixed,
  MoveUp,
  Pause,
  Play,
  ScanLine,
  TriangleAlert,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoStatus } from '@/hooks/useGeolocation';
import { Alignment, circularMean, circularSpread } from '@/lib/ar/alignment';
import { makeCamera, project, toViewer, type Camera } from '@/lib/ar/camera';
import { DEFAULT_EYE_HEIGHT_M, depressionAt, eyeHeightFromTap, maxArrowDistance } from '@/lib/ar/ground';
import { readOrientation, type OrientationLike } from '@/lib/ar/orientation';
import { arrowPlacements, type ArrowPlacement } from '@/lib/ar/placement';
import { RouteTrack, angleDiff, bearingXY, type XY } from '@/lib/ar/track';
import { formatDistance, formatDuration, WALKING_SPEED_MPS } from '@/lib/route/constants';
import type { LatLng, Route } from '@/lib/types';
import { StepIcon } from '../navigate/NavigatePanel';
import { cx } from '../ui/ui';
import type { XrFrameInfo, XrGround } from './xr/XrGround';

const OFFSET_KEY = 'stirling-campus-map:ar-heading-offset';
const EYE_HEIGHT_KEY = 'stirling-campus-map:ar-eye-height';
const CHEVRON_GAP_M = 2.5;
const XR_AHEAD_M = 20;
/** Arrows are only shown with a GPS fix at least this good (metres). */
const MAX_GPS_ACCURACY_M = 30;
const CHEVRON = [[0, 1.05], [0.75, 0.05], [0.38, 0.05], [0, -0.55], [-0.38, 0.05], [-0.75, 0.05]] as const;

export interface ArViewProps {
  route: Route;
  geo: { status: GeoStatus; position?: LatLng; accuracy?: number; request(): void };
  /** Start in simulated mode (no GPS needed), e.g. for demos. */
  simulate?: boolean;
  onExit(): void;
}

type Engine = 'starting' | 'xr' | 'overlay';

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
  /** Why arrows are hidden right now (recalibrating), or null when they are shown. */
  status: string | null;
  debug: string[];
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * AR navigation. Two ways of putting arrows on the ground:
 *  - Ground tracking (WebXR, e.g. Android Chrome): the phone finds the real ground; arrows are laid on it.
 *  - Camera overlay (e.g. iPhone Safari, which has no WebXR AR): the ground is a flat plane a
 *    calibrated height below the phone, and arrows are only drawn nearby, where that holds.
 * In both, arrows follow the exact route polyline and are hidden (with a message) whenever
 * tracking, compass or GPS is not good enough, instead of being shown in the wrong place.
 */
export default function ArView({ route, geo, simulate: startSimulated = false, onExit }: ArViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xrRef = useRef<XrGround | null>(null);
  const onExitRef = useRef(onExit);

  const track = useMemo(() => new RouteTrack(route), [route]);
  const [engine, setEngine] = useState<Engine>(startSimulated ? 'overlay' : 'starting');
  const [xrAvailable, setXrAvailable] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(startSimulated);
  const [simSpeed, setSimSpeed] = useState(1);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  // Debug overlay: off by default; ?ardebug=1 turns it on from the start.
  const [debug, setDebug] = useState(() => new URLSearchParams(window.location.search).get('ardebug') === '1');

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
    compassAccuracy: null as number | null,
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
    eyeHeight: DEFAULT_EYE_HEIGHT_M,
    simulating: startSimulated,
    simSpeed: 1,
    calibrating: false,
    debug: false,
    engine: (startSimulated ? 'overlay' : 'starting') as Engine,
    geo,
    track,
    // Ground tracking (WebXR) alignment between the map and AR space.
    align: null as Alignment | null,
    manualAlign: false,
    compassSamples: [] as number[],
    lastFixUsed: null as LatLng | null,
    lastPose: null as XrFrameInfo['pose'],
    lastTick: 0,
    lastHud: 0,
    fps: 0,
  });
  useEffect(() => {
    const st = s.current;
    st.geo = geo;
    st.simulating = simulating;
    st.simSpeed = simSpeed;
    st.calibrating = calibrating;
    st.debug = debug;
    st.engine = engine;
    onExitRef.current = onExit;
    if (xrRef.current) xrRef.current.debug = debug;
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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- camera (overlay mode only: ground tracking uses the AR camera itself) ----------
  useEffect(() => {
    if (engine !== 'overlay') return;
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
      setCamOn(false);
    };
  }, [engine]);

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
      st.compassAccuracy = r.accuracy;
      if (r.heading !== null) {
        st.hasCompass = true;
        st.lastCompass = performance.now();
        st.rawHeading = r.heading;
        if (st.engine !== 'xr') st.targetHeading = st.heading + angleDiff(st.heading, r.heading + st.headingOffset);
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

  /** One-time ground calibration: the tap is on the ground 2 m ahead → phone height. */
  const calibrateAt = (x: number, y: number) => {
    const cam = overlayCamera();
    if (!cam) return;
    const h = eyeHeightFromTap(depressionAt(cam, x, y), 2);
    if (h === null) {
      setToast('That point is not on the ground. Tilt the phone down and tap the ground about 3 steps ahead.');
      return;
    }
    s.current.eyeHeight = h;
    try {
      localStorage.setItem(EYE_HEIGHT_KEY, h.toFixed(2));
    } catch {
      // Not saved; used for this session.
    }
    setCalibrating(false);
    setToast(`Ground calibrated: phone held ${h.toFixed(2)} m above the ground.`);
  };

  // ---------- the update loop (shared by both engines) ----------
  // In ground tracking the AR session calls tick() every frame; otherwise the window does.
  const tick = (now: number, xr?: XrFrameInfo) => {
    const st = s.current;
    const dt = Math.min(0.1, Math.max(0, (now - (st.lastTick || now)) / 1000));
    if (dt > 0) st.fps += (1 / dt - st.fps) * 0.05;
    st.lastTick = now;
    const t = st.track;
    const gate = t.nextFloorChange(st.confirmedFloor + 1);
    const limit = gate ? gate.start : t.total;
    let status: string | null = null;
    const gpsOk = st.geo.status === 'ok' && (st.geo.accuracy ?? 99) <= MAX_GPS_ACCURACY_M;

    const snapped = (fix: LatLng, acc: number): XY => {
      const q = t.frame.toXY(fix);
      const proj = t.project(q, st.alongReady ? st.along : undefined);
      return proj.off <= Math.max(8, acc) ? t.pointAt(proj.along) : q;
    };

    if (xr) {
      // ---- Ground tracking: position and heading from the phone's AR tracking ----
      const pose = xr.pose;
      st.lastPose = pose;
      if (!pose) status = 'Starting tracking… move your phone slowly.';
      else if (pose.tracking === 'limited') status = 'Tracking lost. Move the phone slowly to recalibrate.';
      // Compass vs AR direction: their difference is how AR space is turned against north.
      if (pose && st.rawHeading !== null && now - st.lastCompass < 500) {
        st.compassSamples.push(norm360(st.rawHeading + st.headingOffset - pose.yaw));
        if (st.compassSamples.length > 40) st.compassSamples.shift();
      }
      const steady = st.compassSamples.length >= 12 && circularSpread(st.compassSamples) < 20;
      if (pose && !st.align) {
        if (steady) {
          const origin = gpsOk && st.geo.position ? snapped(st.geo.position, st.geo.accuracy ?? 20) : t.pointAt(st.along);
          st.align = new Alignment(circularMean(st.compassSamples)!, origin, { x: pose.x, z: pose.z });
          st.lastFixUsed = st.geo.position ?? null;
        } else {
          status ??= st.hasCompass
            ? 'Calibrating the compass… hold the phone up and look around slowly.'
            : 'No compass reading. Face along the path and tap Align.';
        }
      }
      if (pose && st.align) {
        // Follow the compass slowly (unless aligned by hand), so the route never jumps.
        if (!st.manualAlign && steady && circularSpread(st.compassSamples) < 15) {
          st.align.offset = norm360(st.align.offset + angleDiff(st.align.offset, circularMean(st.compassSamples)!) * Math.min(1, dt * 0.3));
        }
        // GPS corrects slow drift; AR tracking handles the walking in between.
        const fix = st.geo.position;
        if (gpsOk && fix && fix !== st.lastFixUsed) {
          st.lastFixUsed = fix;
          const target = snapped(fix, st.geo.accuracy ?? 20);
          const user = st.align.xrToEn(pose);
          const ex = target.x - user.x;
          const ey = target.y - user.y;
          if (Math.hypot(ex, ey) > Math.max(5, 0.7 * (st.geo.accuracy ?? 20))) {
            st.align.originEN = { x: st.align.originEN.x + ex * 0.25, y: st.align.originEN.y + ey * 0.25 };
          }
        }
        const user = st.align.xrToEn(pose);
        const proj = t.project(user, st.alongReady ? st.along : undefined);
        const target = Math.min(limit, proj.along);
        st.along = st.alongReady ? st.along + (target - st.along) * Math.min(1, dt * 3) : target;
        st.alongReady = true;
        st.viewer = user;
        st.off = proj.off;
        st.offSince = proj.off > 15 ? st.offSince || now : 0;
        st.heading = st.align.xrYawToHeading(pose.yaw);
      }
      if (xr.groundY === null) status ??= 'Point the camera at the ground for a moment to find it.';
      drawXr(status);
    } else {
      // ---- Camera overlay: position from GPS (or the simulation), heading from the compass ----
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
        // Close to the route (within GPS error): stand on the route, so the arrows line up with the path.
        const acc = st.geo.accuracy ?? 20;
        st.viewer = proj.off <= Math.max(8, acc) ? t.pointAt(st.along) : q;
        st.offSince = proj.off > Math.max(25, 2 * acc) ? st.offSince || now : 0;
      }

      // Heading: compass when there is one; in the simulation without one, the route (plus drag).
      const compassFresh = st.hasCompass && now - st.lastCompass <= 3000;
      if (!compassFresh) {
        st.targetHeading = st.heading + angleDiff(st.heading, t.headingAt(st.along + 2) + (st.simulating ? st.dragOffset : 0));
      }
      st.heading = norm360(st.heading + angleDiff(st.heading, st.targetHeading) * Math.min(1, dt * 6));
      st.targetHeading = st.heading + angleDiff(st.heading, st.targetHeading);
      if (!st.hasTilt) st.targetPitch = 20;
      st.pitch += (st.targetPitch - st.pitch) * Math.min(1, dt * 8);
      st.roll += (st.targetRoll - st.roll) * Math.min(1, dt * 8);

      // Only show arrows when they can be put in the right place.
      if (!st.simulating) {
        if (st.geo.status !== 'ok') status = 'Finding your position (GPS)…';
        else if ((st.geo.accuracy ?? 99) > MAX_GPS_ACCURACY_M) status = `GPS is weak (±${Math.round(st.geo.accuracy ?? 0)} m). Arrows return when it improves.`;
        else if (!compassFresh) status = 'No compass reading. Move the phone in a figure-8; arrows return when the compass works.';
        else if (st.compassAccuracy !== null && (st.compassAccuracy < 0 || st.compassAccuracy > 25)) {
          status = 'The compass needs calibrating: move the phone in a figure-8.';
        }
      }
      if (st.calibrating) status = 'Calibrating the ground…';
      drawOverlay(now, status);
    }

    if (now - st.lastHud > 150) {
      st.lastHud = now;
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
        status,
        debug: st.debug ? debugLines(xr, status) : [],
      });
    }
  };

  const debugLines = (xr: XrFrameInfo | undefined, status: string | null): string[] => {
    const st = s.current;
    const lines = [
      `engine ${xr ? 'ground tracking (WebXR)' : 'camera overlay'} · ${Math.round(st.fps)} fps`,
      `state ${status ?? 'tracking OK, arrows shown'}`,
      `heading ${st.heading.toFixed(1)}° · compass ${st.rawHeading === null ? 'none' : `${st.rawHeading.toFixed(1)}°`}${st.compassAccuracy !== null ? ` ±${st.compassAccuracy}°` : ''} · offset ${st.headingOffset}°`,
      `gps ${st.geo.status}${st.geo.accuracy ? ` ±${Math.round(st.geo.accuracy)} m` : ''} · along ${st.along.toFixed(1)}/${st.track.total.toFixed(1)} m · off route ${st.off.toFixed(1)} m`,
    ];
    if (xr) {
      const p = xr.pose;
      lines.push(
        `pose ${p ? `${p.tracking} x${p.x.toFixed(2)} y${p.y.toFixed(2)} z${p.z.toFixed(2)} yaw ${p.yaw.toFixed(0)}°` : 'none'}`,
        `ground ${xr.groundY === null ? 'not found' : `${xr.groundY.toFixed(2)} m`} (${xr.groundSamples} hits, ${xr.floorSpace})`,
        `map→AR ${st.align ? `rotation ${st.align.offset.toFixed(1)}°${st.manualAlign ? ' (manual)' : ''}` : 'not aligned'} · compass samples ${st.compassSamples.length} spread ${circularSpread(st.compassSamples).toFixed(0)}°`,
      );
    } else {
      lines.push(
        `tilt ${st.pitch.toFixed(1)}° roll ${((st.roll * 180) / Math.PI).toFixed(1)}° · phone height ${st.eyeHeight.toFixed(2)} m · arrows to ${maxArrowDistance(st.eyeHeight).toFixed(1)} m`,
      );
    }
    return lines;
  };

  // ---------- drawing: ground tracking ----------
  const drawXr = (status: string | null) => {
    const g = xrRef.current;
    const st = s.current;
    if (!g) return;
    const align = st.align;
    if (status || !align) {
      g.update([], null, null);
      return;
    }
    const t = st.track;
    const gate = t.nextFloorChange(st.confirmedFloor + 1);
    const end = Math.min(t.total, st.along + XR_AHEAD_M, gate ? gate.start : Infinity);
    const arrows = arrowPlacements(t, st.along, end, { spacing: CHEVRON_GAP_M }).map((p) => {
      const q = align.enToXr(p);
      return { x: q.x, z: q.z, yaw: align.headingToXrYaw(p.heading), kind: p.kind, opacity: p.opacity };
    });
    const dest = !gate && t.total - st.along < 40 ? align.enToXr(t.pointAt(t.total)) : null;
    let line: { x: number; z: number }[] | null = null;
    if (st.debug) {
      line = [];
      for (let d = Math.max(0, st.along - 10); d <= Math.min(t.total, st.along + 60); d += 1) line.push(align.enToXr(t.pointAt(d)));
    }
    g.update(arrows, dest, line);
  };

  // ---------- drawing: camera overlay ----------
  const drawOverlay = (now: number, status: string | null) => {
    const cv = canvasRef.current;
    const root = rootRef.current;
    const cam = overlayCamera();
    if (!cv || !root || !cam) return;
    const st = s.current;
    const t = st.track;
    const W = cam.width;
    const H = cam.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (cam.roll) {
      g.translate(cam.cx, cam.cy);
      g.rotate(cam.roll);
      g.translate(-cam.cx, -cam.cy);
    }
    const v = videoRef.current;
    if (!v?.videoWidth) drawSimulatedScene(g, cam);

    const ground = (x: number, y: number) => {
      const [r, a] = toViewer(x - st.viewer.x, y - st.viewer.y, st.heading);
      return project(cam, r, a, 0);
    };
    const shapeAt = (p: XY, heading: number, size: number) => {
      const tx = Math.sin((heading * Math.PI) / 180);
      const ty = Math.cos((heading * Math.PI) / 180);
      return CHEVRON.map(([side, ahead]) => ground(p.x + tx * ahead * size + ty * side * size, p.y + ty * ahead * size - tx * side * size));
    };
    const onScreen = (p: [number, number, number]) => p[0] > -30 && p[0] < W + 30 && p[1] > -30 && p[1] < H + 30;

    const gate = t.nextFloorChange(st.confirmedFloor + 1);
    // Only near the walker: further away, small tilt/height errors would lift arrows off the ground.
    const end = Math.min(t.total, st.along + maxArrowDistance(st.eyeHeight), gate ? gate.start : Infinity);
    const phase = ((now / 1000) * 0.8) % CHEVRON_GAP_M;
    const placements = arrowPlacements(t, st.along, end, { spacing: CHEVRON_GAP_M, phase });

    if (!status) {
      let drawn = 0;
      for (const a of placements) {
        const pts = shapeAt(a, a.heading, a.kind === 'turn' ? 1.05 : 0.75);
        if (pts.some((p) => !p) || !pts.some((p) => onScreen(p!))) continue;
        paintArrow(g, pts as [number, number, number][], a.opacity, a.kind);
        drawn++;
      }
      // Route behind or beside you: one arrow on the ground just ahead, turned toward the route.
      if (!drawn && t.total - st.along > 3 && !(gate && st.along >= gate.start - 1)) {
        const fwd = Math.max(1.8, Math.min(4, cam.sinPitch > 0.05 ? (cam.eyeHeight * cam.cosPitch) / cam.sinPitch : 4));
        const h = (st.heading * Math.PI) / 180;
        const o = { x: st.viewer.x + Math.sin(h) * fwd, y: st.viewer.y + Math.cos(h) * fwd };
        const aim = t.pointAt(Math.min(t.total, st.along + 10));
        if (Math.hypot(aim.x - o.x, aim.y - o.y) > 0.5) {
          const pts = shapeAt(o, bearingXY(o, aim), 0.85);
          if (pts.every(Boolean) && pts.some((p) => onScreen(p!))) paintArrow(g, pts as [number, number, number][], 0.95, 'chevron');
        }
      }
      // Destination pin when it is near and on this floor.
      if (!gate && t.total - st.along < maxArrowDistance(st.eyeHeight) + 5) {
        const dest = t.pointAt(t.total);
        const [r, a] = toViewer(dest.x - st.viewer.x, dest.y - st.viewer.y, st.heading);
        const base = project(cam, r, a, 0);
        const top = project(cam, r, a, 2.2);
        if (base && top) paintPin(g, base, top);
      }
    }

    if (st.debug) drawDebug(g, cam, placements, ground);
  };

  /** Debug overlay (camera mode): horizon, the raw route line, arrow anchor points. */
  const drawDebug = (
    g: CanvasRenderingContext2D,
    cam: Camera,
    placements: ArrowPlacement[],
    ground: (x: number, y: number) => [number, number, number] | null,
  ) => {
    const st = s.current;
    const t = st.track;
    const horizon = cam.cy - (cam.f * cam.sinPitch) / (cam.cosPitch || 1e-6);
    g.save();
    g.setLineDash([8, 6]);
    g.strokeStyle = '#ff4d4d';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-cam.width, horizon);
    g.lineTo(cam.width * 2, horizon);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#ff00ff';
    g.lineWidth = 3;
    g.beginPath();
    let pen = false;
    for (let d = Math.max(0, st.along - 5); d <= Math.min(t.total, st.along + 60); d += 1) {
      const p = t.pointAt(d);
      const q = ground(p.x, p.y);
      if (!q) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
      pen = true;
    }
    g.stroke();
    g.fillStyle = '#00ffff';
    for (const a of placements) {
      const q = ground(a.x, a.y);
      if (!q) continue;
      g.beginPath();
      g.arc(q[0], q[1], 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
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
        onExitRef.current();
      },
    );
    xrRef.current.debug = s.current.debug;
    setEngine('xr');
    // tick is stable (defined below with refs only).
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
      if (!ok) return setEngine('overlay');
      try {
        await startXr();
      } catch (e) {
        // Usually: the browser wants a fresh tap before starting AR. Offer a button.
        if (!cancelled) {
          setEngine('overlay');
          setToast(`Ground tracking did not start (${(e as Error)?.message ?? e}). Tap "Ground tracking" to try again.`);
        }
      }
    })();
    return () => {
      cancelled = true;
      xrRef.current?.end();
    };
  }, [startSimulated, startXr]);

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

  // ---------- actions ----------
  const align = () => {
    const st = s.current;
    const routeHeading = st.track.headingAt(st.along + 3);
    if (st.engine === 'xr') {
      const pose = st.lastPose;
      if (!pose) return setToast('Tracking has not started yet.');
      const offset = norm360(routeHeading - pose.yaw);
      if (st.align) {
        st.align.offset = offset;
      } else {
        const origin = st.geo.position && st.geo.status === 'ok' ? st.track.frame.toXY(st.geo.position) : st.track.pointAt(st.along);
        st.align = new Alignment(offset, origin, { x: pose.x, z: pose.z });
      }
      st.manualAlign = true;
      return setToast('Aligned with the path you are facing.');
    }
    if (st.rawHeading === null) return setToast('No compass reading yet. Move the phone a little and try again.');
    st.headingOffset = Math.round(angleDiff(st.rawHeading, routeHeading));
    try {
      localStorage.setItem(OFFSET_KEY, String(st.headingOffset));
    } catch {
      // Not saved; still used for this session.
    }
    setToast(`Compass aligned with the path (${st.headingOffset > 0 ? '+' : ''}${st.headingOffset}°).`);
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

  const exit = () => {
    if (xrRef.current) xrRef.current.end();
    else onExit();
  };

  const step = hud ? route.steps[hud.stepIndex] : route.steps[0];
  const destName = route.to.name;
  const isXr = engine === 'xr';
  const gpsText = simulating
    ? 'Simulated walk'
    : geo.status === 'ok'
      ? `GPS ±${Math.round(geo.accuracy ?? 0)} m`
      : geo.status === 'locating' || geo.status === 'idle'
        ? 'Finding GPS…'
        : 'No GPS';
  const noGps = !simulating && (geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error');

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="AR navigation"
      className={cx('fixed inset-0 z-50 touch-none overflow-hidden text-white select-none', isXr ? 'bg-transparent' : 'bg-black')}
    >
      {!isXr && (
        <>
          <video ref={videoRef} playsInline muted className={cx('absolute inset-0 h-full w-full object-cover', !camOn && 'hidden')} data-testid="ar-video" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        </>
      )}

      {/* Top bar */}
      <div data-ar-ui className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={exit} aria-label="Exit AR" className="grid size-11 place-items-center rounded-full bg-black/50 backdrop-blur">
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
          <span className="rounded-full bg-black/50 px-2.5 py-1 backdrop-blur" data-testid="ar-engine">
            {isXr ? <ScanLine aria-hidden className="mr-1 inline size-3.5" /> : camOn ? <Video aria-hidden className="mr-1 inline size-3.5" /> : <VideoOff aria-hidden className="mr-1 inline size-3.5" />}
            {isXr ? 'Ground tracking' : engine === 'starting' ? 'Starting…' : camOn ? 'Camera' : 'Simulated view'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDebug((d) => !d)}
          aria-pressed={debug}
          aria-label="Debug overlay"
          className={cx('grid size-11 place-items-center rounded-full backdrop-blur', debug ? 'bg-fuchsia-600' : 'bg-black/50')}
        >
          <Bug aria-hidden className="size-5" />
        </button>
        <button type="button" onClick={align} className="min-h-11 rounded-full bg-black/50 px-3 text-sm font-semibold backdrop-blur" title="Point the phone along the path you are on, then tap">
          Align
        </button>
      </div>

      {/* Current step */}
      {hud && !hud.arrived && (
        <div data-ar-ui className="absolute inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-[#0b1f3a]/85 p-3 shadow-xl backdrop-blur" aria-live="polite">
          <div
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#0b7a85]"
            style={{ transform: `rotate(${hud.floorPrompt === null && !hud.status ? hud.arrowDeg : 0}deg)` }}
          >
            {hud.floorPrompt === null && !hud.status ? <MoveUp aria-hidden className="size-7" /> : <StepIcon step={step} className="size-7" />}
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

      {/* Recalibrating / tracking state: arrows are hidden rather than shown in the wrong place */}
      {hud?.status && !hud.arrived && !calibrating && (
        <p role="status" data-ar-ui data-testid="ar-status" className="absolute inset-x-6 top-[calc(10.5rem+env(safe-area-inset-top))] rounded-xl bg-black/65 p-2.5 text-center text-sm font-medium backdrop-blur">
          {hud.status}
        </p>
      )}

      {/* Ground calibration (camera overlay) */}
      {calibrating && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto absolute inset-x-4 top-[calc(10.5rem+env(safe-area-inset-top))] rounded-2xl bg-[#0b1f3a]/90 p-4 text-center shadow-xl" data-ar-ui>
            <Footprints aria-hidden className="mx-auto size-7" />
            <p className="mt-1 font-semibold">Tap the ground about 3 steps (2 m) in front of you</p>
            <p className="mt-1 text-sm text-white/80">Hold the phone as you will while walking. This measures how high you hold it, so arrows sit on the ground.</p>
            <button type="button" onClick={() => setCalibrating(false)} className="mt-3 min-h-11 rounded-full bg-white/15 px-5 text-sm font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Debug overlay (read-only: taps pass through, e.g. for ground calibration) */}
      {debug && hud && (
        <pre data-testid="ar-debug" className="pointer-events-none absolute inset-x-2 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] max-h-[30vh] overflow-hidden rounded-lg bg-black/70 p-2 font-mono text-[10px] leading-tight whitespace-pre-wrap text-lime-300">
          {hud.debug.join('\n')}
          {'\n'}legend: magenta = raw route, cyan = arrow anchors, red dashes = horizon (camera mode)
        </pre>
      )}

      {/* Bottom area */}
      <div data-ar-ui className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/75 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {camError && !isXr && <p className="rounded-xl bg-black/60 p-2.5 text-sm">{camError}</p>}
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
            <button type="button" onClick={exit} className="mt-3 min-h-11 rounded-full bg-white px-6 font-semibold text-[#0b1f3a]">
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium">
              {hud ? `${formatDistance(hud.remaining)} · ${formatDuration(hud.remaining / WALKING_SPEED_MPS)} to ${destName}` : `Starting AR…`}
            </p>
            {!isXr && engine === 'overlay' && (
              <button type="button" onClick={() => setCalibrating(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold backdrop-blur">
                <Footprints aria-hidden className="size-4" />
                Ground
              </button>
            )}
            {!isXr && xrAvailable && (
              <button
                type="button"
                onClick={() => startXr().catch((e) => setToast(`Ground tracking could not start: ${(e as Error)?.message ?? e}`))}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold backdrop-blur"
              >
                <ScanLine aria-hidden className="size-4" />
                Ground tracking
              </button>
            )}
            {!isXr && (
              <button
                type="button"
                onClick={() => setSimulating((v) => !v)}
                aria-pressed={simulating}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold backdrop-blur"
              >
                {simulating ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
                {simulating ? 'Pause walk' : 'Simulate walk'}
              </button>
            )}
            {simulating && !isXr && (
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

/**
 * A flat arrow "painted" on the ground: a soft shadow centred under it (no offset, which would make
 * it look raised), then the fill and a thin white edge. Turn arrows are larger and teal.
 */
function paintArrow(g: CanvasRenderingContext2D, pts: [number, number, number][], alpha: number, kind: ArrowPlacement['kind']) {
  const path = () => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
  };
  g.save();
  path();
  g.shadowColor = `rgba(0,0,0,${0.45 * alpha})`;
  g.shadowBlur = 8;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = 0;
  g.fillStyle = kind === 'turn' ? `rgba(11,122,133,${alpha})` : `rgba(255,190,0,${alpha})`;
  g.fill();
  g.restore();
  path();
  g.lineWidth = 1.5;
  g.strokeStyle = `rgba(255,255,255,${0.9 * alpha})`;
  g.stroke();
}

function paintPin(g: CanvasRenderingContext2D, base: [number, number, number], top: [number, number, number]) {
  const r = Math.max(8, Math.min(26, 260 / base[2]));
  // Contact shadow where the pin meets the ground.
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath();
  g.ellipse(base[0], base[1], r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  g.fill();
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
