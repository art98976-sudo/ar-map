import type { StyleSpecification } from 'maplibre-gl';

/** Approximate centre of the University of Stirling campus. */
export const CAMPUS_CENTER: [number, number] = [-3.9205, 56.1465];

/**
 * Base map. Defaults to OpenFreeMap (free, no key, open data from OpenStreetMap) with a light
 * and a dark style. Override with NEXT_PUBLIC_BASEMAP_STYLE_URL and NEXT_PUBLIC_BASEMAP_STYLE_URL_DARK.
 */
export function baseMapStyle(dark: boolean): string {
  const light = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
  const darkUrl = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL_DARK || (process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ? light : 'https://tiles.openfreemap.org/styles/dark');
  return dark ? darkUrl : light;
}

/** Used if the vector style cannot be loaded. Has no label fonts, so labels are skipped. */
export function fallbackRasterStyle(dark: boolean): StyleSpecification {
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
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: dark
          ? { 'raster-saturation': -0.9, 'raster-brightness-max': 0.35, 'raster-contrast': 0.2 }
          : { 'raster-saturation': -0.6, 'raster-opacity': 0.85 },
      },
    ],
  };
}

export interface MapPalette {
  water: string;
  green: string;
  building: string;
  buildingIndoor: string;
  buildingLabel: string;
  labelHalo: string;
  path: string;
  pathCasing: string;
  steps: string;
  ramp: string;
  entrance: string;
  place: string;
  transport: string;
  room: string;
  roomOutline: string;
  roomSelected: string;
  corridor: string;
  core: string;
  route: string;
  routeCasing: string;
  routeActive: string;
  user: string;
}

/** Colours for our layers. MapLibre needs literal colours, not CSS variables. */
export const PALETTES: Record<'light' | 'dark', MapPalette> = {
  light: {
    water: '#9fd3ee',
    green: '#b8e0bf',
    building: '#1d3557',
    buildingIndoor: '#0b7a85',
    buildingLabel: '#0b1f3a',
    labelHalo: '#ffffff',
    path: '#ffffff',
    pathCasing: '#8796ab',
    steps: '#c2410c',
    ramp: '#2f855a',
    entrance: '#2f855a',
    place: '#0b7a85',
    transport: '#6b46c1',
    room: '#e6f4f5',
    roomOutline: '#0b7a85',
    roomSelected: '#f6c344',
    corridor: '#ffffff',
    core: '#cbd5e1',
    route: '#0b7a85',
    routeCasing: '#ffffff',
    routeActive: '#2f855a',
    user: '#2563eb',
  },
  dark: {
    water: '#1d4e6e',
    green: '#1f4d36',
    building: '#5b7db1',
    buildingIndoor: '#2fb3bd',
    buildingLabel: '#e8eef6',
    labelHalo: '#07142a',
    path: '#3a5378',
    pathCasing: '#0e2142',
    steps: '#f08a5d',
    ramp: '#68d391',
    entrance: '#68d391',
    place: '#3fc1c9',
    transport: '#b794f4',
    room: '#163a5c',
    roomOutline: '#3fc1c9',
    roomSelected: '#d69e2e',
    corridor: '#0e2142',
    core: '#4a5f80',
    route: '#3fc1c9',
    routeCasing: '#07142a',
    routeActive: '#68d391',
    user: '#60a5fa',
  },
};
