/**
 * Pure conversions from MazeMap's web-service responses to this app's types.
 * Shapes checked against MazeMap's live responses for the University of Stirling (campus 2058).
 */
import { polygonCentroid } from '../../geo/geo';
import { ACCESSIBLE_SPEED_MPS, WALKING_SPEED_MPS } from '../../route/constants';
import { haversine } from '../../routing/geometry';
import { LIFT_SECONDS, STAIRS_SECONDS_PER_LEVEL } from '../../routing/steps';
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
import type { MazemapBuildingRaw, MazemapDirections, MazemapPath, MazemapPoi, MazemapSearchResult } from './client';

/** Ids used inside this app for MazeMap objects (they match the share-link id pattern). */
const mazemapPoiId = (poiId: number) => `mmpoi:${poiId}`;
const mazemapBuildingId = (id: number) => `mmbuilding:${id}`;
const mazemapFloorId = (id: number) => `mmfloor:${id}`;
const idNumber = (prefix: string, id: string) => {
  const m = new RegExp(`^${prefix}:(\\d+)$`).exec(id);
  return m ? Number(m[1]) : undefined;
};
export const parseMazemapPoiId = (id: string) => idNumber('mmpoi', id);
export const parseMazemapBuildingId = (id: string) => idNumber('mmbuilding', id);

/** Removes search highlighting and stray markup: "<em>Cafe</em> Bar" -> "Cafe Bar". */
export const stripTags = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** "2" -> "Floor 2"; names that are already words stay as they are. */
export const floorLabel = (name: string | null | undefined, z?: number | null) => {
  const n = stripTags(name);
  if (n) return /^-?\d+$/.test(n) ? `Floor ${n}` : n;
  return z !== null && z !== undefined ? `Floor ${z}` : undefined;
};

/** A single point for any geometry (POIs can be points or room polygons). */
function geometryPoint(g: GeoJSON.Geometry | null | undefined): LatLng | undefined {
  if (!g) return undefined;
  if (g.type === 'Point') return { lng: g.coordinates[0], lat: g.coordinates[1] };
  if (g.type === 'Polygon') return polygonCentroid(g);
  if (g.type === 'MultiPolygon') return polygonCentroid({ type: 'Polygon', coordinates: g.coordinates[0] });
  return undefined;
}

const CATEGORY_WORDS: [FilterCategory, RegExp][] = [
  ['food', /caf[eé]|coffee|restaurant|canteen|food|\bbar\b|dining|kitchen|eat/i],
  ['study', /stud(y|ie)|library|learning space|reading|computer lab|pc lab/i],
  ['teaching', /lecture|seminar|classroom|teaching|auditor|tutorial|\blab\b|laboratory/i],
  ['sports', /sport|gym|pool|pitch|court|fitness|swim|tennis/i],
  ['accommodation', /accommodation|residence|halls?\b|housing|flats?\b/i],
  ['transport', /\bbus\b|parking|car park|bike|bicycle|cycle|taxi|station/i],
];

