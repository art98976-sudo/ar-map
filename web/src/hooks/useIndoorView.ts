'use client';

import { useCallback, useEffect, useState } from 'react';
import { ALL_BUILDINGS, type IndoorViewState } from '@/components/map/types';
import type { MapProvider } from '@/lib/providers';
import type { Building, Floor, IndoorMap } from '@/lib/types';

/**
 * Which floor plan the map shows. With sample data, one building's floors at a time. With
 * MazeMap's map, one floor (z-level) across the whole campus, and floors are always on.
 */
export function useIndoorView(provider: MapProvider, buildings: Building[], buildingById: Map<string, Building>) {
  const baseMap = provider.baseMap;
  const [indoorView, setIndoorViewRaw] = useState<IndoorViewState | null>(null);
  const setIndoorView = useCallback(
    (v: IndoorViewState | null) => {
      if (!baseMap) return setIndoorViewRaw(v);
      if (v) setIndoorViewRaw({ buildingId: ALL_BUILDINGS, level: v.level });
    },
    [baseMap],
  );
  /** The map itself changed floor (MazeMap's floor control). */
  const onMapLevel = useCallback((level: number) => setIndoorViewRaw((v) => (v?.level === level ? v : { buildingId: ALL_BUILDINGS, level })), []);

  // MazeMap: every floor level on campus, for the campus-wide floor control.
  const [campusFloors, setCampusFloors] = useState<Floor[]>([]);
  useEffect(() => {
    if (!baseMap || !buildings.length) return;
    let cancelled = false;
    Promise.all(buildings.map((b) => provider.getFloors(b.id).catch(() => [] as Floor[]))).then((lists) => {
      if (cancelled) return;
      const byLevel = new Map<number, Floor>();
      for (const fl of lists.flat()) if (!byLevel.has(fl.level)) byLevel.set(fl.level, fl);
      setCampusFloors([...byLevel.values()].sort((a, b) => a.level - b.level));
    });
    return () => {
      cancelled = true;
    };
  }, [baseMap, buildings, provider]);

  // Sample data: the floor plans of the building being shown.
  const [indoorMap, setIndoorMap] = useState<IndoorMap | null>(null);
  useEffect(() => {
    if (!indoorView || indoorMap?.buildingId === indoorView.buildingId || !provider.getIndoorMap) return;
    let cancelled = false;
    provider.getIndoorMap(indoorView.buildingId).then((m) => !cancelled && setIndoorMap(m));
    return () => {
      cancelled = true;
    };
  }, [indoorView, indoorMap, provider]);

  const hasIndoor = useCallback(
    (buildingId?: string) => Boolean(buildingId && (baseMap || buildingById.get(buildingId)?.hasIndoorData)),
    [baseMap, buildingById],
  );

  return { indoorView, setIndoorView, onMapLevel, campusFloors, indoorMap, hasIndoor };
}
