'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RouteState } from '@/components/navigate/NavigatePanel';
import { GEO_MESSAGES, type useGeolocation } from '@/hooks/useGeolocation';
import { NoRouteError, OutOfAreaError, type MapProvider } from '@/lib/providers';
import { formatDistance } from '@/lib/route/constants';
import { haversine } from '@/lib/routing/geometry';
import type { UrlState } from '@/lib/state/urlState';
import type { LatLng, Route, RouteEndpoint } from '@/lib/types';

const LAST_ROUTE_KEY = 'stirling-campus-map:last-route';
/** Recompute a "My location" route only after moving this far. */
const REROUTE_METRES = 25;

type Geo = ReturnType<typeof useGeolocation>;

/**
 * Plans the route the address bar asks for (Navigate and AR tabs), from a place or from your
 * location. `lastRoute` is the latest route planned in this browser session, for the AR tab.
 */
export function useRoutePlanning(provider: MapProvider, url: UrlState, geo: Geo) {
  // The position a "My location" route was computed from; only moves after real movement.
  const [origin, setOrigin] = useState<LatLng | null>(null);
  if (geo.position && (!origin || haversine(origin, geo.position) > REROUTE_METRES)) setOrigin(geo.position);

  const wantsRoute = (url.tab === 'navigate' || url.tab === 'ar') && Boolean(url.to);
  const needsLocation = wantsRoute && url.from.kind === 'me';
  useEffect(() => {
    if (needsLocation && geo.status === 'idle') geo.request();
  }, [needsLocation, geo]);

  const [computed, setComputed] = useState<{ key: string; state: RouteState } | null>(null);
  const routeKey = !wantsRoute
    ? null
    : url.from.kind === 'me'
      ? origin
        ? `me:${origin.lat},${origin.lng}>${url.to}>${url.accessible}`
        : null
      : `${url.from.id}>${url.to}>${url.accessible}`;

  useEffect(() => {
    if (!routeKey || !url.to) return;
    let cancelled = false;
    const from: RouteEndpoint =
      url.from.kind === 'me' ? { type: 'position', point: origin!, name: 'My location' } : { type: 'destination', destinationId: url.from.id };
    provider
      .getRoute(from, { type: 'destination', destinationId: url.to }, { accessible: url.accessible })
      .then((route) => {
        if (cancelled) return;
        setComputed({ key: routeKey, state: { status: 'ok', route } });
        try {
          sessionStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(route));
        } catch {
          // Storage unavailable; the route is still shown.
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const state: RouteState =
          e instanceof OutOfAreaError
            ? { status: 'error', chooseStart: true, message: `You seem to be away from campus (about ${formatDistance(e.distanceMetres)} from the nearest path). Choose a starting point.` }
            : e instanceof NoRouteError
              ? { status: 'error', message: e.message }
              : { status: 'error', message: `Couldn't plan this route. ${e instanceof Error ? e.message : ''}` };
        setComputed({ key: routeKey, state });
      });
    return () => {
      cancelled = true;
    };
    // origin and url are captured through routeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, provider]);

  const routeState: RouteState = useMemo(() => {
    if (!wantsRoute) return { status: 'idle' };
    if (url.from.kind === 'me' && !origin) {
      if (geo.status === 'idle' || geo.status === 'locating') return { status: 'loading', message: GEO_MESSAGES.locating };
      return { status: 'error', chooseStart: true, message: GEO_MESSAGES[geo.status === 'ok' ? 'error' : geo.status] };
    }
    if (!computed || computed.key !== routeKey) return { status: 'loading', message: 'Planning your route…' };
    return computed.state;
  }, [wantsRoute, url.from.kind, origin, geo.status, computed, routeKey]);

  const route = routeState.status === 'ok' ? routeState.route : null;
  const lastRoute = useMemo((): Route | null => {
    if (route) return route;
    try {
      const raw = sessionStorage.getItem(LAST_ROUTE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [route]);

  const retry = () => {
    if (url.from.kind === 'me') geo.request();
    setComputed(null);
  };

  return { routeState, route, lastRoute, needsLocation, retry };
}
