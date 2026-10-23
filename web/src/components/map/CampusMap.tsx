'use client';

import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { getMapProvider, type MapOverlay } from '@/lib/providers';
import { CAMPUS_CENTER, OVERLAY_COLOURS as C, baseMapStyle } from './mapStyle';

type Status = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };

const CLICKABLE_LAYERS = ['buildings-fill', 'places', 'entrances'];

/**
 * Step 1 checkpoint: a plain map showing the sample campus data.
 * Search, routing and the full UI arrive in later steps.
 */
export default function CampusMap() {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { provider, warning } = getMapProvider();
        if (warning) console.warn(warning);
        if (!provider.getMapOverlay) throw new Error(`The ${provider.id} provider draws its own map (not available yet).`);

        const [maplibre, overlay] = await Promise.all([import('maplibre-gl'), provider.getMapOverlay()]);
        if (cancelled || !container.current) return;
        // MapLibre 6 needs its worker served as a separate file (copied to public/vendor on install).
        maplibre.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');

        map = new maplibre.Map({
          container: container.current,
          style: baseMapStyle(),
          center: CAMPUS_CENTER,
          zoom: 16,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: true }), 'top-right');
        map.addControl(new maplibre.ScaleControl({ unit: 'metric' }), 'bottom-left');

        map.on('load', () => {
          if (!map) return;
          addOverlay(map, overlay);
          fitToBuildings(map, overlay);
          setStatus({ state: 'ready' });
        });

        const popup = new maplibre.Popup({ closeButton: true, maxWidth: '260px' });
        map.on('click', CLICKABLE_LAYERS, (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature || !map) return;
          popup.setLngLat(e.lngLat).setDOMContent(popupContent(feature.properties)).addTo(map);
        });
        for (const id of CLICKABLE_LAYERS) {
          map.on('mouseenter', id, () => map && (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', id, () => map && (map.getCanvas().style.cursor = ''));
        }
      } catch (err) {
        if (!cancelled) setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [attempt]);

  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0">
        {/* MapLibre styles its own element as position:relative, so it sits inside a positioned wrapper. */}
        <div ref={container} className="h-full w-full" role="region" aria-label="Campus map" />
      </div>

      {status.state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-background/70" role="status" aria-live="polite">
          <p className="rounded-full bg-surface px-4 py-2 text-sm text-muted shadow">Loading campus map…</p>
        </div>
      )}

      {status.state === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-background p-4" role="alert">
          <div className="max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="font-semibold">Couldn&apos;t load the campus map</p>
            <p className="mt-2 text-sm text-muted">{status.message}</p>
            <button
              type="button"
              onClick={() => {
                setStatus({ state: 'loading' });
                setAttempt((n) => n + 1);
              }}
              className="mt-4 min-h-11 rounded-full bg-teal px-5 font-medium text-on-accent hover:bg-teal-strong"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {status.state === 'ready' && <Legend />}
    </div>
  );
}

function addOverlay(map: MapLibreMap, o: MapOverlay) {
  for (const [id, data] of Object.entries(o)) map.addSource(id, { type: 'geojson', data });

  map.addLayer({ id: 'areas-water', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'water'], paint: { 'fill-color': C.water, 'fill-opacity': 0.85 } });
  map.addLayer({ id: 'areas-green', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'green'], paint: { 'fill-color': C.green, 'fill-opacity': 0.6 } });

  map.addLayer({ id: 'paths-casing', type: 'line', source: 'paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.pathCasing, 'line-width': 6 } });
  map.addLayer({
    id: 'paths', type: 'line', source: 'paths', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], 'steps', C.steps, 'ramp', C.ramp, C.path],
      'line-width': 3.5,
    },
  });

  map.addLayer({
    id: 'buildings-fill', type: 'fill', source: 'buildings',
    paint: { 'fill-color': ['case', ['get', 'hasIndoorData'], C.buildingIndoor, C.building], 'fill-opacity': 0.75 },
  });
  map.addLayer({ id: 'buildings-outline', type: 'line', source: 'buildings', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } });

  map.addLayer({
    id: 'entrances', type: 'circle', source: 'entrances',
    paint: { 'circle-radius': 5, 'circle-color': C.entrance, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'places', type: 'circle', source: 'places',
    paint: {
      'circle-radius': 7,
      'circle-color': ['case', ['in', 'transport', ['get', 'categories']], C.transport, C.place],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
}

function fitToBuildings(map: MapLibreMap, o: MapOverlay) {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of o.buildings.features) {
    if (f.geometry.type !== 'Polygon') continue;
    for (const [lng, lat] of f.geometry.coordinates[0]) {
      w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat);
    }
  }
  map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 0 });
}

/** Builds popup content with text nodes only, so data can never inject HTML. */
function popupContent(props: Record<string, unknown> | null): HTMLElement {
  const el = document.createElement('div');
  const title = document.createElement('p');
  title.style.fontWeight = '600';
  title.textContent = String(props?.name ?? 'Unnamed');
  el.appendChild(title);
  const detail = props?.description ?? (props?.stepFree === true ? 'Step-free entrance' : props?.stepFree === false ? 'Entrance with steps' : null);
  if (detail) {
    const p = document.createElement('p');
    p.style.marginTop = '4px';
    p.style.fontSize = '0.875rem';
    p.textContent = String(detail);
    el.appendChild(p);
  }
  if (props?.hasIndoorData === true) {
    const p = document.createElement('p');
    p.style.marginTop = '4px';
    p.style.fontSize = '0.8rem';
    p.textContent = 'Indoor map available (2 floors)';
    el.appendChild(p);
  }
  return el;
}

function Legend() {
  const items: [string, string, 'fill' | 'line' | 'dot'][] = [
    ['Building', C.building, 'fill'],
    ['Building with indoor map', C.buildingIndoor, 'fill'],
    ['Footpath', C.pathCasing, 'line'],
    ['Steps', C.steps, 'line'],
    ['Step-free ramp', C.ramp, 'line'],
    ['Entrance', C.entrance, 'dot'],
    ['Place', C.place, 'dot'],
    ['Bus stop / car park', C.transport, 'dot'],
  ];
  return (
    <details className="absolute left-3 top-3 max-w-[calc(100%-5rem)] rounded-xl border border-border bg-surface/95 text-sm shadow-md backdrop-blur">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">Map key</summary>
      <ul className="space-y-1.5 px-4 pb-3">
        {items.map(([label, colour, shape]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={shape === 'dot' ? 'size-3 rounded-full' : shape === 'line' ? 'h-1 w-4 rounded' : 'size-3 rounded-sm'}
              style={{ background: colour }}
            />
            {label}
          </li>
        ))}
      </ul>
    </details>
  );
}
