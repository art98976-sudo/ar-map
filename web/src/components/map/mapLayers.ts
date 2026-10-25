/** The app's own map layers (campus overlay, floor plans, route, you), drawn on top of the base map. */
import type { CircleLayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { MapPalette } from './mapStyle';

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

export const SOURCES = [
  'scm-areas', 'scm-paths', 'scm-buildings', 'scm-entrances', 'scm-places',
  'scm-indoor', 'scm-route', 'scm-route-ends', 'scm-selected', 'scm-user',
] as const;

export function addLayers(map: MapLibreMap, c: MapPalette, onMazemap = false) {
  for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  // Our labels use OpenFreeMap fonts; on MazeMap's map the map draws its own labels.
  const hasGlyphs = !onMazemap && Boolean(map.getStyle().glyphs);
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
