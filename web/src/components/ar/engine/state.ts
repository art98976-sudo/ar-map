/**
 * The AR screen's live state, shared by the frame loop, the drawing code and the controls.
 * It lives in a ref (not React state) so the animation loop can run every frame without re-rendering.
 */
import type { GeoStatus } from '@/hooks/useGeolocation';
import type { Alignment } from '@/lib/ar/alignment';
import { DEFAULT_EYE_HEIGHT_M } from '@/lib/ar/ground';
import type { RouteTrack, XY } from '@/lib/ar/track';
import { formatDistance } from '@/lib/route/constants';
import type { LatLng } from '@/lib/types';
import type { XrFrameInfo } from '../xr/XrGround';

export const OFFSET_KEY = 'stirling-campus-map:ar-heading-offset';
export const EYE_HEIGHT_KEY = 'stirling-campus-map:ar-eye-height';
/** Arrows are only shown with a GPS fix at least this good (metres). */
export const MAX_GPS_ACCURACY_M = 30;
/** Motion readings get this long to arrive before AR says the sensors are off. */
export const MOTION_GRACE_MS = 1500;

/** starting: checking the device; choose: ground tracking is available, waiting for the tap that starts it. */
export type Engine = 'starting' | 'choose' | 'xr' | 'overlay';

export interface ArGeo {
  status: GeoStatus;
  position?: LatLng;
  accuracy?: number;
  request(): void;
}

/** What the controls show; refreshed a few times a second from the frame loop. */
export interface Hud {
  stepIndex: number;
  toNextStep: number;
  remaining: number;
  arrowDeg: number;
  arrived: boolean;
  /** Index of the change-floor step waiting for confirmation, or null. */
  floorPrompt: number | null;
  heading: number;
  headingSource: 'compass' | 'route' | 'drag';
  /** Why arrows are hidden right now, or null when they are shown. */
  status: string | null;
  /** No motion readings: show a button that asks for Motion & Orientation access again (iPhone). */
  askMotion: boolean;
  debug: string[];
}

/** What the frame loop may ask the screen to do. */
export interface ArEffects {
  toast(message: string): void;
  /** Ground tracking: pin the route's origin to the real world. */
  anchorOrigin(p: { x: number; z: number }): void;
}

export function createArState(opts: { simulating: boolean; geo: ArGeo; track: RouteTrack }) {
  return {
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
    groundSource: null as XrFrameInfo['groundSource'],
    warnedOffRoute: false,
    warnedNoGps: false,
    /** When AR opened; motion readings get a moment to arrive before we say they are off. */
    openedAt: 0,
    along: 0,
    alongReady: false,
    /** Last confirmed change-floor step index. */
    confirmedFloor: -1,
    floorWaitStarted: 0,
    offSince: 0,
    off: 0,
    viewer: { x: 0, y: 0 } as XY,
    eyeHeight: DEFAULT_EYE_HEIGHT_M,
    simulating: opts.simulating,
    simSpeed: 1,
    calibrating: false,
    debug: false,
    engine: (opts.simulating ? 'overlay' : 'starting') as Engine,
    geo: opts.geo,
    track: opts.track,
    // Ground tracking (WebXR) alignment between the map and AR space.
    align: null as Alignment | null,
    manualAlign: false,
    compassSamples: [] as number[],
    lastFixUsed: null as LatLng | null,
    lastPose: null as XrFrameInfo['pose'],
    /** When you arrived (performance.now()), or 0. Set once per route, so a wobbling GPS cannot undo it. */
    arrivedAt: 0,
    /** When the destination pin came into view, or 0 while it is hidden (it pops in from then). */
    pinShownAt: 0,
    /** The phone asks for less motion: arrows stay steady instead of pulsing. */
    reduceMotion: false,
    lastTick: 0,
    lastHud: 0,
    fps: 0,
  };
}

export type ArState = ReturnType<typeof createArState>;

export const norm360 = (d: number) => ((d % 360) + 360) % 360;

export const offRouteText = (off: number) =>
  `You are ${formatDistance(off)} from the route. Arrows appear when you reach it; follow the arrow at the top.`;
