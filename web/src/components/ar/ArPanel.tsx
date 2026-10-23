'use client';

import { Box, Download } from 'lucide-react';
import { formatDistance, formatDuration } from '@/lib/route/constants';
import type { Route } from '@/lib/types';
import { Button } from '../ui/ui';

/**
 * Placeholder for Phase 2. The route here is the exact JSON the AR app will read
 * (see public/data/schemas/route.schema.json).
 */
export function ArPanel({ route, onPlanRoute }: { route: Route | null; onPlanRoute(): void }) {
  const download = () => {
    if (!route) return;
    const blob = new Blob([JSON.stringify(route, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 p-4">
      <div className="rounded-2xl bg-gradient-to-br from-[#0b1f3a] to-[#0b7a85] p-5 text-white">
        <Box aria-hidden className="size-9" />
        <h2 className="mt-3 text-xl font-semibold">AR navigation is coming</h2>
        <p className="mt-1 text-sm text-white/90">
          Soon you&apos;ll be able to hold up your phone and follow arrows on the path in front of you, indoors and out.
        </p>
      </div>

      {route ? (
        <section aria-label="Route ready for AR" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Your current route</p>
          <p className="font-semibold">
            {route.from.name} → {route.to.name}
          </p>
          <p className="text-sm text-muted">
            {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMetres)} · {route.steps.length} steps
            {route.accessible ? ' · step-free' : ''}
          </p>
          <Button disabled aria-describedby="ar-soon" className="w-full">
            <Box aria-hidden className="size-4" />
            Open this route in AR
          </Button>
          <p id="ar-soon" className="text-xs text-muted">Not available yet. The route is kept ready for the AR app.</p>
          <Button variant="secondary" onClick={download} className="w-full">
            <Download aria-hidden className="size-4" />
            Download route data (JSON)
          </Button>
        </section>
      ) : (
        <section className="space-y-3 rounded-2xl border border-dashed border-border p-5 text-center">
          <p className="font-medium">No route yet</p>
          <p className="text-sm text-muted">Plan a route first. It will be ready to open in AR when that arrives.</p>
          <Button onClick={onPlanRoute}>Plan a route</Button>
        </section>
      )}
    </div>
  );
}
