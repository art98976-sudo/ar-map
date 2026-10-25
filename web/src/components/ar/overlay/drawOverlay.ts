/**
 * Camera-overlay drawing (no ground tracking, e.g. iPhone Safari): route arrows painted onto a 2D
 * canvas over the camera picture, as if lying on flat ground a calibrated height below the phone.
 */
import { project, toViewer, type Camera } from '@/lib/ar/camera';
import { maxArrowDistance } from '@/lib/ar/ground';
import { arrowPlacements, type ArrowPlacement } from '@/lib/ar/placement';
import { bearingXY, type XY } from '@/lib/ar/track';
import { floorGate } from '../engine/frame';
import { CHEVRON_GAP_M, type ArState } from '../engine/state';

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
  const end = Math.min(t.total, st.along + maxArrowDistance(st.eyeHeight), gate ? gate.start : Infinity);
  const phase = ((now / 1000) * 0.8) % CHEVRON_GAP_M;
  const placements = arrowPlacements(t, st.along, end, { spacing: CHEVRON_GAP_M, phase });

  if (!status) {
    let drawn = 0;
    const reach = maxArrowDistance(st.eyeHeight) + 1;
    for (const a of placements) {
      // Only arrows near where you actually stand: far ones sit near the horizon and look like they float.
      if (Math.hypot(a.x - st.viewer.x, a.y - st.viewer.y) > reach) continue;
      const pts = shapeAt(a, a.heading, a.kind === 'turn' ? 1.05 : 0.75);
      if (pts.some((p) => !p) || !pts.some((p) => onScreen(p!))) continue;
      paintArrow(g, pts as ScreenPoint[], a.opacity, a.kind);
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
        if (pts.every(Boolean) && pts.some((p) => onScreen(p!))) paintArrow(g, pts as ScreenPoint[], 0.95, 'chevron');
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

  if (st.debug) drawDebug(g, cam, st, placements, ground);
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
 */
function paintArrow(g: CanvasRenderingContext2D, pts: ScreenPoint[], alpha: number, kind: ArrowPlacement['kind']) {
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

function paintPin(g: CanvasRenderingContext2D, base: ScreenPoint, top: ScreenPoint) {
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
