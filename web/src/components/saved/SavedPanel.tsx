'use client';

import { Bookmark, Navigation, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MapProvider } from '@/lib/providers';
import { savedStore } from '@/lib/state/saved';
import type { Destination } from '@/lib/types';
import { KIND_ICONS, destinationSubtitle } from '@/lib/ui/kinds';
import { IconButton, Spinner } from '../ui/ui';

export function SavedPanel({
  provider,
  savedIds,
  onPick,
  onDirections,
}: {
  provider: MapProvider | null;
  savedIds: string[];
  onPick(d: Destination): void;
  onDirections(d: Destination): void;
}) {
  const [items, setItems] = useState<Destination[] | null>(null);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    Promise.all(savedIds.map((id) => provider.getDestination(id).catch(() => null))).then((list) => {
      if (!cancelled) setItems(list.filter((d): d is Destination => d !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [provider, savedIds]);

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-xl font-semibold">Saved places</h2>
        <p className="text-sm text-muted">Kept on this device only.</p>
      </div>
      {!items && <Spinner label="Loading saved places…" />}
      {items && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <Bookmark aria-hidden className="mx-auto size-8 text-muted" />
          <p className="mt-2 font-medium">No saved places yet</p>
          <p className="mt-1 text-sm text-muted">Tap Save on a room, café or building to keep it here.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="overflow-hidden rounded-2xl border border-border bg-surface" aria-label="Saved places">
          {items.map((d) => {
            const Icon = KIND_ICONS[d.kind];
            return (
              <li key={d.id} className="flex items-center gap-1 border-b border-border pr-1 last:border-b-0">
                <button type="button" onClick={() => onPick(d)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted">
                  <Icon aria-hidden className="size-5 shrink-0 text-teal" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="block truncate text-xs text-muted">{destinationSubtitle(d)}</span>
                  </span>
                </button>
                <IconButton label={`Directions to ${d.name}`} onClick={() => onDirections(d)}>
                  <Navigation aria-hidden className="size-5 text-teal" />
                </IconButton>
                <IconButton label={`Remove ${d.name}`} onClick={() => savedStore.remove(d.id)}>
                  <Trash2 aria-hidden className="size-5 text-muted" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
