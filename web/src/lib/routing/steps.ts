import { ACCESSIBLE_SPEED_MPS, WALKING_SPEED_MPS } from '../route/constants';
import type { Floor, RoutePoint, RouteStep } from '../types';
import {
  TURN_THRESHOLD_DEGREES,
  TURN_WORDS,
  bearing,
  cardinal,
  classifyTurn,
  turnAngle,
} from './geometry';
import type { GraphEdge, GraphNode, WalkGraph } from './graph';

/** Seconds to climb or descend one floor by stairs. */
export const STAIRS_SECONDS_PER_LEVEL = 20;
/** Average wait plus ride for a lift. */
export const LIFT_SECONDS = 45;

export interface StepContext {
  graph: WalkGraph;
  accessible: boolean;
  floorsByBuilding: Map<string, Floor[]>;
  buildingNames: Map<string, string>;
  /** Name of the destination, used in the final instruction. */
  arrivalText: string;
}

const isVertical = (e: GraphEdge) => e.kind === 'stairs' || e.kind === 'lift';
const isIndoor = (n: GraphNode) => n.buildingId !== undefined && n.kind !== 'virtual';
const round1 = (n: number) => Math.round(n * 10) / 10;

function toRoutePoint(n: GraphNode): RoutePoint {
  return isIndoor(n)
    ? { lat: n.lat, lng: n.lng, buildingId: n.buildingId, ...(n.floorId ? { floorId: n.floorId } : {}), level: n.level ?? 0 }
    : { lat: n.lat, lng: n.lng };
}

/** "Main walkway", "the corridor", or nothing. */
function placeName(e: GraphEdge, to: GraphNode): string | undefined {
  if (e.name) return e.name;
  if (isIndoor(to) && (e.kind === 'corridor' || e.kind === 'door')) return 'the corridor';
  return undefined;
}

/** " by the north entrance" from an entrance node named "Cottrell north entrance". */
function byEntrance(n: GraphNode, buildingName: string): string {
  if (n.kind !== 'entrance' || !n.name) return '';
  const first = buildingName.split(' ')[0].toLowerCase();
  const words = n.name.split(' ');
  const rest = words[0].toLowerCase() === first ? words.slice(1).join(' ') : n.name;
  return rest ? ` by the ${rest}` : '';
}

interface Draft {
  step: Omit<RouteStep, 'index' | 'distanceMetres' | 'durationSeconds'>;
  distance: number;
  fixedSeconds?: number;
}

/**
 * Turns a node path into human steps: a step starts at a turn, a building entrance or exit,
 * a floor change, or the start of steps / a ramp. Straight stretches are merged into one step.
 */
