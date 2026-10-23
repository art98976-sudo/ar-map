/**
 * Pure conversions from MazeMap API responses to this app's types.
 * Field names follow MazeMap's public docs and examples; several alternatives are read because
 * the exact payloads must be confirmed against the live API once the University grants access.
 */
import { ACCESSIBLE_SPEED_MPS, WALKING_SPEED_MPS } from '../../route/constants';
import { classifyTurn, haversine } from '../../routing/geometry';
import { LIFT_SECONDS, STAIRS_SECONDS_PER_LEVEL } from '../../routing/steps';
import { polygonCentroid } from '../../geo/geo';
import {
  ROUTE_SCHEMA_VERSION,
  type Building,
  type Destination,
  type DestinationKind,
  type FilterCategory,
  type Floor,
  type LatLng,
  type Route,
  type RouteEnd,
  type RoutePoint,
  type RouteStep,
  type TurnDirection,
} from '../../types';
import type { MazemapInstructionStep } from './sdk';

type Props = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const first = <T>(...vals: (T | undefined)[]) => vals.find((v) => v !== undefined);

/** Ids used inside this app for MazeMap objects (they must match the share-link id pattern). */
export const mazemapPoiId = (poiId: number) => `mmpoi:${poiId}`;
export const mazemapBuildingId = (id: number) => `mmbuilding:${id}`;
export const parseMazemapPoiId = (id: string) => (/^mmpoi:(\d+)$/.exec(id)?.[1] ? Number(/^mmpoi:(\d+)$/.exec(id)![1]) : undefined);

/** A single point for any GeoJSON geometry (POIs can be points or room polygons). */
export function geometryPoint(g: GeoJSON.Geometry | null | undefined): LatLng | undefined {
  if (!g) return undefined;
  if (g.type === 'Point') return { lng: g.coordinates[0], lat: g.coordinates[1] };
  if (g.type === 'Polygon') return polygonCentroid(g);
  if (g.type === 'MultiPolygon') return polygonCentroid({ type: 'Polygon', coordinates: g.coordinates[0] });
  return undefined;
}

const CATEGORY_WORDS: [FilterCategory, RegExp][] = [
  ['food', /caf[eé]|coffee|restaurant|canteen|food|bar\b|kitchen|dining/i],
  ['study', /stud(y|ie)|library|reading|computer lab|learning/i],
  ['teaching', /lecture|seminar|classroom|teaching|auditor|tutorial|lab\b/i],
  ['sports', /sport|gym|pool|pitch|court|fitness|swim/i],
  ['accommodation', /accommodation|residence|halls?\b|housing|flat/i],
  ['transport', /bus|park(ing)?\b|car park|bike|bicycle|taxi|station/i],
];

export function categoriesFromText(text: string): FilterCategory[] {
  return CATEGORY_WORDS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

function kindFor(categories: FilterCategory[], text: string): DestinationKind {
  if (/bus/i.test(text)) return 'bus-stop';
  if (/park/i.test(text) && categories.includes('transport')) return 'car-park';
  if (categories.includes('food')) return 'cafe';
  if (categories.includes('study') && !categories.includes('teaching')) return 'study-space';
  if (categories.includes('sports')) return 'sports';
  return 'room';
}

/** Search result or Data API POI → Destination. Returns undefined when it has no id or position. */
export function poiToDestination(f: GeoJSON.Feature, floorNames?: Map<string, string>): Destination | undefined {
  const p = (f.properties ?? {}) as Props;
  const poiId = num(first(p.poiId, p.id, f.id));
  const location = geometryPoint(f.geometry);
  if (poiId === undefined || !location) return undefined;

  const name = str(first(p.title, Array.isArray(p.dispPoiNames) ? p.dispPoiNames[0] : undefined, p.identifier, p.name)) ?? `Room ${poiId}`;
  const buildingName = str(first(p.buildingName, Array.isArray(p.dispBldNames) ? p.dispBldNames[0] : undefined));
  const buildingNum = num(p.buildingId);
  const z = num(first(p.zLevel, p.zValue, p.z));
  const typeText = [
    ...(Array.isArray(p.types) ? p.types.map((t) => (t && typeof t === 'object' ? str((t as Props).name) : str(t))) : []),
    str(p.type), str(p.typeName), name,
  ].filter(Boolean).join(' ');
  const categories = categoriesFromText(typeText);
  const floorName = str(first(p.floorName, p.zName)) ?? (buildingNum !== undefined && z !== undefined ? floorNames?.get(`${buildingNum}:${z}`) : undefined);
  const isBuilding = str(p.kind) === 'building' || p.poiType === 'building';

  return {
    id: isBuilding && buildingNum !== undefined ? mazemapBuildingId(buildingNum) : mazemapPoiId(poiId),
    name,
    kind: isBuilding ? 'building' : kindFor(categories, typeText),
    categories,
    location,
    ...(buildingNum !== undefined ? { buildingId: mazemapBuildingId(buildingNum) } : {}),
    ...(buildingName ? { buildingName } : {}),
    ...(!isBuilding && z !== undefined ? { level: z } : {}),
    ...(floorName ? { floorName } : {}),
    ...(str(p.description) ? { description: str(p.description) } : {}),
  };
}

/** Data API building → Building. */
export function toBuilding(raw: unknown): Building | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Props;
  const id = num(b.id);
  const geom = (b.geometry ?? (b as { geojson?: unknown }).geojson) as GeoJSON.Geometry | undefined;
  const polygon: GeoJSON.Polygon | undefined =
    geom?.type === 'Polygon' ? geom : geom?.type === 'MultiPolygon' ? { type: 'Polygon', coordinates: geom.coordinates[0] } : undefined;
  if (id === undefined || !polygon) return undefined;
  const name = str(first(b.name, b.title)) ?? `Building ${id}`;
  return {
    id: mazemapBuildingId(id),
    name,
    shortName: str(b.shortName),
    categories: categoriesFromText(name),
    centroid: polygonCentroid(polygon),
    footprint: polygon,
    entrances: [],
    hasIndoorData: true,
  };
}

