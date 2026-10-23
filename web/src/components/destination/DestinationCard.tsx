'use client';

import { Bookmark, BookmarkCheck, Layers, Navigation, X } from 'lucide-react';
import { FILTER_LABELS, type Destination } from '@/lib/types';
import { KIND_ICONS, destinationSubtitle } from '@/lib/ui/kinds';
import { Button, IconButton } from '../ui/ui';

export function DestinationCard({
  destination: d,
  saved,
  hasIndoorMap,
  onDirections,
  onToggleSave,
  onIndoor,
  onClose,
}: {
  destination: Destination;
  saved: boolean;
  hasIndoorMap: boolean;
  onDirections(): void;
  onToggleSave(): void;
  onIndoor(): void;
  onClose(): void;
}) {
  const Icon = KIND_ICONS[d.kind];
  return (
    <article aria-labelledby="dest-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
      {/* Photo placeholder: real photos need permission from the University. */}
      <div aria-hidden className="relative h-24 bg-gradient-to-br from-[#16325c] via-[#0b7a85] to-[#2f855a]">
        <Icon className="absolute bottom-3 left-4 size-9 text-white/90" />
        <span className="absolute right-3 bottom-2 text-[11px] font-medium text-white/85">Photo coming soon</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 id="dest-title" className="text-lg leading-snug font-semibold">{d.name}</h2>
            <p className="text-sm text-muted">{destinationSubtitle(d)}</p>
          </div>
          <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
        {d.description && <p className="text-sm">{d.description}</p>}
        {d.categories.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Categories">
            {d.categories.map((c) => (
              <li key={c} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium">{FILTER_LABELS[c]}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={onDirections} className="flex-1">
            <Navigation aria-hidden className="size-4" />
            Directions
          </Button>
          <Button variant="secondary" onClick={onToggleSave} aria-pressed={saved}>
            {saved ? <BookmarkCheck aria-hidden className="size-4 text-teal" /> : <Bookmark aria-hidden className="size-4" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
          {hasIndoorMap && (
            <Button variant="secondary" onClick={onIndoor}>
              <Layers aria-hidden className="size-4" />
              Floors
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
