import type { IndoorData, PathProps, SampleCollection } from '../data/sampleTypes';
import type { Floor, LatLng } from '../types';
import { haversine } from './geometry';

export type EdgeKind =
  | 'footpath'
  | 'steps'
  | 'ramp'
  | 'approach'
  | 'link'
  | 'corridor'
  | 'door'
  | 'entrance'
  | 'stairs'
  | 'lift';

export interface GraphNode extends LatLng {
  id: string;
  /** Set for indoor nodes. */
  buildingId?: string;
  floorId?: string;
  level?: number;
  kind: 'outdoor' | 'corridor' | 'door' | 'stairs' | 'lift' | 'entrance' | 'virtual';
  name?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Horizontal length in metres (0 for stairs and lifts). */
  length: number;
  stepFree: boolean;
  name?: string;
}

/** Bidirectional walking graph. Outdoor and indoor nodes live in one graph. */
export class WalkGraph {
  readonly nodes = new Map<string, GraphNode>();
  private readonly adj = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) return existing;
    this.nodes.set(node.id, node);
    this.adj.set(node.id, []);
    return node;
  }

  addEdge(from: string, to: string, props: Omit<GraphEdge, 'from' | 'to' | 'length'> & { length?: number }): void {
    const a = this.nodes.get(from);
    const b = this.nodes.get(to);
    if (!a || !b) throw new Error(`Edge ${from} -> ${to} references an unknown node`);
    const length = props.length ?? haversine(a, b);
    this.adj.get(from)!.push({ ...props, from, to, length });
    this.adj.get(to)!.push({ ...props, from: to, to: from, length });
  }

  edgesFrom(id: string): readonly GraphEdge[] {
    return this.adj.get(id) ?? [];
  }

  /** A copy that shares nodes and edges but can take temporary start and end nodes. */
  fork(): WalkGraph {
    const g = new WalkGraph();
    for (const [id, n] of this.nodes) g.nodes.set(id, n);
    for (const [id, list] of this.adj) g.adj.set(id, [...list]);
    return g;
  }
}

/** Id of the outdoor node at a coordinate. Paths that share a coordinate share a node. */
export const outdoorNodeId = ([lng, lat]: GeoJSON.Position) => `o:${lng},${lat}`;

export interface BuiltGraph {
  graph: WalkGraph;
  /** Outdoor edges, kept for snapping free positions onto the network. */
  outdoorEdges: GraphEdge[];
  floorsByBuilding: Map<string, Floor[]>;
}

export function buildWalkGraph(
  paths: SampleCollection<GeoJSON.LineString, PathProps>,
  indoor: Iterable<IndoorData>,
): BuiltGraph {
  const graph = new WalkGraph();
  const outdoorEdges: GraphEdge[] = [];

  for (const f of paths.features) {
    const coords = f.geometry.coordinates;
    coords.forEach(([lng, lat]) => graph.addNode({ id: outdoorNodeId([lng, lat]), lat, lng, kind: 'outdoor' }));
    for (let i = 1; i < coords.length; i++) {
      const from = outdoorNodeId(coords[i - 1]);
      const to = outdoorNodeId(coords[i]);
      graph.addEdge(from, to, { kind: f.properties.kind, stepFree: f.properties.stepFree, name: f.properties.name });
      outdoorEdges.push(graph.edgesFrom(from).at(-1)!);
    }
  }

  const floorsByBuilding = new Map<string, Floor[]>();
  for (const data of indoor) {
    floorsByBuilding.set(data.buildingId, data.floors);
    const floorAt = new Map(data.floors.map((fl) => [fl.level, fl.id]));
    for (const n of data.nodes) {
      graph.addNode({
        id: n.id, lat: n.lat, lng: n.lng, kind: n.kind, name: n.name,
        buildingId: data.buildingId, level: n.level, floorId: floorAt.get(n.level),
      });
    }
    for (const e of data.edges) {
      graph.addEdge(e.from, e.to, { kind: e.kind, stepFree: e.stepFree, ...(e.kind === 'stairs' || e.kind === 'lift' ? { length: 0 } : {}) });
    }
    // Indoor entrances join the outdoor node at the same spot.
    for (const n of data.nodes.filter((x) => x.kind === 'entrance')) {
      const outdoorId = outdoorNodeId([n.lng, n.lat]);
      if (graph.nodes.has(outdoorId)) graph.addEdge(outdoorId, n.id, { kind: 'link', stepFree: true, length: 0 });
    }
  }

  return { graph, outdoorEdges, floorsByBuilding };
}
