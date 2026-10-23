'use client';

import { LocateFixed, Search as SearchIcon, X } from 'lucide-react';
import { useId, type KeyboardEvent, type RefObject } from 'react';
import { FILTER_CATEGORIES, FILTER_LABELS, type Destination, type FilterCategory } from '@/lib/types';
import { CATEGORY_ICONS, KIND_ICONS, destinationSubtitle } from '@/lib/ui/kinds';
import { Spinner, cx } from '../ui/ui';

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onFocus,
  placeholder = 'Search buildings, rooms, cafés…',
  inputRef,
  label = 'Search campus',
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  onSubmit?(): void;
  onFocus?(): void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  label?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSubmit?.();
    if (e.key === 'Escape') onChange('');
  };
  return (
    <div className="flex h-12 items-center gap-2 rounded-full border border-border bg-surface pl-4 pr-1 shadow-md focus-within:border-teal">
      <SearchIcon aria-hidden className="size-5 shrink-0 text-muted" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={onFocus}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-muted"
        >
          <X aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}

export function FilterChips({ value, onChange }: { value: FilterCategory[]; onChange(v: FilterCategory[]): void }) {
  return (
    <div role="group" aria-label="Filter places" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {FILTER_CATEGORIES.map((c) => {
        const on = value.includes(c);
        const Icon = CATEGORY_ICONS[c];
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium shadow-sm transition-colors',
              on ? 'border-teal bg-teal text-on-accent' : 'border-border bg-surface text-foreground hover:bg-surface-muted',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {FILTER_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}

export function ResultList({
  results,
  loading,
  error,
  query,
  onPick,
  showMyLocation,
  onPickMyLocation,
  emptyHint,
}: {
  results: Destination[] | null;
  loading: boolean;
  error?: string | null;
  query: string;
  onPick(d: Destination): void;
  showMyLocation?: boolean;
  onPickMyLocation?(): void;
  emptyHint?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      {showMyLocation && (
        <button
          type="button"
          onClick={onPickMyLocation}
          className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2 text-left hover:bg-surface-muted"
        >
          <span className="grid size-9 place-items-center rounded-full bg-teal/15 text-teal"><LocateFixed aria-hidden className="size-5" /></span>
          <span className="font-medium">My location</span>
        </button>
      )}
      {loading && <div className="px-4 py-3"><Spinner label="Searching…" /></div>}
      {error && <p className="px-4 py-3 text-sm">Search isn&apos;t working right now. {error}</p>}
      {results && results.length === 0 && (
        <p className="px-4 py-4 text-sm text-muted">
          {query.trim() ? <>No places match &ldquo;{query.trim()}&rdquo;.</> : 'No places in this filter.'} {emptyHint}
        </p>
      )}
      {results && results.length > 0 && (
        <ul aria-label="Search results" className="max-h-[50dvh] overflow-y-auto lg:max-h-none">
          {results.map((d) => {
            const Icon = KIND_ICONS[d.kind];
            return (
              <li key={d.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-teal">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="block truncate text-xs text-muted">{destinationSubtitle(d)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
