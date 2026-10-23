'use client';

import { useEffect, useState } from 'react';
import type { MapProvider } from '@/lib/providers';
import type { Destination, FilterCategory } from '@/lib/types';

/**
 * Debounced search. Returns null while there is nothing to search for,
 * unless allowEmpty is set (then an empty query lists everything).
 */
export function useSearch(
  provider: MapProvider | null,
  query: string,
  categories: FilterCategory[],
  { enabled = true, allowEmpty = false }: { enabled?: boolean; allowEmpty?: boolean } = {},
) {
  const [results, setResults] = useState<Destination[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = enabled && provider !== null && (allowEmpty || query.trim() !== '' || categories.length > 0);
  const catKey = categories.join(',');

  useEffect(() => {
    if (!active || !provider) return;
    let cancelled = false;
    const t = setTimeout(() => {
      provider
        .searchDestinations(query, { categories: catKey ? (catKey.split(',') as FilterCategory[]) : [], limit: 30 })
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, provider, query, catKey]);

  return { results: active ? results : null, loading: active && results === null && !error, error };
}
