import type { Ref } from 'react';
import type { MapOverlay, MazeMapBaseMap } from '@/lib/providers';
import type { Destination, IndoorMap, LatLng, Route } from '@/lib/types';

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

/** What the map shows; MapView pushes it into the map's sources whenever it changes. */
export interface MapData {
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
  /** Draw MazeMap's campus map (with indoor floors) instead of the plain base map. Fixed for the map's lifetime. */
  baseMap?: MazeMapBaseMap;
}

export interface MapViewProps extends MapData {
  ref?: Ref<MapViewHandle>;
  onSelect(destinationId: string): void;
  onStatus(status: 'ready' | 'error', message?: string): void;
  /** MazeMap map only: a tap on the map that did not hit one of our features. */
  onMapTap?(point: LatLng, level: number): void;
  /** MazeMap map only: the floor shown changed (e.g. from the map itself). */
  onZLevel?(level: number): void;
}

/** Floor view for MazeMap's map, which shows one z-level across the whole campus. */
export const ALL_BUILDINGS = '*';
