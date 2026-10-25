import type { LatLng } from '../types';
import { haversine } from './geometry';
import type { GraphEdge, WalkGraph } from './graph';

/** Extra cost, in metre-equivalents, for each floor climbed. Keeps short stair hops from looking free. */
const STAIRS_COST_PER_LEVEL = 15;
/** Waiting for a lift is slow, so a lift costs more than stairs for one floor. */
const LIFT_COST = 30;
/** Outdoor steps are a little slower than flat paths. */
const STEPS_COST_FACTOR = 1.2;

interface SearchOptions {
  accessible: boolean;
  /** Real positions the goal stands for (e.g. every entrance of a building). Keeps the heuristic admissible. */
  goalPoints?: LatLng[];
}

interface PathResult {
  nodeIds: string[];
  edges: GraphEdge[];
  cost: number;
}

function edgeCost(e: GraphEdge, graph: WalkGraph): number {
  if (e.kind === 'stairs' || e.kind === 'lift') {
    const a = graph.nodes.get(e.from)!.level ?? 0;
    const b = graph.nodes.get(e.to)!.level ?? 0;
    const levels = Math.max(1, Math.abs(a - b));
    return e.kind === 'stairs' ? STAIRS_COST_PER_LEVEL * levels : LIFT_COST;
  }
  return e.kind === 'steps' ? e.length * STEPS_COST_FACTOR : e.length;
}

/** Minimal binary heap keyed by f-score. */
class MinHeap {
  private items: { id: string; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: string, f: number) {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { id: string; f: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* from start to goal. The heuristic is straight-line distance to the goal's position,
 * which never overestimates because every edge costs at least its length.
 * Returns null when the goal cannot be reached (e.g. only stairs lead there and accessible is on).
 */
export function aStar(graph: WalkGraph, start: string, goal: string, options: SearchOptions): PathResult | null {
  const goalNode = graph.nodes.get(goal);
  if (!goalNode || !graph.nodes.has(start)) return null;
  const targets = options.goalPoints?.length ? options.goalPoints : [goalNode];
  const h = (id: string) => {
    const n = graph.nodes.get(id) as LatLng;
    return Math.min(...targets.map((t) => haversine(n, t)));
  };

  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, GraphEdge>();
  const closed = new Set<string>();
  const open = new MinHeap();
  open.push(start, h(start));

  while (open.size) {
    const { id } = open.pop();
    if (id === goal) break;
    if (closed.has(id)) continue;
    closed.add(id);
    const base = g.get(id)!;
    for (const e of graph.edgesFrom(id)) {
      if (options.accessible && !e.stepFree) continue;
      if (closed.has(e.to)) continue;
      const cost = base + edgeCost(e, graph);
      if (cost < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, cost);
        came.set(e.to, e);
        open.push(e.to, cost + h(e.to));
      }
    }
  }

  if (!g.has(goal)) return null;
  const edges: GraphEdge[] = [];
  for (let at = goal; at !== start; ) {
    const e = came.get(at)!;
    edges.push(e);
    at = e.from;
  }
  edges.reverse();
  return { nodeIds: [start, ...edges.map((e) => e.to)], edges, cost: g.get(goal)! };
}
