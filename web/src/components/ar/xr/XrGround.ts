/// <reference types="webxr" />
/**
 * Ground-tracking AR (WebXR immersive-ar, e.g. Chrome on Android with ARCore).
 *
 * The phone's AR tracking finds real surfaces; hit tests against them give the ground height, and
 * arrows are flat markings laid on that ground (1.5 cm above it, to avoid flicker). The route is
 * placed in AR space by the caller (see lib/ar/alignment.ts); this class only draws.
 * Loaded on demand, so the three.js code is not downloaded unless AR starts.
 */
import * as THREE from 'three';
import { GroundEstimator } from '@/lib/ar/ground';

export interface XrPose {
  x: number;
  y: number;
  z: number;
  /** Degrees clockwise from the AR -z axis (see alignment.ts). */
  yaw: number;
  /** "limited": the device lost visual tracking (position is only estimated). */
  tracking: 'ok' | 'limited';
}

export interface XrFrameInfo {
  pose: XrPose | null;
  groundY: number | null;
  groundSamples: number;
  floorSpace: 'local-floor' | 'local';
}

export interface XrArrow {
  x: number;
  z: number;
  /** AR yaw the arrow points to. */
  yaw: number;
  kind: 'chevron' | 'turn';
  opacity: number;
}

const ARROW_LIFT_M = 0.015;
const POOL_SIZE = 14;
const CHEVRON: [number, number][] = [[0, 1.05], [0.75, 0.05], [0.38, 0.05], [0, -0.55], [-0.38, 0.05], [-0.75, 0.05]];