export function categoriesFromText(text: string): FilterCategory[] {
  return CATEGORY_WORDS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

/** Words to search MazeMap with when someone only picks a filter chip. */
export const CATEGORY_SEARCH_WORDS: Record<FilterCategory, string[]> = {
  teaching: ['lecture', 'seminar'],
  food: ['cafe', 'restaurant'],
  study: ['study', 'learning'],
  sports: ['sport', 'gym'],
  accommodation: ['accommodation', 'residence'],
  transport: ['bus', 'parking'],
};

function kindFor(categories: FilterCategory[], text: string): DestinationKind {
  if (/\bbus\b/i.test(text)) return 'bus-stop';
  if (/parking|car park/i.test(text)) return 'car-park';
  if (categories.includes('food')) return 'cafe';
  if (categories.includes('study') && !categories.includes('teaching')) return 'study-space';
  if (categories.includes('sports')) return 'sports';
  return 'room';
}

const isHidden = (types: string[]) => types.some((t) => /hidden/i.test(t));

/** A search hit -> Destination. Hidden or nameless places are skipped. */
export function searchResultToDestination(r: MazemapSearchResult): Destination | undefined {
  const name = stripTags(r.title);
  const types = (r.dispTypeNames ?? r.typeNames ?? []).map(stripTags).filter(Boolean);
  const location = geometryPoint(r.point ?? r.geometry);
  if (!r.poiId || !location || !name || /^null$/i.test(name) || isHidden(types)) return undefined;

  const isBuilding = String((r as { solrId?: string }).solrId ?? '').startsWith('bld');
  const buildingNum = r.buildingId ?? r.bldId ?? undefined;
  const buildingName = stripTags(r.dispBldNames?.[0]) || undefined;
  const text = [name, ...types].join(' ');
  const categories = categoriesFromText(text);
  const level = r.zValue ?? undefined;
  const aliases = [...new Set([...(r.poiNames ?? []).map(stripTags), stripTags(r.identifier)])].filter((a) => a && a !== name);

  if (isBuilding && buildingNum) {
    return {
      id: mazemapBuildingId(buildingNum),
      name,
      kind: 'building',
      categories,
      location,
      buildingId: mazemapBuildingId(buildingNum),
      buildingName: name,
      aliases,
    };
  }
  return {
    id: mazemapPoiId(r.poiId),
    name,
    kind: kindFor(categories, text),
    categories,
    location,
    ...(buildingNum ? { buildingId: mazemapBuildingId(buildingNum) } : {}),
    ...(buildingName ? { buildingName } : {}),
    ...(buildingNum && level !== undefined ? { level, floorName: floorLabel(r.zName, level) } : {}),
    ...(types.length ? { description: types.join(', ') } : {}),
    ...(aliases.length ? { aliases } : {}),
  };
}

/** A single POI from the data service -> Destination. */
export function poiToDestination(p: MazemapPoi): Destination | undefined {
  const name = stripTags(p.title) || stripTags(p.infos?.[0]?.name);
  const location = geometryPoint(p.point ?? p.geometry);
  if (!p.poiId || !name || !location) return undefined;
  const types = (p.types ?? []).map((t) => stripTags(t.name)).filter(Boolean);
  const text = [name, ...types].join(' ');
  const categories = categoriesFromText(text);
  const level = p.z ?? undefined;
  return {
    id: mazemapPoiId(p.poiId),
    name,
    kind: kindFor(categories, text),
    categories,
    location,
    ...(p.buildingId ? { buildingId: mazemapBuildingId(p.buildingId) } : {}),
    ...(p.buildingName ? { buildingName: stripTags(p.buildingName) } : {}),
    ...(p.buildingId && level !== undefined ? { level, floorName: floorLabel(p.floorName, level) } : {}),
    ...(types.length && !isHidden(types) ? { description: types.join(', ') } : {}),
  };
}

function outlineOf(b: MazemapBuildingRaw): GeoJSON.Polygon | undefined {
  for (const g of [b.fullOutline, b.visibleOutline, b.simpleGeom]) {
    if (g?.type === 'Polygon') return g;
    if (g?.type === 'MultiPolygon') return { type: 'Polygon', coordinates: g.coordinates[0] };
  }
  // Fall back to the outline of its lowest floor.
  const floor = [...(b.floors ?? [])].sort((a, c) => a.z - c.z)[0] as { outline?: GeoJSON.Geometry } | undefined;
  return floor?.outline?.type === 'Polygon' ? floor.outline : undefined;
}

export function toBuilding(b: MazemapBuildingRaw): Building | undefined {
  const footprint = outlineOf(b);
  const name = stripTags(b.name);
  if (!b.id || !footprint || !name) return undefined;
  return {
    id: mazemapBuildingId(b.id),
    name,
    categories: categoriesFromText(name),
    centroid: polygonCentroid(footprint),
    footprint,
    entrances: [],
    hasIndoorData: (b.floors ?? []).length > 0,
  };
}

export function toFloors(b: MazemapBuildingRaw): Floor[] {
  return (b.floors ?? [])
    .map((f) => ({ id: mazemapFloorId(f.id), buildingId: mazemapBuildingId(b.id), level: f.z, name: floorLabel(f.name, f.z)! }))
    .sort((a, c) => a.level - c.level);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Tidies MazeMap's wording: spacing, "elevator" -> "lift", UK "metres". */
export function tidyInstruction(s: string): string {
  return stripTags(s)
    // "You are starting inside the room Library. Face south and follow the directions ..." -> "Start in Library, facing south"
    .replace(/^You are starting inside the room (.+?)\. Face (\w+) and follow the directions[^.]*\.?/i, 'Start in $1, facing $2')
    .replace(/^You are starting your route guidance\. Face (\w+) and follow the directions[^.]*\.?/i, 'Start facing $1')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\ban elevator\b/gi, 'a lift')
    .replace(/\belevator\b/gi, 'lift')
    .replace(/\bmeters\b/g, 'metres')
    .replace(/\bmeter\b/g, 'metre')
    .replace(/(\w+) building building/gi, '$1 building')
    .trim();
}

function turnFromText(text: string): TurnDirection | undefined {
  const t = text.toLowerCase().split(/ and then /)[0];
  if (/turn around|u-turn/.test(t)) return 'u-turn';
  const side = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : undefined;
  if (!side) return undefined;
  if (/slight|bear/.test(t)) return `slight-${side}`;
  if (/sharp/.test(t)) return `sharp-${side}`;
  return side;
}

interface PointInfo {
  z: number | null;
  buildingId: number | null;
}

const key = (c: GeoJSON.Position) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;

export interface RouteContext {
  from: RouteEnd;
  to: RouteEnd;
  accessible: boolean;
  id: string;
  now: Date;
  /** Floor name for a building and z-level, e.g. "Floor 2". */
  floorName?(buildingId: number | null, z: number): string | undefined;
}

/**
 * MazeMap path + written directions -> our route. Each path coordinate carries its floor (z) and
 * building, which is attached to the matching direction steps so indoor points have building and level.
 */
export function mazemapRouteToRoute(path: MazemapPath, directions: MazemapDirections | null, ctx: RouteContext): Route {
  const feats = path.path?.features ?? [];
  const coords: { c: GeoJSON.Position; info: PointInfo }[] = [];
  const lookup = new Map<string, PointInfo>();
  for (const f of feats) {
    const info = { z: f.properties?.z ?? null, buildingId: f.properties?.buildingId ?? null };
    for (const c of f.geometry?.coordinates ?? []) {
      coords.push({ c, info });
      if (!lookup.has(key(c))) lookup.set(key(c), info);
    }
  }
  if (!coords.length) throw new Error('MazeMap returned an empty route.');

  const infoAt = (c: GeoJSON.Position): PointInfo => {
    const hit = lookup.get(key(c));
    if (hit) return hit;
    let best = coords[0];
    let bestD = Infinity;
    for (const x of coords) {
      const d = haversine({ lng: c[0], lat: c[1] }, { lng: x.c[0], lat: x.c[1] });
      if (d < bestD) {
        bestD = d;
        best = x;
      }
    }
    return best.info;
  };
  // Match each step's coordinates in order along the path, so a spot visited twice
  // (e.g. the same lift shaft on two floors) resolves to the right floor each time.
  let seq = 0;
  const stepPoints = (geo: GeoJSON.Position[]): RoutePoint[] => {
    let from = seq;
    return geo.map((c, j) => {
      const k = key(c);
      for (let i = j === 0 ? from : from + 1; i < coords.length; i++) {
        if (key(coords[i].c) === k) {
          from = i;
          seq = i;
          return toPoint(c, coords[i].info);
        }
      }
      return toPoint(c);
    });
  };
  const toPoint = (c: GeoJSON.Position, info = infoAt(c)): RoutePoint =>
    info.buildingId != null && info.z != null
      ? { lng: c[0], lat: c[1], buildingId: mazemapBuildingId(info.buildingId), level: info.z }
      : { lng: c[0], lat: c[1] };

  const speed = ctx.accessible ? ACCESSIBLE_SPEED_MPS : WALKING_SPEED_MPS;
  const dirSteps = directions?.routes?.[0]?.legs?.[0]?.steps ?? [];
  const firstPoint = toPoint(coords[0].c, coords[0].info);
  const lastPoint = toPoint(coords.at(-1)!.c, coords.at(-1)!.info);
  const steps: RouteStep[] = [];
  let cursor = firstPoint;

  const push = (s: Omit<RouteStep, 'index' | 'distanceMetres' | 'durationSeconds'>, fixedSeconds?: number) => {
    const distance = s.type === 'change-floor' ? 0 : Math.round(s.path.slice(1).reduce((d, p, i) => d + haversine(s.path[i], p), 0) * 10) / 10;
    steps.push({ index: steps.length, ...s, distanceMetres: distance, durationSeconds: fixedSeconds ?? Math.round(distance / speed) } as RouteStep);
    cursor = s.path.at(-1)!;
  };

  if (dirSteps.length) {
    dirSteps.forEach((d, i) => {
      const text = tidyInstruction(d.instruction ?? '');
      const geo = d.geometry?.coordinates ?? [];
      const path = geo.length ? stepPoints(geo) : [cursor];
      const isLast = i === dirSteps.length - 1;

      if (isLast && /reached|destination/i.test(text)) return; // added as "arrive" below
      if (/^take the (stair|staircase|stairs|lift|escalator)/i.test(text)) {
        const from = path[0];
        const to = path.at(-1)!;
        const fromLevel = from.level ?? cursor.level;
        const toLevel = to.level;
        const buildingId = to.buildingId ?? from.buildingId ?? cursor.buildingId;
        if (buildingId && fromLevel !== undefined && toLevel !== undefined && fromLevel !== toLevel) {
          const via = /lift/i.test(text) ? 'lift' : 'stairs';
          const b = parseMazemapBuildingId(to.buildingId ?? '') ?? null;
          const toFloorName = ctx.floorName?.(b, toLevel) ?? `Floor ${toLevel}`;
          const start: RoutePoint = { lat: from.lat, lng: from.lng, buildingId, level: fromLevel };
          push(
            {
              type: 'change-floor',
              instruction: text,
              location: start,
              path: [start, { ...to, buildingId }],
              floorChange: { via, fromLevel, toLevel, toFloorName },
            },
            via === 'lift' ? LIFT_SECONDS : STAIRS_SECONDS_PER_LEVEL * Math.max(1, Math.abs(toLevel - fromLevel)),
          );
          return;
        }
      }
      if (/^entering /i.test(text) && path.at(-1)!.buildingId) {
        push({ type: 'enter-building', instruction: text, location: path[0], path, buildingId: path.at(-1)!.buildingId });
        return;
      }
      if (/^(exiting|leaving|exit) (the )?.*building/i.test(text) && (path[0].buildingId ?? cursor.buildingId)) {
        push({ type: 'exit-building', instruction: text, location: path[0], path, buildingId: path[0].buildingId ?? cursor.buildingId });
        return;
      }
      const turn = i > 0 ? turnFromText(text) : undefined;
      if (turn) {
        push({ type: 'turn', turn, instruction: text, location: path[0], path });
        return;
      }
      push({ type: 'walk', instruction: text, location: path[0], path });
    });
  } else {
    // No written directions: one walk step per floor/building stretch.
    let run: RoutePoint[] = [firstPoint];
    coords.slice(1).forEach(({ c, info }) => {
      const p = toPoint(c, info);
      const prev = run.at(-1)!;
      if (p.level !== prev.level && p.level !== undefined && prev.level !== undefined && p.buildingId && prev.buildingId) {
        if (run.length > 1) push({ type: 'walk', instruction: steps.length ? 'Continue' : 'Start walking', location: run[0], path: run });
        const b = parseMazemapBuildingId(p.buildingId ?? '') ?? null;
        push(
          { type: 'change-floor', instruction: `Change floor to ${ctx.floorName?.(b, p.level) ?? `Floor ${p.level}`}`, location: prev, path: [prev, p], floorChange: { via: ctx.accessible ? 'lift' : 'stairs', fromLevel: prev.level, toLevel: p.level } },
          ctx.accessible ? LIFT_SECONDS : STAIRS_SECONDS_PER_LEVEL,
        );
        run = [p];
      } else run.push(p);
    });
    if (run.length > 1) push({ type: 'walk', instruction: steps.length ? 'Continue' : 'Start walking', location: run[0], path: run });
  }

  const floorSuffix = lastPoint.level !== undefined ? `, ${ctx.floorName?.(parseMazemapBuildingId(lastPoint.buildingId ?? '') ?? null, lastPoint.level) ?? `Floor ${lastPoint.level}`}` : '';
  push({ type: 'arrive', instruction: `You have arrived at ${ctx.to.name}${floorSuffix}`, location: lastPoint, path: [lastPoint] });

  return {
    schemaVersion: ROUTE_SCHEMA_VERSION,
    id: ctx.id,
    provider: 'mazemap',
    isSampleData: false,
    generatedAt: ctx.now.toISOString(),
    accessible: ctx.accessible,
    from: { ...ctx.from, point: steps[0].location },
    to: { ...ctx.to, point: lastPoint },
    distanceMetres: Math.round(steps.reduce((s, x) => s + x.distanceMetres, 0) * 10) / 10,
    durationSeconds: steps.reduce((s, x) => s + x.durationSeconds, 0),
    steps,
  };
}

/** The routable POI of a building hit in search (MazeMap routes to it), if any. */
export function buildingPoiFromSearch(r: MazemapSearchResult): [string, number] | undefined {
  const isBuilding = String((r as { solrId?: string }).solrId ?? '').startsWith('bld');
  const b = r.buildingId ?? r.bldId;
  return isBuilding && b && r.poiId ? [mazemapBuildingId(b), r.poiId] : undefined;
}
