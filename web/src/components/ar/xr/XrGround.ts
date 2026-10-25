/// <reference types="webxr" />
/**
 * Ground-tracking AR (WebXR immersive-ar, e.g. Chrome on Android with ARCore).
 *
 * The phone's AR tracking finds real surfaces; hit tests from the screen centre give the ground
 * height, and arrows are flat markings laid on that ground (1.5 cm above it, to avoid flicker).
 * The browser's 'local-floor' estimate is NOT used as the ground: on phones it is only a guess and
 * can sit near the phone's own height, which made arrows float at eye level. Until real hits find
 * the floor, a reticle shows where the phone is looking; after 5 s without one, arrows go 1.5 m
 * below the phone. The route is placed in AR space by the caller (see lib/ar/alignment.ts); an
 * anchor keeps that placement fixed to the real world when AR tracking corrects itself.
 * Loaded on demand, so the three.js code is not downloaded unless AR starts.
 */
import * as THREE from 'three';
import { facingYaw, type XZ } from '@/lib/ar/alignment';
import { FALLBACK_BELOW_CAMERA_M, GroundEstimator, groundHeight, type GroundSource } from '@/lib/ar/ground';

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
  /** 'hits': measured floor; 'fallback': no floor found, 1.5 m below the phone; null: still looking. */
  groundSource: GroundSource | null;
  groundSamples: number;
  floorSpace: 'local-floor' | 'local';
  /** Height the arrows are drawn at (ground + 1.5 cm), or null while they are hidden. */
  arrowY: number | null;
  /** Where the route's anchor is now (it moves when AR tracking corrects itself), or null. */
  originAnchor: XZ | null;
  anchorsSupported: boolean;
}

export interface XrArrow {
  x: number;
  z: number;
  /** AR yaw the arrow points to. */
  yaw: number;
  kind: 'chevron' | 'turn';
  opacity: number;
}

