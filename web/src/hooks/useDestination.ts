'use client';

import { useEffect, useState } from 'react';
import type { MapProvider } from '@/lib/providers';
import type { Destination } from '@/lib/types';

/** Looks up a destination by id. Resolves to null for unknown ids (e.g. an old share link). */
export function useDestination(provider: MapProvider | null, id: string | undefined): Destination | null {
  const [found, setFound] = useState<{ id: string; dest: Destination | null } | null>(null);

  useEffect(() => {
    if (!provider || !id) return;
    let cancelled = false;
    provider.getDestination(id).then(
      (dest) => !cancelled && setFound({ id, dest }),
      () => !cancelled && setFound({ id, dest: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [provider, id]);

  return id && found?.id === id ? found.dest : null;
}
