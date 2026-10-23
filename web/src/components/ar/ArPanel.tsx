'use client';

import { Box, Camera, Compass, Download, LocateFixed, Play } from 'lucide-react';
import { formatDistance, formatDuration } from '@/lib/route/constants';
import type { Route } from '@/lib/types';
import { Button } from '../ui/ui';

/**
 * The AR tab: start AR navigation for the current route. The route is the same JSON format the
 * AR view (and any future native AR app) reads; it can also be downloaded.
 */
export function ArPanel({
  route,
  onStart,
  onPlanRoute,
}: {
  route: Route | null;
  onStart(opts: { simulate: boolean }): void;
  onPlanRoute(): void;
}) {
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
        <h2 className="mt-3 text-xl font-semibold">AR navigation</h2>
        <p className="mt-1 text-sm text-white/90">
          Hold up your phone and follow the arrows on the path in front of you, indoors and out.
        </p>
      </div>

      {route ? (
        <section aria-label="Route for AR" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Your current route</p>
          <p className="font-semibold">
            {route.from.name} → {route.to.name}
          </p>
          <p className="text-sm text-muted">
            {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMetres)} · {route.steps.length} steps
            {route.accessible ? ' · step-free' : ''}
          </p>
          <Button onClick={() => onStart({ simulate: false })} className="w-full">
            <Box aria-hidden className="size-4" />
            Open this route in AR
          </Button>
          <Button variant="secondary" onClick={() => onStart({ simulate: true })} className="w-full">
            <Play aria-hidden className="size-4" />
            Try it with a simulated walk
          </Button>
          <ul className="space-y-1.5 pt-1 text-xs text-muted">
            <li className="flex gap-2"><Camera aria-hidden className="size-4 shrink-0" />Uses your back camera. Nothing is recorded or uploaded.</li>
            <li className="flex gap-2"><LocateFixed aria-hidden className="size-4 shrink-0" />Uses your location to follow the route. Works best outdoors.</li>
            <li className="flex gap-2"><Compass aria-hidden className="size-4 shrink-0" />If the arrows point the wrong way, aim along the path and tap Align.</li>
          </ul>
          <Button variant="ghost" onClick={download} className="w-full">
            <Download aria-hidden className="size-4" />
            Download route data (JSON)
          </Button>
        </section>
      ) : (
        <section className="space-y-3 rounded-2xl border border-dashed border-border p-5 text-center">
          <p className="font-medium">No route yet</p>
          <p className="text-sm text-muted">Plan a route first, then open it in AR.</p>
          <Button onClick={onPlanRoute}>Plan a route</Button>
        </section>
      )}
    </div>
  );
}