type Ground = { y: number; source: GroundSource } | null;

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
  private readonly floorPlane = new THREE.Group();
  private readonly floorPlaneMaterial: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Mesh;
  private hitSource: XRHitTestSource | null = null;
  private lastHit: THREE.Vector3 | null = null;
  private lastHitAt = 0;
  private cameraY: number | null = null;
  private searchStartedAt = performance.now();
  private arrowsShown = false;
  // Anchor for the route's origin: requested by the caller, created inside the next frame.
  private anchorRequest: { x: number; y: number; z: number; gen: number } | null = null;
  private anchor: XRAnchor | null = null;
  private anchorGen = 0;
  private anchorPosition: XZ | null = null;
  readonly anchorsSupported: boolean;
  debug = false;

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly session: XRSession,
    readonly floorSpace: 'local-floor' | 'local',
  ) {
    // enabledFeatures is missing on older browsers; then try anchors and let them fail quietly.
    this.anchorsSupported = session.enabledFeatures ? session.enabledFeatures.includes('anchors') : true;
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

    // Debug: the raw route line, the latest ground hit, and the floor as a translucent plane with a
    // 1 m grid centred under the phone (cyan = measured floor, orange = 1.5 m fallback).
    this.routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff00ff }));
    this.hitMarker = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide }));
    this.floorPlaneMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const grid = new THREE.GridHelper(8, 8, 0x00ffff, 0x00ffff);
    grid.position.y = 0.002;
    this.floorPlane.add(new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), this.floorPlaneMaterial), grid);
    this.debugGroup.add(this.routeLine, this.hitMarker, this.floorPlane);
    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);

    // Placement reticle: a ring on the floor where the screen centre points, while finding the floor.
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.reticle.visible = false;
    this.scene.add(this.reticle);
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
      optionalFeatures: ['local-floor', 'dom-overlay', 'anchors'],
      domOverlay: { root: overlayRoot },
    });
    let floorSpace: 'local-floor' | 'local' = 'local';
    try {
      await session.requestReferenceSpace('local-floor');
      floorSpace = 'local-floor';
    } catch {
      // No floor estimate; fine, the ground comes from hit tests either way.
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType(floorSpace);
    await renderer.xr.setSession(session);

    const self = new XrGround(renderer, session, floorSpace);
    const viewer = await session.requestReferenceSpace('viewer');
    // The viewer space's ray points straight out of the screen centre.
    self.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
      const ref = renderer.xr.getReferenceSpace();
      if (!frame || !ref) return;
      const vp = frame.getViewerPose(ref);
      if (vp) self.cameraY = vp.transform.position.y;
      // Ground: hit test from the screen centre; only flat surfaces well below the phone count.
      const hit = self.hitSource ? frame.getHitTestResults(self.hitSource)[0]?.getPose(ref) : undefined;
      if (hit) {
        const o = hit.transform.orientation;
        q.set(o.x, o.y, o.z, o.w);
        const normalY = v.set(0, 1, 0).applyQuaternion(q).y;
        const hp = hit.transform.position;
        if (self.ground.add(hp.y, normalY, self.cameraY ?? undefined)) {
          self.lastHit = new THREE.Vector3(hp.x, hp.y, hp.z);
          self.lastHitAt = performance.now();
        }
      }
      self.updateAnchor(frame, ref);
      let pose: XrPose | null = null;
      if (vp) {
        const o = vp.transform.orientation;
        q.set(o.x, o.y, o.z, o.w);
        const f = v.set(0, 0, -1).applyQuaternion(q);
        const forward = { x: f.x, y: f.y, z: f.z };
        const u = v.set(0, 1, 0).applyQuaternion(q);
        // Robust even when the camera looks straight down at the ground.
        const yaw = facingYaw(forward, { x: u.x, y: u.y, z: u.z });
        const p = vp.transform.position;
        pose = { x: p.x, y: p.y, z: p.z, yaw, tracking: vp.emulatedPosition ? 'limited' : 'ok' };
      }
      const g = self.currentGround();
      // The caller draws the arrows from here (update()), so this frame's arrows use this ground.
      onFrame({
        pose,
        groundY: g?.y ?? null,
        groundSource: g?.source ?? null,
        groundSamples: self.ground.samples,
        floorSpace,
        arrowY: self.arrowsShown && g ? g.y + ARROW_LIFT_M : null,
        originAnchor: self.anchorPosition,
        anchorsSupported: self.anchorsSupported,
      });
      self.updateHelpers(pose, g);
      renderer.render(self.scene, self.camera);
    });
    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      onEnd();
    });
    return self;
  }

  /** Ground now: measured from hits, or the 1.5 m fallback after 5 s without them, or null while looking. */
  private currentGround(): Ground {
    return groundHeight({ measured: this.ground.height, cameraY: this.cameraY, searchingMs: performance.now() - this.searchStartedAt });
  }

  get groundY(): number | null {
    return this.currentGround()?.y ?? null;
  }

  /** After a floor change the ground is somewhere else: measure it again. */
  resetGround() {
    this.ground.reset();
    this.lastHit = null;
    this.searchStartedAt = performance.now();
  }

  /**
   * Anchors the route's origin (a point in AR space) to the real world, replacing any earlier
   * anchor; null removes it. From then on each frame reports where that anchor is (originAnchor).
   */
  anchorOrigin(p: XZ | null) {
    this.anchorGen++;
    this.anchor?.delete();
    this.anchor = null;
    this.anchorPosition = null;
    const y = this.groundY ?? (this.cameraY ?? 0) - FALLBACK_BELOW_CAMERA_M;
    this.anchorRequest = p && this.anchorsSupported ? { x: p.x, y, z: p.z, gen: this.anchorGen } : null;
  }

  private updateAnchor(frame: XRFrame, ref: XRReferenceSpace) {
    const req = this.anchorRequest;
    if (req && frame.createAnchor) {
      this.anchorRequest = null;
      frame
        .createAnchor(new XRRigidTransform({ x: req.x, y: req.y, z: req.z }), ref)
        .then((a) => {
          if (req.gen === this.anchorGen) this.anchor = a;
          else a.delete();
        })
        .catch(() => {
          // No anchor: the route stays where it was placed, just without drift correction.
        });
    }
    if (this.anchor) {
      const p = frame.getPose(this.anchor.anchorSpace, ref)?.transform.position;
      if (p) this.anchorPosition = { x: p.x, z: p.z };
    }
  }

  /** The reticle while finding the floor; in debug, the floor plane too. */
  private updateHelpers(pose: XrPose | null, g: Ground) {
    const freshHit = this.lastHit !== null && performance.now() - this.lastHitAt < 600;
    this.reticle.visible = freshHit && (g?.source !== 'hits' || this.debug);
    if (this.reticle.visible) this.reticle.position.copy(this.lastHit!).setY(this.lastHit!.y + 0.005);
    this.floorPlane.visible = this.debug && g !== null && pose !== null;
    if (this.floorPlane.visible) {
      this.floorPlane.position.set(pose!.x, g!.y + 0.003, pose!.z);
      this.floorPlaneMaterial.color.set(g!.source === 'fallback' ? 0xff8800 : 0x00ffff);
    }
  }

  /** Lays the given arrows on the ground. An empty list hides them (e.g. while recalibrating). */
  update(arrows: XrArrow[], dest: { x: number; z: number } | null, routeLine: { x: number; z: number }[] | null) {
    const y = this.groundY;
    const show = y !== null;
    this.arrowsShown = show && arrows.length > 0;
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

    this.debugGroup.visible = this.debug;
    this.routeLine.visible = show && routeLine !== null;
    if (this.debug && show && routeLine?.length) {
      const pts = routeLine.map((p) => new THREE.Vector3(p.x, y! + 0.03, p.z));
      this.routeLine.geometry.dispose();
      this.routeLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    this.hitMarker.visible = this.debug && this.lastHit !== null;
    if (this.hitMarker.visible) this.hitMarker.position.copy(this.lastHit!).setY(this.lastHit!.y + 0.005);
  }

  end() {
    this.anchor?.delete();
    this.session.end().catch(() => {});
  }
}
