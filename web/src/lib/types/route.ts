/**
 * The shared route format. The web map draws it today; the AR app will read
 * exactly the same JSON later. Keep this file in sync with
 * public/data/schemas/route.schema.json (tests check that they agree).
 */

export const ROUTE_SCHEMA_VERSION = '1.0' as const;

/**
 * A point on a route. Outdoor points have only lat/lng.
 * Indoor points also carry the building and its z-level (and floor id when known).
 */
export interface RoutePoint {
  lat: number;
  lng: number;
  buildingId?: string;
  floorId?: string;
  /** Z-level: 0 is the ground floor. Required whenever buildingId is set. */
  level?: number;
}

export const ROUTE_STEP_TYPES = [
  'walk',
  'turn',
  'enter-building',
  'exit-building',
  'change-floor',
  'arrive',
] as const;
export type RouteStepType = (typeof ROUTE_STEP_TYPES)[number];

export const TURN_DIRECTIONS = [
  'straight',
  'slight-left',
  'left',
  'sharp-left',
  'slight-right',
  'right',
  'sharp-right',
  'u-turn',
] as const;
export type TurnDirection = (typeof TURN_DIRECTIONS)[number];

export interface FloorChange {
  via: 'stairs' | 'lift';
  fromLevel: number;
  toLevel: number;
  fromFloorId?: string;
  toFloorId?: string;
  /** Label of the target floor, e.g. "Floor 2", for prompts like "Take the lift to Floor 2". */
  toFloorName?: string;
}

export interface RouteStep {
  /** 0-based position in the route. */
  index: number;
  type: RouteStepType;
  /** Plain-language instruction, e.g. "Turn left onto Main walkway". */
  instruction: string;
  /** Where the step begins (the point where the instruction applies). */
  location: RoutePoint;
  /** Points walked during this step, starting at `location`. At least one point. */
  path: RoutePoint[];
  distanceMetres: number;
  durationSeconds: number;
  /** Required when type is "turn". */
  turn?: TurnDirection;
  /** Required when type is "change-floor". */
  floorChange?: FloorChange;
  /** Required when type is "enter-building" or "exit-building". */
  buildingId?: string;
}

export interface RouteEnd {
  name: string;
  point: RoutePoint;
  /** Set when the end is a known destination (not "My location"). */
  destinationId?: string;
}

export interface Route {
  schemaVersion: typeof ROUTE_SCHEMA_VERSION;
  id: string;
  provider: 'local' | 'mazemap';
  /** True when the route was built from approximate sample data. */
  isSampleData: boolean;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  /** True when the route avoids stairs and steps. */
  accessible: boolean;
  from: RouteEnd;
  to: RouteEnd;
  distanceMetres: number;
  durationSeconds: number;
  /** Ordered steps. The last step is always "arrive". */
  steps: RouteStep[];
}

/** Where a route starts or ends: a known destination, or a raw position such as "My location". */
export type RouteEndpoint =
  | { type: 'destination'; destinationId: string }
  | { type: 'position'; point: RoutePoint; name?: string };

export interface RouteOptions {
  /** Avoid stairs and steps. */
  accessible: boolean;
}
