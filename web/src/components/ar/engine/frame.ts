/**
 * One step of the AR frame loop: where you are on the route, which way you face, and whether the
 * arrows can be shown. Shared by both engines (ground tracking and camera overlay); drawing is
 * done elsewhere. Each step returns why arrows are hidden right now, or null when they are shown.
 */
import { Alignment, circularMean, circularSpread } from '@/lib/ar/alignment';
import { arrowPlacements } from '@/lib/ar/placement';
import { canAskMotionPermission } from '@/lib/ar/orientation';
import { angleDiff, bearingXY, type XY } from '@/lib/ar/track';
import { WALKING_SPEED_MPS } from '@/lib/route/constants';
import type { LatLng } from '@/lib/types';
import type { XrArrow, XrFrameInfo } from '../xr/XrGround';
import {
  CHEVRON_GAP_M,
  MAX_GPS_ACCURACY_M,
  MOTION_GRACE_MS,
  XR_AHEAD_M,
  norm360,
  offRouteText,
  type ArEffects,
  type ArState,
  type Hud,
} from './state';

const gpsOk = (st: ArState) => st.geo.status === 'ok' && (st.geo.accuracy ?? 99) <= MAX_GPS_ACCURACY_M;

/** The next floor change that has not been confirmed, and how far along the route you may go before it. */
export function floorGate(st: ArState) {
  const gate = st.track.nextFloorChange(st.confirmedFloor + 1);
  return { gate, limit: gate ? gate.start : st.track.total };
}

/** A GPS fix on the map; close to the route (within its error) it is moved onto the route. */
function snapped(st: ArState, fix: LatLng, acc: number): XY {
  const t = st.track;
  const q = t.frame.toXY(fix);
  const proj = t.project(q, st.alongReady ? st.along : undefined);
  return proj.off <= Math.max(8, acc) ? t.pointAt(proj.along) : q;
}

