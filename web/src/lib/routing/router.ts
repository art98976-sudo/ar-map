import type {
  Building,
  Destination,
  LatLng,
  Route,
  RouteEndpoint,
  RouteOptions,
  RoutePoint,
} from '../types';
import { ROUTE_SCHEMA_VERSION } from '../types';
import { NoRouteError, NotFoundError, OutOfAreaError } from '../providers/errors';
import { aStar } from './astar';
import { haversine, projectOntoSegment } from './geometry';
import type { BuiltGraph, GraphEdge, WalkGraph } from './graph';
import { buildSteps } from './steps';

/** Positions further than this from any path cannot be routed from (e.g. off campus). */
const MAX_SNAP_METRES = 400;

export interface RouterDeps {
  built: BuiltGraph;
  buildings: Building[];
  getDestination(id: string): Destination | undefined;
  provider: Route['provider'];
  isSampleData: boolean;
  now?: () => Date;
}

/** One end of a route, attached to the graph through a virtual node. */
interface Attached {
  nodeId: string;
  /** Positions the virtual node stands for (for the A* heuristic). */
  points: LatLng[];
  name: string;
  destinationId?: string;
  arrivalText: string;
  warnings: string[];
}

export class LocalRouter {
  private readonly buildingById: Map<string, Building>;
  private readonly buildingNames: Map<string, string>;

  constructor(private readonly deps: RouterDeps) {
    this.buildingById = new Map(deps.buildings.map((b) => [b.id, b]));
    this.buildingNames = new Map(deps.buildings.map((b) => [b.id, b.name]));
  }

