import type { StyleSpecification } from 'maplibre-gl';

/** Approximate centre of the University of Stirling campus. */
export const CAMPUS_CENTER: [number, number] = [-3.9205, 56.1465];

/**
 * Base map. A custom MapLibre style URL can be set with NEXT_PUBLIC_BASEMAP_STYLE_URL.
 * The default uses OpenStreetMap's standard raster tiles, which are fine for development
 * but should be replaced by a hosted tile service before public launch (OSM tile usage policy).
 */
export function baseMapStyle(): string | StyleSpecification {
  const custom = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL;
  if (custom) return custom;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 } }],
  };
}

/** Colours for the sample-data overlay. MapLibre needs literal colours, not CSS variables. */
export const OVERLAY_COLOURS = {
  water: '#7cc3e6',
  green: '#9fd5a8',
  building: '#0b1f3a',
  buildingIndoor: '#0b7a85',
  path: '#ffffff',
  pathCasing: '#5b6b80',
  steps: '#c2410c',
  ramp: '#2f855a',
  entrance: '#2f855a',
  place: '#0b7a85',
  transport: '#6b46c1',
} as const;
