'use client';

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { MapOverlay } from '@/lib/providers';
import type { Destination, IndoorMap, LatLng, Route } from '@/lib/types';
import { CAMPUS_CENTER, PALETTES, baseMapStyle, fallbackRasterStyle, type MapPalette } from './mapStyle';

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface IndoorViewState {
  buildingId: string;
  level: number;
}

export interface MapViewHandle {
  flyTo(point: LatLng, zoom?: number): void;
  fitPoints(points: LatLng[]): void;
}

export interface MapViewProps {
  ref?: Ref<MapViewHandle>;
  overlay: MapOverlay | null;
  indoorMap: IndoorMap | null;
  indoorView: IndoorViewState | null;
  selected: Destination | null;
  /** When set, other places are dimmed (e.g. filter results). */
  highlightIds: string[] | null;
  route: Route | null;
  activeStep: number | null;
  user: { position: LatLng; accuracy?: number } | null;
  dark: boolean;
  /** Space covered by floating panels, so the camera centres in the visible part. */
  padding: Padding;
  onSelect(destinationId: string): void;
  onStatus(status: 'ready' | 'error', message?: string): void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const OUTDOOR = -999;

type Latest = Omit<MapViewProps, 'ref' | 'onSelect' | 'onStatus'>;

export default function MapView(props: MapViewProps) {
  const { ref, onSelect, onStatus, ...data } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef<Latest>(data);
  const callbacks = useRef({ onSelect, onStatus });
  const [styleVersion, setStyleVersion] = useState(0);

  useEffect(() => {
    latest.current = data;
    callbacks.current = { onSelect, onStatus };
  });

  // Camera moves asked for before the map exists (e.g. opening a shared link) wait here.
  const pendingCamera = useRef<((map: MapLibreMap) => void) | null>(null);
  const camera = (move: (map: MapLibreMap) => void) => {
    if (mapRef.current) move(mapRef.current);
    else pendingCamera.current = move;
  };

  useImperativeHandle(ref, () => ({
    flyTo(point, zoom = 18) {
      camera((map) => map.flyTo({ center: [point.lng, point.lat], zoom, padding: latest.current.padding, duration: reducedMotion() ? 0 : 700 }));
    },
    fitPoints(points) {
      if (!points.length) return;
      camera((map) => map.fitBounds(boundsOf(points), { padding: addPadding(latest.current.padding, 30), maxZoom: 18, duration: reducedMotion() ? 0 : 700 }));
    },
  }));

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !container.current) return;
      // MapLibre 6 needs its worker served as a separate file (copied to public/vendor on install).
      maplibre.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');
      const dark = latest.current.dark;
      map = new maplibre.Map({
        container: container.current,
        style: baseMapStyle(dark),
        center: CAMPUS_CENTER,
        zoom: 15.6,
        minZoom: 13,
        maxZoom: 21,
        attributionControl: { compact: true },
        maxBounds: [[-3.97, 56.12], [-3.87, 56.17]],
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');

      let styleLoaded = false;
      map.on('style.load', () => {
        styleLoaded = true;
        setStyleVersion((v) => v + 1);
      });
      map.on('error', (e) => {
        // If the vector base map cannot load, fall back to plain raster tiles once.
        if (!styleLoaded && map) {
          styleLoaded = true;
          console.warn('Base map style failed, using raster fallback', e.error);
          map.setStyle(fallbackRasterStyle(latest.current.dark));
          return;
        }
        console.warn('Map error:', e.error?.message ?? e.error);
      });
      map.once('load', () => {
        callbacks.current.onStatus('ready');
        if (map && pendingCamera.current) {
          pendingCamera.current(map);
          pendingCamera.current = null;
        }
      });

      map.on('click', (e) => {
        if (!map) return;
        const layers = ['scm-indoor-rooms', 'scm-places', 'scm-places-inside', 'scm-buildings-fill'].filter((id) => map!.getLayer(id));
        const hit = map.queryRenderedFeatures(e.point, { layers }).find((f) => f.properties?.destId);
        if (hit) callbacks.current.onSelect(String(hit.properties.destId));
      });
      for (const id of ['scm-indoor-rooms', 'scm-places', 'scm-places-inside', 'scm-buildings-fill']) {
        map.on('mouseenter', id, () => map && (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => map && (map.getCanvas().style.cursor = ''));
      }
    })().catch((err) => callbacks.current.onStatus('error', err instanceof Error ? err.message : String(err)));

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch base map with the colour scheme.
  const dark = data.dark;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    map.setStyle(baseMapStyle(dark));
    // Re-adding our layers happens on the next 'style.load'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // (Re)build our layers whenever a style finishes loading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    addLayers(map, PALETTES[latest.current.dark ? 'dark' : 'light']);
  }, [styleVersion]);

  // Push data into sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || !map.getSource('scm-buildings')) return;
    updateData(map, data);
  });

  return (
    <div className="absolute inset-0">
      {/* MapLibre styles its own element as position:relative, so it sits inside a positioned wrapper. */}
      <div ref={container} className="h-full w-full" role="region" aria-label="Campus map" />
    </div>
  );
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function addPadding(p: Padding, extra: number): Padding {
  return { top: p.top + extra, bottom: p.bottom + extra, left: p.left + extra, right: p.right + extra };
}