export function buildSteps(nodeIds: string[], edges: GraphEdge[], ctx: StepContext): RouteStep[] {
  const node = (id: string) => ctx.graph.nodes.get(id)!;
  const drafts: Draft[] = [];
  const speed = ctx.accessible ? ACCESSIBLE_SPEED_MPS : WALKING_SPEED_MPS;
  const floorName = (buildingId?: string, level?: number) =>
    ctx.floorsByBuilding.get(buildingId ?? '')?.find((f) => f.level === level)?.name ?? `level ${level}`;

  // Drop zero-length joins (outdoor node <-> indoor entrance node); they are the same spot.
  const legs = edges.filter((e) => e.length > 0 || isVertical(e));

  let prevWalk: GraphEdge | undefined; // last horizontal edge walked
  for (let i = 0; i < legs.length; i++) {
    const e = legs[i];
    const a = node(e.from);
    const b = node(e.to);

    if (isVertical(e)) {
      // Merge a run of stairs/lift edges into one floor change.
      let j = i;
      while (j + 1 < legs.length && legs[j + 1].kind === e.kind) j++;
      const end = node(legs[j].to);
      const fromLevel = a.level ?? 0;
      const toLevel = end.level ?? 0;
      const toName = floorName(end.buildingId, toLevel);
      const dir = toLevel > fromLevel ? 'up' : 'down';
      const levels = Math.abs(toLevel - fromLevel);
      drafts.push({
        step: {
          type: 'change-floor',
          instruction: e.kind === 'lift' ? `Take the lift to ${toName}` : `Take the stairs ${dir} to ${toName}`,
          location: toRoutePoint(a),
          path: [toRoutePoint(a), toRoutePoint(end)],
          floorChange: {
            via: e.kind === 'lift' ? 'lift' : 'stairs',
            fromLevel,
            toLevel,
            ...(a.floorId ? { fromFloorId: a.floorId } : {}),
            ...(end.floorId ? { toFloorId: end.floorId } : {}),
            toFloorName: toName,
          },
        },
        distance: 0,
        fixedSeconds: e.kind === 'lift' ? LIFT_SECONDS : STAIRS_SECONDS_PER_LEVEL * levels,
      });
      prevWalk = undefined;
      i = j;
      continue;
    }

    const current = drafts.at(-1);
    const name = placeName(e, b);
    let start: Draft['step'] | undefined;

    if (!current) {
      const along = name ? ` along ${name}` : '';
      start = { type: 'walk', instruction: `Head ${cardinal(bearing(a, b))}${along}`, location: toRoutePoint(a), path: [] };
    } else if (isIndoor(b) && (!isIndoor(a) || (prevWalk !== undefined && !isIndoor(node(prevWalk.to))))) {
      const buildingName = ctx.buildingNames.get(b.buildingId!) ?? 'the building';
      start = {
        type: 'enter-building',
        buildingId: b.buildingId,
        instruction: `Enter ${buildingName}${byEntrance(a, buildingName)}`,
        location: toRoutePoint(a),
        path: [],
      };
    } else if (!isIndoor(b) && (isIndoor(a) || (prevWalk !== undefined && isIndoor(node(prevWalk.to))))) {
      const door = isIndoor(a) ? a : node(prevWalk!.to);
      const buildingName = ctx.buildingNames.get(door.buildingId!) ?? 'the building';
      start = {
        type: 'exit-building',
        buildingId: door.buildingId,
        instruction: `Leave ${buildingName}${byEntrance(door, buildingName)}`,
        location: toRoutePoint(a),
        path: [],
      };
    } else if (current.step.type === 'change-floor') {
      start = { type: 'walk', instruction: `Walk along ${name ?? 'the corridor'}`, location: toRoutePoint(a), path: [] };
    } else if ((e.kind === 'steps' || e.kind === 'ramp') && prevWalk?.kind !== e.kind) {
      const what = e.kind === 'steps' ? `Take the ${e.name ?? 'steps'}` : `Take the ${e.name ?? 'ramp'} (step-free)`;
      start = { type: 'walk', instruction: what, location: toRoutePoint(a), path: [] };
    } else if (prevWalk) {
      const angle = turnAngle(bearing(node(prevWalk.from), a), bearing(a, b));
      if (Math.abs(angle) >= TURN_THRESHOLD_DEGREES) {
        const turn = classifyTurn(angle);
        const onto =
          b.kind === 'lift' ? ' to the lift'
          : b.kind === 'stairs' ? ' to the stairs'
          : e.kind === 'door' ? ' through the door'
          : name && name !== 'the corridor' ? ` onto ${name}`
          : '';
        start = { type: 'turn', turn, instruction: `${TURN_WORDS[turn]}${onto}`, location: toRoutePoint(a), path: [] };
      }
    }

    if (start) {
      start.path.push(toRoutePoint(a));
      drafts.push({ step: start, distance: 0 });
    }
    const d = drafts.at(-1)!;
    d.step.path.push(toRoutePoint(b));
    d.distance += e.length;
    prevWalk = e;
  }

  const lastId = nodeIds.at(-1)!;
  const last = node(lastId);
  const floorSuffix = isIndoor(last) && ctx.floorsByBuilding.has(last.buildingId!) ? `, ${floorName(last.buildingId, last.level)}` : '';
  drafts.push({
    step: { type: 'arrive', instruction: `You have arrived at ${ctx.arrivalText}${floorSuffix}`, location: toRoutePoint(last), path: [toRoutePoint(last)] },
    distance: 0,
  });

  return drafts.map((d, index) => {
    const distanceMetres = round1(d.distance);
    return {
      index,
      ...d.step,
      distanceMetres,
      durationSeconds: d.fixedSeconds ?? Math.round(distanceMetres / speed),
    } as RouteStep;
  });
}