export async function xrArSupported(): Promise<boolean> {
  try {
    return Boolean(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

/** A flat chevron lying on the ground (y = 0), pointing along -z, pivot at its centre on the ground. */
function chevronGeometry(scale: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(CHEVRON.map(([side, ahead]) => new THREE.Vector2(side * scale, ahead * scale)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A soft round shadow texture, so arrows look painted on the ground rather than hovering. */
function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface PooledArrow {
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  outline: THREE.MeshBasicMaterial;
  shadow: THREE.MeshBasicMaterial;
}

export class XrGround {
  private readonly ground = new GroundEstimator(20);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly chevrons: PooledArrow[] = [];
  private readonly turns: PooledArrow[] = [];
  private readonly pin = new THREE.Group();
  private readonly debugGroup = new THREE.Group();
  private readonly routeLine: THREE.Line;
  private readonly hitMarker: THREE.Mesh;
  private hitSource: XRHitTestSource | null = null;
  private lastHit: THREE.Vector3 | null = null;
  debug = false;

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly session: XRSession,
    readonly floorSpace: 'local-floor' | 'local',
  ) {
    const shadowTex = shadowTexture();
    const make = (scale: number, color: number): PooledArrow => {
      const fill = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
      const outline = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
      const shadow = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
      const group = new THREE.Group();
      const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7 * scale, 1.9 * scale).rotateX(-Math.PI / 2), shadow);
      shadowMesh.position.y = -0.01; // just above the real ground (group sits 1.5 cm up)
      const outlineMesh = new THREE.Mesh(chevronGeometry(scale * 1.12), outline);
      outlineMesh.position.y = -0.002;
      const fillMesh = new THREE.Mesh(chevronGeometry(scale), fill);
      group.add(shadowMesh, outlineMesh, fillMesh);
      group.visible = false;
      this.scene.add(group);
      return { group, fill, outline, shadow };
    };
    for (let i = 0; i < POOL_SIZE; i++) this.chevrons.push(make(0.55, 0xffbe00));
    for (let i = 0; i < 4; i++) this.turns.push(make(0.8, 0x0b7a85));

    // Destination pin standing on the ground.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    pole.position.y = 1;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), new THREE.MeshBasicMaterial({ color: 0x2f855a }));
    ball.position.y = 2.15;
    this.pin.add(pole, ball);
    this.pin.visible = false;
    this.scene.add(this.pin);

    // Debug: the raw route line and the latest ground hit.
    this.routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff00ff }));
    this.hitMarker = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide }));
    this.debugGroup.add(this.routeLine, this.hitMarker);
    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);
  }

  /**
   * Starts an immersive AR session. Must be called from a user tap (browsers require it).
   * `overlayRoot` stays visible on top of the camera (DOM overlay) for the step card and buttons.
   */
  static async start(overlayRoot: HTMLElement, onFrame: (info: XrFrameInfo) => void, onEnd: () => void): Promise<XrGround> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR is not available.');
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: overlayRoot },
    });
    let floorSpace: 'local-floor' | 'local' = 'local';
    try {
      await session.requestReferenceSpace('local-floor');
      floorSpace = 'local-floor';
    } catch {
      // The device has no floor estimate; hit tests alone will find the ground.
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType(floorSpace);
    await renderer.xr.setSession(session);

    const self = new XrGround(renderer, session, floorSpace);
    const viewer = await session.requestReferenceSpace('viewer');
    self.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
      const ref = renderer.xr.getReferenceSpace();
      if (!frame || !ref) return;
      // Ground: hit test straight out from the camera; only flat surfaces count.
      const hit = self.hitSource ? frame.getHitTestResults(self.hitSource)[0]?.getPose(ref) : undefined;
      if (hit) {
        const o = hit.transform.orientation;
        q.set(o.x, o.y, o.z, o.w);
        const normalY = v.set(0, 1, 0).applyQuaternion(q).y;
        if (self.ground.add(hit.transform.position.y, normalY)) {
          self.lastHit = new THREE.Vector3(hit.transform.position.x, hit.transform.position.y, hit.transform.position.z);
        }
      }
      const vp = frame.getViewerPose(ref);
      let pose: XrPose | null = null;
      if (vp) {
        const o = vp.transform.orientation;
        q.set(o.x, o.y, o.z, o.w);
        const f = v.set(0, 0, -1).applyQuaternion(q);
        const yaw = ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
        const p = vp.transform.position;
        pose = { x: p.x, y: p.y, z: p.z, yaw, tracking: vp.emulatedPosition ? 'limited' : 'ok' };
      }
      onFrame({ pose, groundY: self.groundY, groundSamples: self.ground.samples, floorSpace });
      renderer.render(self.scene, self.camera);
    });
    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      onEnd();
    });
    return self;
  }

  /** Ground height: from hit tests; with a floor estimate (local-floor) the floor is y = 0 until hits arrive. */
  get groundY(): number | null {
    return this.ground.height ?? (this.floorSpace === 'local-floor' ? 0 : null);
  }

  /** After a floor change the ground is somewhere else: measure it again. */
  resetGround() {
    this.ground.reset();
  }

  /** Lays the given arrows on the ground. An empty list hides them (e.g. while recalibrating). */
  update(arrows: XrArrow[], dest: { x: number; z: number } | null, routeLine: { x: number; z: number }[] | null) {
    const y = this.groundY;
    const show = y !== null;
    let ci = 0;
    let ti = 0;
    for (const a of show ? arrows : []) {
      const pooled = a.kind === 'turn' ? this.turns[ti++] : this.chevrons[ci++];
      if (!pooled) continue;
      pooled.group.visible = true;
      pooled.group.position.set(a.x, y! + ARROW_LIFT_M, a.z);
      pooled.group.rotation.set(0, (-a.yaw * Math.PI) / 180, 0);
      pooled.fill.opacity = a.opacity;
      pooled.outline.opacity = a.opacity;
      pooled.shadow.opacity = a.opacity;
    }
    for (let i = ci; i < this.chevrons.length; i++) this.chevrons[i].group.visible = false;
    for (let i = ti; i < this.turns.length; i++) this.turns[i].group.visible = false;

    this.pin.visible = show && dest !== null;
    if (show && dest) this.pin.position.set(dest.x, y!, dest.z);

    this.debugGroup.visible = this.debug && show;
    if (this.debug && show) {
      if (routeLine?.length) {
        const pts = routeLine.map((p) => new THREE.Vector3(p.x, y! + 0.03, p.z));
        this.routeLine.geometry.dispose();
        this.routeLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
      this.hitMarker.visible = this.lastHit !== null;
      if (this.lastHit) this.hitMarker.position.copy(this.lastHit).setY(this.lastHit.y + 0.005);
    }
  }

  end() {
    this.session.end().catch(() => {});
  }
}