/** Ground tracking: position and heading come from the phone's AR tracking. */
export function stepXr(st: ArState, xr: XrFrameInfo, now: number, dt: number, fx: ArEffects): string | null {
  const t = st.track;
  const { limit } = floorGate(st);
  let status: string | null = null;
  const pose = xr.pose;
  st.lastPose = pose;
  if (st.align && xr.originAnchor) st.align.originXR = xr.originAnchor;
  // No floor found within 5 s: say so once, since arrows are now only roughly on the ground.
  if (xr.groundSource === 'fallback' && st.groundSource !== 'fallback') {
    fx.toast('No floor found. Arrows are placed about 1.5 m below your phone; point it at the floor to improve this.');
  }
  st.groundSource = xr.groundSource;
  if (!pose) status = 'Starting tracking… move your phone slowly.';
  else if (pose.tracking === 'limited') status = 'Tracking lost. Move the phone slowly to recalibrate.';
  // Compass vs AR direction: their difference is how AR space is turned against north.
  if (pose && st.rawHeading !== null && now - st.lastCompass < 500) {
    st.compassSamples.push(norm360(st.rawHeading + st.headingOffset - pose.yaw));
    if (st.compassSamples.length > 40) st.compassSamples.shift();
  }
  const steady = st.compassSamples.length >= 12 && circularSpread(st.compassSamples) < 20;
  if (pose && !st.align) {
    if (!gpsOk(st) || !st.geo.position) {
      // Where you are on the map is needed to place the route around you.
      status ??= st.geo.status === 'ok' ? `Waiting for a better GPS fix (±${Math.round(st.geo.accuracy ?? 0)} m)…` : 'Finding your position (GPS)…';
    } else if (steady) {
      const origin = snapped(st, st.geo.position, st.geo.accuracy ?? 20);
      st.align = new Alignment(circularMean(st.compassSamples)!, origin, { x: pose.x, z: pose.z });
      fx.anchorOrigin(st.align.originXR);
      st.lastFixUsed = st.geo.position;
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
    if (gpsOk(st) && fix && fix !== st.lastFixUsed) {
      st.lastFixUsed = fix;
      const target = snapped(st, fix, st.geo.accuracy ?? 20);
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
    if (proj.off > 20) status ??= offRouteText(proj.off);
  }
  if (xr.groundY === null) status ??= 'Point your phone at the floor and move it slowly.';
  return status;
}

/** Camera overlay: position from GPS (or the simulation), heading from the compass. */
export function stepOverlay(st: ArState, now: number, dt: number): string | null {
  const t = st.track;
  const { gate, limit } = floorGate(st);
  let status: string | null = null;
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
    const acc = st.geo.accuracy ?? 20;
    if (st.geo.status !== 'ok') status = 'Finding your position (GPS)…';
    else if ((st.geo.accuracy ?? 99) > MAX_GPS_ACCURACY_M) status = `GPS is weak (±${Math.round(st.geo.accuracy ?? 0)} m). Arrows return when it improves.`;
    // Not on the route: the route ahead of you is somewhere else, so its arrows would float in the distance.
    else if (st.off > Math.max(15, acc)) status = offRouteText(st.off);
    else if (!st.hasTilt) {
      status =
        now - st.openedAt < MOTION_GRACE_MS
          ? 'Starting motion sensors…'
          : canAskMotionPermission()
            ? 'Motion sensors are off. Tap "Allow motion" and choose Allow.'
            : 'Motion sensors are off. Allow motion and orientation access for this site in your browser settings.';
    } else if (!compassFresh) status = 'No compass reading. Move the phone in a figure-8; arrows return when the compass works.';
    else if (st.compassAccuracy !== null && (st.compassAccuracy < 0 || st.compassAccuracy > 25)) {
      status = 'The compass needs calibrating: move the phone in a figure-8.';
    }
  }
  if (st.calibrating) status = 'Calibrating the ground…';
  return status;
}

/** Ground tracking: the arrows to lay on the ground now, or null to hide them. */
export function xrScene(st: ArState): { arrows: XrArrow[]; dest: { x: number; z: number } | null; line: { x: number; z: number }[] | null } | null {
  const align = st.align;
  if (!align) return null;
  const t = st.track;
  const { gate } = floorGate(st);
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
  return { arrows, dest, line };
}

/** What the controls show, plus one-time warnings (off the route, no location). */
export function makeHud(st: ArState, now: number, status: string | null, debug: string[], fx: ArEffects): Hud {
  const t = st.track;
  const { gate, limit } = floorGate(st);
  const stepIndex = gate && st.along >= limit - 3 ? gate.index : t.stepIndexAt(st.along);
  const nextStart = t.steps.find((x) => x.index > stepIndex)?.start ?? t.total;
  const remaining = Math.max(0, t.total - st.along);
  // Off the route: point to the nearest part of it; on it: to the path 10 m ahead.
  const aim = st.off > 15 ? t.pointAt(st.along) : t.pointAt(Math.min(t.total, st.along + Math.min(10, Math.max(2, remaining))));

  const offRoute = !st.simulating && st.offSince > 0 && now - st.offSince > 5000;
  if (offRoute && !st.warnedOffRoute) fx.toast('You seem to be away from the route. Follow the arrow back, or re-plan from Navigate.');
  st.warnedOffRoute = offRoute;
  const noGps = !st.simulating && (st.geo.status === 'denied' || st.geo.status === 'unavailable' || st.geo.status === 'error');
  if (noGps && !st.warnedNoGps) fx.toast("Couldn't find your location. Allow location, or try Simulate walk in the menu.");
  st.warnedNoGps = noGps;

  return {
    stepIndex,
    toNextStep: Math.max(0, nextStart - st.along),
    remaining,
    arrowDeg: angleDiff(st.heading, bearingXY(st.viewer, aim)),
    // Arrived only when actually there: near the end of the route AND close to the route itself.
    arrived: !gate && remaining < 4 && (st.simulating || st.off <= Math.max(15, st.geo.accuracy ?? 15)),
    floorPrompt: gate && st.along >= limit - 3 ? gate.index : null,
    heading: st.heading,
    headingSource: st.hasCompass ? 'compass' : st.dragOffset ? 'drag' : 'route',
    status,
    askMotion: !st.simulating && !st.hasTilt && now - st.openedAt >= MOTION_GRACE_MS && canAskMotionPermission(),
    debug,
  };
}