function boundsOf(points: LatLng[]): LngLatBoundsLike {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [[w, s], [e, n]];
}

const SOURCES = [
  'scm-areas', 'scm-paths', 'scm-buildings', 'scm-entrances', 'scm-places',
  'scm-indoor', 'scm-route', 'scm-route-ends', 'scm-selected', 'scm-user',
] as const;

function addLayers(map: MapLibreMap, c: MapPalette) {
  for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const hasGlyphs = Boolean(map.getStyle().glyphs);
  const add: MapLibreMap['addLayer'] = (layer) => (map.getLayer(layer.id) ? map : map.addLayer(layer));

  add({ id: 'scm-areas-water', type: 'fill', source: 'scm-areas', filter: ['==', ['get', 'kind'], 'water'], paint: { 'fill-color': c.water, 'fill-opacity': 0.35 } });
  add({ id: 'scm-areas-green', type: 'fill', source: 'scm-areas', filter: ['==', ['get', 'kind'], 'green'], paint: { 'fill-color': c.green, 'fill-opacity': 0.35 } });

  add({ id: 'scm-paths-casing', type: 'line', source: 'scm-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.pathCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 10] } });
  add({
    id: 'scm-paths', type: 'line', source: 'scm-paths', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], 'steps', c.steps, 'ramp', c.ramp, c.path],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 7],
    },
  });

  add({ id: 'scm-buildings-fill', type: 'fill', source: 'scm-buildings', paint: { 'fill-color': ['case', ['get', 'hasIndoorData'], c.buildingIndoor, c.building], 'fill-opacity': 0.8 } });
  add({ id: 'scm-buildings-outline', type: 'line', source: 'scm-buildings', paint: { 'line-color': c.labelHalo, 'line-width': 1.2 } });

  // Indoor floor plan (only the building in indoor view, only its current floor).
  add({ id: 'scm-indoor-corridors', type: 'fill', source: 'scm-indoor', filter: ['==', ['get', 'featureType'], 'corridor'], paint: { 'fill-color': c.corridor, 'fill-opacity': 0.95 } });
  add({
    id: 'scm-indoor-rooms', type: 'fill', source: 'scm-indoor', filter: ['==', ['get', 'featureType'], 'room'],
    paint: { 'fill-color': ['case', ['boolean', ['get', 'selected'], false], c.roomSelected, c.room], 'fill-opacity': 0.95 },
  });
  add({ id: 'scm-indoor-rooms-outline', type: 'line', source: 'scm-indoor', filter: ['==', ['get', 'featureType'], 'room'], paint: { 'line-color': c.roomOutline, 'line-width': 1.5 } });
  add({ id: 'scm-indoor-cores', type: 'fill', source: 'scm-indoor', filter: ['in', ['get', 'featureType'], ['literal', ['stairs', 'lift']]], paint: { 'fill-color': c.core, 'fill-opacity': 1 } });
  add({ id: 'scm-indoor-cores-outline', type: 'line', source: 'scm-indoor', filter: ['in', ['get', 'featureType'], ['literal', ['stairs', 'lift']]], paint: { 'line-color': c.roomOutline, 'line-width': 1, 'line-dasharray': [2, 1] } });
  add({
    id: 'scm-indoor-entrances', type: 'circle', source: 'scm-indoor', filter: ['==', ['get', 'featureType'], 'entrance'],
    paint: { 'circle-radius': 7, 'circle-color': c.entrance, 'circle-stroke-color': c.labelHalo, 'circle-stroke-width': 2 },
  });

  add({ id: 'scm-entrances', type: 'circle', source: 'scm-entrances', minzoom: 16.5, paint: { 'circle-radius': 4.5, 'circle-color': c.entrance, 'circle-stroke-color': c.labelHalo, 'circle-stroke-width': 1.5 } });
  const placePaint: CircleLayerSpecification['paint'] = {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 9],
    'circle-color': ['case', ['in', 'transport', ['get', 'categories']], c.transport, c.place],
    'circle-stroke-color': c.labelHalo,
    'circle-stroke-width': 2,
    'circle-opacity': ['case', ['boolean', ['get', 'dimmed'], false], 0.25, 1],
    'circle-stroke-opacity': ['case', ['boolean', ['get', 'dimmed'], false], 0.25, 1],
  };
  // Places inside buildings only appear when zoomed in, so building labels stay readable.
  add({ id: 'scm-places-inside', type: 'circle', source: 'scm-places', minzoom: 17.5, filter: ['has', 'buildingId'], paint: placePaint });
  add({
    id: 'scm-places', type: 'circle', source: 'scm-places', filter: ['!', ['has', 'buildingId']],
    paint: placePaint,
  });

  // Route
  add({ id: 'scm-route-casing', type: 'line', source: 'scm-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 7, 19, 14], 'line-opacity': ['case', ['boolean', ['get', 'faded'], false], 0.35, 1] } });
  add({ id: 'scm-route', type: 'line', source: 'scm-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 19, 9], 'line-opacity': ['case', ['boolean', ['get', 'faded'], false], 0.3, 1] } });
  add({ id: 'scm-route-active', type: 'line', source: 'scm-route', filter: ['boolean', ['get', 'active'], false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.routeActive, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 12] } });
  add({
    id: 'scm-route-ends', type: 'circle', source: 'scm-route-ends',
    paint: {
      'circle-radius': ['match', ['get', 'role'], 'step', 7, 8],
      'circle-color': ['match', ['get', 'role'], 'start', c.labelHalo, 'step', c.routeActive, c.route],
      'circle-stroke-color': ['match', ['get', 'role'], 'start', c.route, c.labelHalo],
      'circle-stroke-width': 3,
    },
  });

  add({ id: 'scm-selected', type: 'circle', source: 'scm-selected', paint: { 'circle-radius': 11, 'circle-color': c.roomSelected, 'circle-stroke-color': c.buildingLabel, 'circle-stroke-width': 3 } });

  add({ id: 'scm-user-accuracy', type: 'circle', source: 'scm-user', paint: { 'circle-radius': ['get', 'radiusPx'], 'circle-color': c.user, 'circle-opacity': 0.12, 'circle-stroke-color': c.user, 'circle-stroke-opacity': 0.35, 'circle-stroke-width': 1 } });
  add({ id: 'scm-user', type: 'circle', source: 'scm-user', paint: { 'circle-radius': 8, 'circle-color': c.user, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });

  if (hasGlyphs) {
    const halo = { 'text-color': c.buildingLabel, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 };
    add({
      id: 'scm-buildings-label', type: 'symbol', source: 'scm-buildings', minzoom: 15.5,
      layout: { 'text-field': ['coalesce', ['get', 'shortName'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 13, 'text-max-width': 8 },
      paint: halo,
    });
    add({
      id: 'scm-places-label', type: 'symbol', source: 'scm-places', minzoom: 17,
      filter: ['!', ['boolean', ['get', 'dimmed'], false]],
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true },
      paint: halo,
    });
    add({
      id: 'scm-indoor-label', type: 'symbol', source: 'scm-indoor',
      filter: ['in', ['get', 'featureType'], ['literal', ['room', 'stairs', 'lift']]],
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT_REGULAR, 'text-size': 11, 'text-max-width': 7, 'text-allow-overlap': false },
      paint: halo,
    });
  }
}

function updateData(map: MapLibreMap, d: Latest) {
  const set = (id: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  const o = d.overlay;
  const highlight = d.highlightIds ? new Set(d.highlightIds) : null;
  const view = d.indoorView;

  if (o) {
    set('scm-areas', o.areas);
    set('scm-paths', o.paths);
    set('scm-entrances', o.entrances);
    set('scm-buildings', withProps<{ id: string }>(o.buildings, (p) => ({ destId: `building:${p.id}` })));
    set('scm-places', withProps<{ id: string }>(o.places, (p) => {
      const destId = `place:${p.id}`;
      return { destId, dimmed: highlight ? !highlight.has(destId) : false };
    }));
    // The building in indoor view becomes see-through so its floor plan shows.
    if (map.getLayer('scm-buildings-fill')) {
      map.setPaintProperty('scm-buildings-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'id'], view?.buildingId ?? ''], 0.12,
        highlight ? ['case', ['in', ['get', 'destId'], ['literal', [...highlight]]], 0.85, 0.35] : 0.8,
      ] as ExpressionSpecification);
    }
  }

  // Indoor: only the current floor of the building in view.
  if (d.indoorMap && view && d.indoorMap.buildingId === view.buildingId) {
    const features = d.indoorMap.features.features
      .filter((f) => f.properties.level === view.level)
      .map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          label: f.properties.featureType === 'room' ? shortRoomLabel(f.properties.name) : f.properties.featureType === 'lift' ? 'Lift' : f.properties.featureType === 'stairs' ? 'Stairs' : '',
          selected: Boolean(d.selected && f.properties.destinationId === d.selected.id),
          ...(f.properties.destinationId ? { destId: f.properties.destinationId } : {}),
        },
      }));
    set('scm-indoor', { type: 'FeatureCollection', features });
  } else {
    set('scm-indoor', EMPTY);
  }

  // Route, one line per step; steps on other floors are faded while indoors.
  const r = d.route;
  if (r) {
    const features: GeoJSON.Feature[] = [];
    r.steps.forEach((s) => {
      if (s.path.length < 2 || s.type === 'change-floor') return;
      // Split a step's path where the floor changes.
      let run: typeof s.path = [s.path[0]];
      const flush = () => {
        if (run.length < 2) return;
        const lvl = run[1].level ?? OUTDOOR;
        const faded = view ? lvl !== OUTDOOR && (run[1].buildingId !== view.buildingId || lvl !== view.level) : false;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: run.map((p) => [p.lng, p.lat]) },
          properties: { index: s.index, level: lvl, faded, active: d.activeStep === s.index },
        });
      };
      for (let i = 1; i < s.path.length; i++) {
        const p = s.path[i];
        if ((p.level ?? OUTDOOR) !== (run.at(-1)!.level ?? OUTDOOR) && run.length > 1) {
          flush();
          run = [run.at(-1)!];
        }
        run.push(p);
      }
      flush();
    });
    set('scm-route', { type: 'FeatureCollection', features });
    const first = r.steps[0].location;
    const last = r.steps.at(-1)!.location;
    const ends: GeoJSON.Feature[] = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [first.lng, first.lat] }, properties: { role: 'start' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [last.lng, last.lat] }, properties: { role: 'end' } },
    ];
    const active = d.activeStep !== null ? r.steps[d.activeStep] : undefined;
    if (active && active.type !== 'arrive' && d.activeStep !== 0) {
      ends.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [active.location.lng, active.location.lat] }, properties: { role: 'step' } });
    }
    set('scm-route-ends', { type: 'FeatureCollection', features: ends });
  } else {
    set('scm-route', EMPTY);
    set('scm-route-ends', EMPTY);
  }

  // Selected destination (rooms in indoor view are highlighted as a filled room instead).
  const sel = d.selected;
  const roomShown = Boolean(sel && sel.level !== undefined && view && view.buildingId === sel.buildingId && view.level === sel.level);
  set('scm-selected', sel && !r && !roomShown && sel.kind !== 'building'
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [sel.location.lng, sel.location.lat] }, properties: {} }] }
    : EMPTY);

  // User location with an accuracy halo sized for the current zoom.
  if (d.user) {
    const { position, accuracy = 0 } = d.user;
    const metresPerPixel = (156543.03 * Math.cos((position.lat * Math.PI) / 180)) / 2 ** map.getZoom();
    set('scm-user', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [position.lng, position.lat] }, properties: { radiusPx: Math.min(200, accuracy / metresPerPixel) } }],
    });
  } else {
    set('scm-user', EMPTY);
  }

  // A still map does not always redraw after setData; ask for a frame.
  map.triggerRepaint();
}

function withProps<P extends object>(fc: GeoJSON.FeatureCollection, extra: (p: P) => Record<string, unknown>): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, ...extra(f.properties as P) } })) };
}

/** "Seminar room 1.01 (sample)" -> "Seminar room 1.01". */
function shortRoomLabel(name?: string) {
  return (name ?? '').replace(/\s*\(sample\)\s*$/i, '');
}