/** Data API floor → Floor (MazeMap's z value is used as the level). */
export function toFloor(raw: unknown): Floor | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Props;
  const id = num(f.id);
  const buildingId = num(f.buildingId);
  const z = num(first(f.z, f.zLevel, f.zValue));
  if (id === undefined || buildingId === undefined || z === undefined) return undefined;
  return { id: `mmfloor:${id}`, buildingId: mazemapBuildingId(buildingId), level: z, name: str(first(f.name, f.shortName)) ?? `Floor ${z}` };
}

function turnFromText(text: string): TurnDirection | undefined {
  const t = text.toLowerCase();
  if (/u-?turn|turn around/.test(t)) return 'u-turn';
  const side = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : undefined;
  if (!side) return undefined;
  if (/slight|bear|keep/.test(t)) return `slight-${side}`;
  if (/sharp/.test(t)) return `sharp-${side}`;
  return classifyTurn(side === 'left' ? -90 : 90);
}

/**
 * MazeMap trip instruction steps → our route steps. Floor changes are taken from z-level changes
 * and the instruction text (elevator/lift vs stairs).
 */
export function tripToRoute(
  steps: MazemapInstructionStep[],
  ctx: { from: RouteEnd; to: RouteEnd; accessible: boolean; id: string; now: Date; floorName?(buildingName: string | undefined, z: number): string | undefined },
): Route {
  const speed = ctx.accessible ? ACCESSIBLE_SPEED_MPS : WALKING_SPEED_MPS;
  const buildingKey = (name?: string | null) => (name ? `mmname:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'building'}` : undefined);
  const point = (lngLat: GeoJSON.Position, s: MazemapInstructionStep): RoutePoint => {
    const b = buildingKey(s.buildingName);
    return b && s.zLevel != null ? { lng: lngLat[0], lat: lngLat[1], buildingId: b, level: s.zLevel } : { lng: lngLat[0], lat: lngLat[1] };
  };

  const out: RouteStep[] = [];
  let lastPoint: RoutePoint = ctx.from.point;
  steps.forEach((s, i) => {
    const coords = s.geometry?.coordinates ?? [];
    const path = coords.length ? coords.map((c) => point(c, s)) : [lastPoint];
    const text = s.instruction || 'Continue';
    const prevZ = i > 0 ? steps[i - 1].zLevel : undefined;
    const nextZ = steps[i + 1]?.zLevel;
    let type: RouteStep['type'] = 'walk';
    let extra: Partial<RouteStep> = {};

    if (/elevator|lift|stair/i.test(text) && prevZ != null && nextZ != null && prevZ !== nextZ) {
      type = 'change-floor';
      const via = /stair/i.test(text) ? 'stairs' : 'lift';
      const toFloorName = ctx.floorName?.(s.buildingName ?? undefined, nextZ);
      extra = { floorChange: { via, fromLevel: prevZ, toLevel: nextZ, ...(toFloorName ? { toFloorName } : {}) } };
      const p = path[0];
      path.splice(0, path.length, p, { ...p, level: nextZ, buildingId: p.buildingId ?? buildingKey(s.buildingName) ?? 'mmname:building' });
    } else if (/arriv|destination|reached/i.test(text) && i === steps.length - 1) {
      type = 'arrive';
    } else if (/\benter\b/i.test(text) && s.buildingName) {
      type = 'enter-building';
      extra = { buildingId: buildingKey(s.buildingName) };
    } else if (/\b(exit|leave)\b/i.test(text) && (s.buildingName || steps[i - 1]?.buildingName)) {
      type = 'exit-building';
      extra = { buildingId: buildingKey(s.buildingName ?? steps[i - 1]?.buildingName) };
    } else {
      const turn = turnFromText(text);
      if (turn && turn !== 'straight') {
        type = 'turn';
        extra = { turn };
      }
    }

    const distance = type === 'change-floor' ? 0 : Math.round(path.slice(1).reduce((d, p, k) => d + haversine(path[k], p), 0) * 10) / 10;
    const duration =
      type === 'change-floor'
        ? extra.floorChange!.via === 'lift' ? LIFT_SECONDS : STAIRS_SECONDS_PER_LEVEL * Math.max(1, Math.abs(extra.floorChange!.toLevel - extra.floorChange!.fromLevel))
        : Math.round(distance / speed);
    out.push({ index: out.length, type, instruction: text, location: path[0], path, distanceMetres: distance, durationSeconds: duration, ...extra } as RouteStep);
    lastPoint = path.at(-1)!;
  });

  if (out.at(-1)?.type !== 'arrive') {
    out.push({ index: out.length, type: 'arrive', instruction: `You have arrived at ${ctx.to.name}`, location: lastPoint, path: [lastPoint], distanceMetres: 0, durationSeconds: 0 });
  }

  return {
    schemaVersion: ROUTE_SCHEMA_VERSION,
    id: ctx.id,
    provider: 'mazemap',
    isSampleData: false,
    generatedAt: ctx.now.toISOString(),
    accessible: ctx.accessible,
    from: { ...ctx.from, point: out[0].location },
    to: { ...ctx.to, point: lastPoint },
    distanceMetres: Math.round(out.reduce((s, x) => s + x.distanceMetres, 0) * 10) / 10,
    durationSeconds: out.reduce((s, x) => s + x.durationSeconds, 0),
    steps: out,
  };
}
