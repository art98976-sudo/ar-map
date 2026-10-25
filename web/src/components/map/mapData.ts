/** Puts the app's data (overlay, floor plan, route, selection, your location) into the map's sources. */
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { EMPTY, SOURCES } from './mapLayers';
import { ALL_BUILDINGS, type MapData } from './types';

/** Level of points outside any building. */
const OUTDOOR = -999;

export function updateData(map: MapLibreMap, d: MapData) {
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
        const faded = view ? lvl !== OUTDOOR && ((view.buildingId !== ALL_BUILDINGS && run[1].buildingId !== view.buildingId) || lvl !== view.level) : false;
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
