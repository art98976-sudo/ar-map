'use client';

/**
 * The campus map: MapLibre with OpenFreeMap tiles (sample data), or MazeMap's own map (campus data).
 * Layers are set up in mapLayers.ts and filled in mapData.ts; camera helpers are in camera.ts.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MazeMapBaseMap } from '@/lib/providers';
import { loadMazemapSdk, type MazemapMapInstance } from '@/lib/providers/mazemap/sdk';
import { addPadding, boundsOf, fitPadding, reducedMotion } from './camera';
import { updateData } from './mapData';
import { addLayers } from './mapLayers';
import { CAMPUS_CENTER, PALETTES, baseMapStyle, fallbackRasterStyle } from './mapStyle';
import type { MapData, MapViewProps } from './types';


export default function MapView(props: MapViewProps) {
  const { ref, onSelect, onStatus, onMapTap, onZLevel, ...data } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef<MapData>(data);
  const callbacks = useRef({ onSelect, onStatus, onMapTap, onZLevel });
  const mazemapRef = useRef<MazemapMapInstance | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);

  useEffect(() => {
    latest.current = data;
    callbacks.current = { onSelect, onStatus, onMapTap, onZLevel };
  });

  // Camera moves asked for before the map exists (e.g. opening a shared link) wait here.
  const pendingCamera = useRef<((map: MapLibreMap) => void) | null>(null);
  const camera = (move: (map: MapLibreMap) => void) => {
    if (mapRef.current) move(mapRef.current);
    else pendingCamera.current = move;
  };

  useImperativeHandle(ref, () => ({
    flyTo(point, zoom = 18) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
      // An offset (not persistent camera padding): MazeMap's Mapbox GL v1 adds remembered padding
      // to later fits, which can exceed the map's size.
      const p = latest.current.padding;
      camera((map) =>
        map.flyTo({ center: [point.lng, point.lat], zoom, offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2], duration: reducedMotion() ? 0 : 700 }),
      );
    },
    fitPoints(points) {
      const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (!valid.length) return;
      camera((map) => {
        const padding = fitPadding(map, addPadding(latest.current.padding, 30));
        const cam = map.cameraForBounds(boundsOf(valid), { padding, maxZoom: 18 });
        if (!cam?.center) return;
        map.flyTo({ ...cam, duration: reducedMotion() ? 0 : 700 });
      });
    },
  }));

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const mmConfig = latest.current.baseMap;
      if (mmConfig) {
        map = await createMazemapMap(mmConfig);
        return;
      }
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

    /** MazeMap's map: a Mapbox GL v1 map with the University's buildings and indoor floor plans. */
    async function createMazemapMap(cfg: MazeMapBaseMap): Promise<MapLibreMap | undefined> {
      const mm = await loadMazemapSdk({ version: cfg.sdkVersion, viewToken: cfg.viewToken, authToken: cfg.authToken });
      if (cancelled || !container.current) return undefined;
      const raw = new mm.Map({
        container: container.current,
        campuses: cfg.campusId,
        center: { lng: CAMPUS_CENTER[0], lat: CAMPUS_CENTER[1] },
        zoom: 16,
        zLevel: 1,
        zLevelControl: false, // the app's own floor control drives the floor shown
        minZoom: 13,
        maxZoom: 21,
      });
      mazemapRef.current = raw;
      // Same camera, source and layer API as MapLibre (both descend from Mapbox GL).
      const m = raw as unknown as MapLibreMap;
      mapRef.current = m;
      m.addControl(new mm.mapboxgl.NavigationControl({ showCompass: true }) as never, 'top-right');
      m.once('load', () => {
        setStyleVersion((v) => v + 1);
        callbacks.current.onStatus('ready');
        callbacks.current.onZLevel?.(raw.getZLevel());
        if (pendingCamera.current) {
          pendingCamera.current(m);
          pendingCamera.current = null;
        }
      });
      raw.on('zlevel', () => callbacks.current.onZLevel?.(raw.getZLevel()));
      m.on('error', (e) => console.warn('Map error:', e.error?.message ?? e));
      m.on('click', (e) => {
        const ours = ['scm-route-ends', 'scm-selected'].filter((id) => m.getLayer(id));
        const hit = m.queryRenderedFeatures(e.point, { layers: ours }).find((f) => f.properties?.destId);
        if (hit) callbacks.current.onSelect(String(hit.properties.destId));
        else callbacks.current.onMapTap?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }, raw.getZLevel());
      });
      return m;
    }

    return () => {
      cancelled = true;
      (mapRef.current ?? map)?.remove();
      mapRef.current = null;
      mazemapRef.current = null;
    };
  }, []);

  // Switch base map with the colour scheme.
  const dark = data.dark;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || latest.current.baseMap) return;
    map.setStyle(baseMapStyle(dark));
    // Re-adding our layers happens on the next 'style.load'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // MazeMap map: show the floor the app asks for.
  const viewLevel = data.indoorView?.level;
  useEffect(() => {
    const mm = mazemapRef.current;
    if (!mm || !styleVersion || viewLevel === undefined) return;
    try {
      if (mm.getZLevel() !== viewLevel) mm.setZLevel(viewLevel);
    } catch {
      // The campus may still be loading; the next change will apply.
    }
  }, [viewLevel, styleVersion]);

  // (Re)build our layers whenever a style finishes loading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    addLayers(map, PALETTES[latest.current.dark && !latest.current.baseMap ? 'dark' : 'light'], Boolean(latest.current.baseMap));
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
