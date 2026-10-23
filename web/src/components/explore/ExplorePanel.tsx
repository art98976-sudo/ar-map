'use client';

import { ArrowLeft, Building2, ChevronRight, Landmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MapProvider } from '@/lib/providers';
import { FILTER_CATEGORIES, FILTER_LABELS, type Destination, type FilterCategory } from '@/lib/types';
import { CATEGORY_ICONS, KIND_ICONS, destinationSubtitle } from '@/lib/ui/kinds';
import { IconButton, Spinner } from '../ui/ui';

type Group = { id: FilterCategory | 'buildings' | 'landmarks'; label: string; icon: typeof Building2; filter(d: Destination): boolean };

const GROUPS: Group[] = [
  { id: 'buildings', label: 'Buildings', icon: Building2, filter: (d) => d.kind === 'building' },
  ...FILTER_CATEGORIES.map((c) => ({ id: c, label: FILTER_LABELS[c], icon: CATEGORY_ICONS[c], filter: (d: Destination) => d.categories.includes(c) })),
  { id: 'landmarks', label: 'Landmarks', icon: Landmark, filter: (d) => d.kind === 'landmark' || d.id === 'building:airthrey-castle' },
];

export function ExplorePanel({ provider, onPick }: { provider: MapProvider | null; onPick(d: Destination): void }) {
  const [all, setAll] = useState<Destination[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Group | null>(null);

  useEffect(() => {
    if (!provider) return;
    provider.searchDestinations('', { limit: 1000 }).then(setAll, (e) => setError(String(e?.message ?? e)));
  }, [provider]);

  if (error) return <p className="p-4 text-sm">Couldn&apos;t load places. {error}</p>;
  if (!all) return <div className="p-4"><Spinner label="Loading places…" /></div>;

  if (open) {
    const items = all.filter(open.filter).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div>
        <div className="flex items-center gap-1 px-2 py-2">
          <IconButton label="Back to categories" onClick={() => setOpen(null)}>
            <ArrowLeft aria-hidden className="size-5" />
          </IconButton>
          <h2 className="text-lg font-semibold">{open.label}</h2>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing here yet in the sample data.</p>
        ) : (
          <ul>
            {items.map((d) => {
              const Icon = KIND_ICONS[d.kind];
              return (
                <li key={d.id} className="border-t border-border">
                  <button type="button" onClick={() => onPick(d)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted">
                    <Icon aria-hidden className="size-5 shrink-0 text-teal" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.name}</span>
                      <span className="block text-xs text-muted">{destinationSubtitle(d)}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-xl font-semibold">Explore campus</h2>
        <p className="text-sm text-muted">Browse buildings and facilities by category.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {GROUPS.map((g) => {
          const count = all.filter(g.filter).length;
          const Icon = g.icon;
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setOpen(g)}
                className="flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-teal"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-teal/12 text-teal"><Icon aria-hidden className="size-5" /></span>
                <span className="font-semibold">{g.label}</span>
                <span className="text-xs text-muted">{count} {count === 1 ? 'place' : 'places'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
