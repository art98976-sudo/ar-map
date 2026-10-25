'use client';

import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useSearch } from '@/hooks/useSearch';
import type { MapProvider } from '@/lib/providers';
import type { Destination } from '@/lib/types';
import { ResultList, SearchBar } from '../search/Search';
import { IconButton } from '../ui/ui';

interface PlacePickerProps {
  which: 'from' | 'to';
  provider: MapProvider;
  onBack(): void;
  onPick(d: Destination): void;
  /** "From" only: start from your location. */
  onPickMyLocation(): void;
}

/** Full-screen search for a route's start or destination. */
export function PlacePicker({ which, provider, onBack, onPick, onPickMyLocation }: PlacePickerProps) {
  const [query, setQuery] = useState('');
  const search = useSearch(provider, query, [], { enabled: true, allowEmpty: true });
  const from = which === 'from';
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:flex-1">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <IconButton label="Back" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-5" />
        </IconButton>
        <h2 className="font-semibold">{from ? 'Choose starting point' : 'Choose destination'}</h2>
      </div>
      <div className="space-y-3 overflow-y-auto p-3">
        <SearchBar
          value={query}
          onChange={setQuery}
          autoFocus
          label={from ? 'Search for a starting point' : 'Search for a destination'}
          placeholder={from ? 'Start from…' : 'Where to?'}
          onSubmit={() => search.results?.[0] && onPick(search.results[0])}
        />
        <ResultList
          results={search.results}
          loading={search.loading}
          error={search.error}
          query={query}
          onPick={onPick}
          showMyLocation={from}
          onPickMyLocation={onPickMyLocation}
        />
      </div>
    </div>
  );
}
