/**
 * Camera-overlay drawing (no ground tracking, e.g. iPhone Safari): route arrows painted onto a 2D
 * canvas over the camera picture, as if lying on flat ground a calibrated height below the phone.
 */
import { APP_CONFIG } from '@/config/appConfig';
import { project, toViewer, type Camera } from '@/lib/ar/camera';
import { maxArrowDistance } from '@/lib/ar/ground';
import type { ArrowPlacement } from '@/lib/ar/placement';
import { bearingXY, type XY } from '@/lib/ar/track';
import { arrivalFade, floorGate, groundArrows } from '../engine/frame';
import type { ArState } from '../engine/state';

const CHEVRON = [[0, 1.05], [0.75, 0.05], [0.38, 0.05], [0, -0.55], [-0.38, 0.05], [-0.75, 0.05]] as const;

type ScreenPoint = [number, number, number];

/**
 * Draws one frame. `status` set means the arrows cannot be placed correctly right now, so only the
 * background (and debug marks) are drawn. Without a camera picture, a simple sky and ground are drawn.
 */
export function drawOverlay(cv: HTMLCanvasElement, cam: Camera, st: ArState, now: number, status: string | null, hasVideo: boolean) {
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
  if (!hasVideo) drawSimulatedScene(g, cam);

  const ground = (x: number, y: number) => {
    const [r, a] = toViewer(x - st.viewer.x, y - st.viewer.y, st.heading);
    return project(cam, r, a, 0);
  };
  const shapeAt = (p: XY, heading: number, size: number) => {
    const tx = Math.sin((heading * Math.PI) / 180);
    const ty = Math.cos((heading * Math.PI) / 180);
    return CHEVRON.map(([side, ahead]) => ground(p.x + tx * ahead * size + ty * side * size, p.y + ty * ahead * size - tx * side * size));
  };
  const onScreen = (p: ScreenPoint) => p[0] > -30 && p[0] < W + 30 && p[1] > -30 && p[1] < H + 30;

  const { gate } = floorGate(st);
  // Only near the walker: further away, small tilt/height errors would lift arrows off the ground.
  const ahead = Math.min(APP_CONFIG.arrows.showAheadM, maxArrowDistance(st.eyeHeight));
  const end = Math.min(t.total, st.along + ahead, gate ? gate.start : Infinity);
  const placements = groundArrows(st, now, end);

  if (!status) {
    let drawn = 0;
    const reach = ahead + 1;
    for (const a of placements) {
      // Only arrows near where you actually stand: far ones sit near the horizon and look like they float.
      if (Math.hypot(a.x - st.viewer.x, a.y - st.viewer.y) > reach) continue;
      const pts = shapeAt(a, a.heading, (a.kind === 'turn' ? 1.05 : 0.75) * a.scale);
      if (pts.some((p) => !p) || !pts.some((p) => onScreen(p!))) continue;
      paintArrow(g, pts as ScreenPoint[], a.alpha, a.kind, a.glow);
      drawn++;
    }
    // Route behind or beside you: one arrow on the ground just ahead, turned toward the route.
    if (!drawn && !st.arrivedAt && t.total - st.along > 3 && !(gate && st.along >= gate.start - 1)) {
      const fwd = Math.max(1.8, Math.min(4, cam.sinPitch > 0.05 ? (cam.eyeHeight * cam.cosPitch) / cam.sinPitch : 4));
      const h = (st.heading * Math.PI) / 180;
      const o = { x: st.viewer.x + Math.sin(h) * fwd, y: st.viewer.y + Math.cos(h) * fwd };
      const aim = t.pointAt(Math.min(t.total, st.along + 10));
      if (Math.hypot(aim.x - o.x, aim.y - o.y) > 0.5) {
        const pts = shapeAt(o, bearingXY(o, aim), 0.85);
        if (pts.every(Boolean) && pts.some((p) => onScreen(p!))) paintArrow(g, pts as ScreenPoint[], 0.95 * arrivalFade(st, now), 'chevron', 0);
      }
    }
  }
  // Destination pin when it is near and on this floor: pops in, then floats and bobs.
  const pinVisible = !status && !gate && t.total - st.along < maxArrowDistance(st.eyeHeight) + 5;
  if (pinVisible) {
    const { pinHeightM, pinBobM, pinBobPeriodMs, pinPopMs } = APP_CONFIG.arrival;
    st.pinShownAt ||= now;
    const since = now - st.pinShownAt;
    const dest = t.pointAt(t.total);
    const [r, a] = toViewer(dest.x - st.viewer.x, dest.y - st.viewer.y, st.heading);
    const lift = pinHeightM + Math.sin((since / pinBobPeriodMs) * Math.PI * 2) * pinBobM;
    const base = project(cam, r, a, 0);
    const head = project(cam, r, a, lift);
    if (base && head) paintPin(g, base, head, popEase(since / pinPopMs));
  } else {
    st.pinShownAt = 0;
  }

  if (st.debug) drawDebug(g, cam, st, placements, ground);
}

/** Ease-out with a small overshoot, for the pin popping in (0..1 → 0..1). */
function popEase(t: number) {
  const c = 1.7;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Debug marks: horizon (red dashes), the raw route line (magenta), arrow anchor points (cyan). */
function drawDebug(g: CanvasRenderingContext2D, cam: Camera, st: ArState, placements: ArrowPlacement[], ground: (x: number, y: number) => ScreenPoint | null) {
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
}

/**
 * A flat arrow "painted" on the ground: a soft shadow centred under it (no offset, which would make
 * it look raised), then the fill and a thin white edge. Turn arrows are larger and teal.
 * `glow` (0..1) brightens the fill as the light wave passes.
 */
function paintArrow(g: CanvasRenderingContext2D, pts: ScreenPoint[], alpha: number, kind: ArrowPlacement['kind'], glow: number) {
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
  const [from, to] = kind === 'turn' ? [[11, 122, 133], [111, 214, 220]] : [[255, 190, 0], [255, 240, 176]];
  const k = glow * 0.6;
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * k)).join(',');
  g.fillStyle = `rgba(${rgb},${alpha})`;
  g.fill();
  g.restore();
  path();
  g.lineWidth = 1.5;
  g.strokeStyle = `rgba(255,255,255,${0.9 * alpha})`;
  g.stroke();
}

/**
 * The destination pin: a map-pin shape floating above the spot (`head` is where its tip points),
 * with a soft shadow on the ground under it. `pop` (0..1, may overshoot) scales it as it appears.
 */
function paintPin(g: CanvasRenderingContext2D, base: ScreenPoint, head: ScreenPoint, pop: number) {
  const r = Math.max(10, Math.min(30, 300 / base[2])) * Math.max(0, pop);
  if (r < 0.5) return;
  // Shadow on the ground, directly below the pin.
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.beginPath();
  g.ellipse(base[0], base[1], r * 0.8, r * 0.26, 0, 0, Math.PI * 2);
  g.fill();
  // Pin: a round head above a point.
  const [x, y] = head;
  const cy = y - r * 1.6;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 10;
  g.fillStyle = '#2f855a';
  g.strokeStyle = 'rgba(255,255,255,.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, cy, r, Math.PI * 0.75, Math.PI * 0.25);
  g.closePath();
  g.fill();
  g.restore();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, cy, r * 0.38, 0, Math.PI * 2);
  g.fill();
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