  route(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Route {
    const graph = this.deps.built.graph.fork();
    const start = this.attach(graph, from, 'start', options);
    const end = this.attach(graph, to, 'end', options);

    const result = aStar(graph, start.nodeId, end.nodeId, { accessible: options.accessible, goalPoints: end.points });
    if (!result) {
      throw new NoRouteError(
        options.accessible
          ? `No step-free route found from ${start.name} to ${end.name}.`
          : `No route found from ${start.name} to ${end.name}.`,
      );
    }

    // Trim the zero-length joins to virtual nodes so the route starts and ends at real places.
    let { nodeIds, edges } = result;
    while (edges.length && edges[0].length === 0 && edges[0].kind === 'link') {
      edges = edges.slice(1);
      nodeIds = nodeIds.slice(1);
    }
    while (edges.length && edges.at(-1)!.length === 0 && edges.at(-1)!.kind === 'link') {
      edges = edges.slice(0, -1);
      nodeIds = nodeIds.slice(0, -1);
    }

    const steps = buildSteps(nodeIds, edges, {
      graph,
      accessible: options.accessible,
      floorsByBuilding: this.deps.built.floorsByBuilding,
      buildingNames: this.buildingNames,
      arrivalText: end.arrivalText,
    });

    const distanceMetres = Math.round(steps.reduce((s, x) => s + x.distanceMetres, 0) * 10) / 10;
    const durationSeconds = steps.reduce((s, x) => s + x.durationSeconds, 0);
    const warnings = [...start.warnings, ...end.warnings];
    const fromPoint: RoutePoint = steps[0].location;
    const toPoint: RoutePoint = steps.at(-1)!.location;

    return {
      schemaVersion: ROUTE_SCHEMA_VERSION,
      id: routeId(from, to, options),
      provider: this.deps.provider,
      isSampleData: this.deps.isSampleData,
      generatedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      accessible: options.accessible,
      from: { name: start.name, point: fromPoint, ...(start.destinationId ? { destinationId: start.destinationId } : {}) },
      to: { name: end.name, point: toPoint, ...(end.destinationId ? { destinationId: end.destinationId } : {}) },
      distanceMetres,
      durationSeconds,
      steps,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /** Adds a virtual start or end node to the graph for this endpoint. */
  private attach(graph: WalkGraph, endpoint: RouteEndpoint, role: 'start' | 'end', options: RouteOptions): Attached {
    const vid = `v:${role}`;

    if (endpoint.type === 'position') {
      const name = endpoint.name ?? 'My location';
      const p = endpoint.point;
      if (p.buildingId !== undefined && p.level !== undefined) {
        const indoor = this.nearestIndoorNode(graph, p);
        if (indoor) {
          graph.addNode({ id: vid, lat: p.lat, lng: p.lng, kind: 'virtual' });
          graph.addEdge(vid, indoor, { kind: 'approach', stepFree: true });
          return { nodeId: vid, points: [p], name, arrivalText: name, warnings: [] };
        }
      }
      this.snapOutdoor(graph, vid, p, options);
      return { nodeId: vid, points: [p], name, arrivalText: name, warnings: [] };
    }

    const dest = this.deps.getDestination(endpoint.destinationId);
    if (!dest) throw new NotFoundError('Destination', endpoint.destinationId);
    const base = { name: dest.name, destinationId: dest.id, warnings: [] as string[] };

    // Indoor room with a door on the walking graph.
    if (dest.kind !== 'building' && dest.level !== undefined) {
      const doorId = `${dest.id.replace(/^room:/, '')}-door`;
      if (graph.nodes.has(doorId)) {
        const door = graph.nodes.get(doorId)!;
        graph.addNode({ id: vid, lat: door.lat, lng: door.lng, kind: 'virtual' });
        graph.addEdge(vid, doorId, { kind: 'link', stepFree: true, length: 0 });
        return { ...base, nodeId: vid, points: [door], arrivalText: dest.name };
      }
    }

    // A building, or a place inside a building: use the building's entrances.
    const building = dest.buildingId ? this.buildingById.get(dest.buildingId) : undefined;
    if (building && building.entrances.length) {
      let entrances = building.entrances;
      if (options.accessible) {
        const stepFree = entrances.filter((e) => e.stepFree);
        if (stepFree.length) entrances = stepFree;
        else base.warnings.push(`${building.name} has no step-free entrance in this data. The route uses an entrance with steps.`);
      }
      graph.addNode({ id: vid, lat: building.centroid.lat, lng: building.centroid.lng, kind: 'virtual' });
      for (const e of entrances) {
        const indoorId = `entrance:${e.id}`;
        const nodeId = graph.nodes.has(indoorId) ? indoorId : outdoorNodeAt(graph, e.location);
        if (!nodeId) continue;
        // Entrances with steps stay usable as a last resort on accessible routes.
        graph.addEdge(vid, nodeId, { kind: 'link', stepFree: true, length: 0 });
      }
      const arrivalText = dest.kind === 'building' ? dest.name : `${building.name} (${dest.name} is inside)`;
      return { ...base, nodeId: vid, points: entrances.map((e) => e.location), arrivalText };
    }

    // An outdoor place: walk to the nearest path, then to the place itself.
    this.snapOutdoor(graph, vid, dest.location, options);
    return { ...base, nodeId: vid, points: [dest.location], arrivalText: dest.name };
  }

  private nearestIndoorNode(graph: WalkGraph, p: RoutePoint): string | undefined {
    let best: string | undefined;
    let bestD = Infinity;
    for (const n of graph.nodes.values()) {
      if (n.buildingId !== p.buildingId || n.level !== p.level || n.kind === 'virtual') continue;
      const d = haversine(n, p);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Joins a virtual node at `p` to the closest point on the outdoor path network. */
  private snapOutdoor(graph: WalkGraph, vid: string, p: LatLng, options: RouteOptions): void {
    let best: { edge: GraphEdge; point: LatLng; t: number; d: number } | undefined;
    for (const edge of this.deps.built.outdoorEdges) {
      if (options.accessible && !edge.stepFree) continue;
      const a = graph.nodes.get(edge.from)!;
      const b = graph.nodes.get(edge.to)!;
      const { point, t } = projectOntoSegment(p, a, b);
      const d = haversine(p, point);
      if (!best || d < best.d) best = { edge, point, t, d };
    }
    if (!best) throw new NoRouteError('There are no paths to route on.');
    if (best.d > MAX_SNAP_METRES) throw new OutOfAreaError(best.d);

    const snapId = `${vid}:snap`;
    graph.addNode({ id: snapId, lat: best.point.lat, lng: best.point.lng, kind: 'virtual' });
    const { edge, t } = best;
    const props = { kind: edge.kind, stepFree: edge.stepFree, name: edge.name };
    graph.addEdge(snapId, edge.from, { ...props, length: edge.length * t });
    graph.addEdge(snapId, edge.to, { ...props, length: edge.length * (1 - t) });

    graph.addNode({ id: vid, lat: p.lat, lng: p.lng, kind: 'virtual' });
    // Under a metre away: treat the place as on the path.
    graph.addEdge(vid, snapId, best.d < 1 ? { kind: 'link', stepFree: true, length: 0 } : { kind: 'approach', stepFree: true });
  }
}

function outdoorNodeAt(graph: WalkGraph, p: LatLng): string | undefined {
  const id = `o:${p.lng},${p.lat}`;
  return graph.nodes.has(id) ? id : undefined;
}

function endpointKey(e: RouteEndpoint): string {
  return e.type === 'destination' ? e.destinationId : `${e.point.lat.toFixed(5)},${e.point.lng.toFixed(5)}${e.point.level !== undefined ? `@${e.point.buildingId}:${e.point.level}` : ''}`;
}

/** Stable id for the same request, so a shared link reproduces the same route id. */
function routeId(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): string {
  const s = `${endpointKey(from)}>${endpointKey(to)}>${options.accessible ? 'a' : 's'}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `route-${h.toString(36)}`;
}
