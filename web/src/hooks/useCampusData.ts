'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MapOverlay, MapProvider } from '@/lib/providers';
import type { Building } from '@/lib/types';

/** Loads the campus overlay and buildings once; `retry` loads them again after an error. */
export function useCampusData(provider: MapProvider) {
  const [overlay, setOverlay] = useState<MapOverlay | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([provider.getMapOverlay?.() ?? Promise.resolve(null), provider.getBuildings()])
      .then(([o, b]) => {
        if (cancelled) return;
        setOverlay(o);
        setBuildings(b);
        setError(null);
        setLoaded(true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [provider, attempt]);
  const buildingById = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  return { overlay, buildings, buildingById, error, loaded, retry: () => setAttempt((n) => n + 1) };
}
