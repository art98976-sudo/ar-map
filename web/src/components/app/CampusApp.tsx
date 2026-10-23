'use client';

import { ArrowLeft, Layers, LocateFixed, Navigation, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GEO_MESSAGES, useGeolocation } from '@/hooks/useGeolocation';
import { useDestination } from '@/hooks/useDestination';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSearch } from '@/hooks/useSearch';
import { NoRouteError, OutOfAreaError, getMapProvider, type MapOverlay } from '@/lib/providers';
import { haversine } from '@/lib/routing/geometry';
import { savedStore } from '@/lib/state/saved';
import { parseUrlState, routeShareUrl, serializeUrlState, type Tab, type UrlState } from '@/lib/state/urlState';
import type { Building, Destination, FilterCategory, Floor, IndoorMap, LatLng, RouteEndpoint, RouteStep } from '@/lib/types';
import { ArPanel } from '../ar/ArPanel';
import ArView from '../ar/ArView';
import { requestMotionPermission } from '@/lib/ar/orientation';
import { DestinationCard } from '../destination/DestinationCard';
import { ExplorePanel } from '../explore/ExplorePanel';
import MapView, { ALL_BUILDINGS, type IndoorViewState, type MapViewHandle, type Padding } from '../map/MapView';
import { RouteForm, RouteSheet, type RouteState } from '../navigate/NavigatePanel';
import { SavedPanel } from '../saved/SavedPanel';
import { FilterChips, ResultList, SearchBar } from '../search/Search';
import { Button, IconButton, Notice, Toast, cx } from '../ui/ui';
import { TabBar } from './TabBar';

const LAST_ROUTE_KEY = 'stirling-campus-map:last-route';
/** Recompute a "My location" route only after moving this far. */
const REROUTE_METRES = 25;

export default function CampusApp() {
  const { provider, warning } = useMemo(() => getMapProvider(), []);
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(window.location.search));
  const update = useCallback((patch: Partial<UrlState>) => setUrl((u) => ({ ...u, ...patch })), []);

  // Keep the address bar in step, so the current view can be shared or bookmarked.
  useEffect(() => {
    const next = serializeUrlState(url) || window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [url]);

  // ---------- data ----------
  const [overlay, setOverlay] = useState<MapOverlay | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([provider.getMapOverlay?.() ?? Promise.resolve(null), provider.getBuildings()])
      .then(([o, b]) => {
        if (cancelled) return;
        setOverlay(o);
        setBuildings(b);
        setLoadError(null);
        setDataLoaded(true);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [provider, attempt]);
  const buildingById = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  // ---------- environment ----------
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const savedIds = useSyncExternalStore(savedStore.subscribe, savedStore.getSnapshot, savedStore.getServerSnapshot);
  const geo = useGeolocation();
  const mapRef = useRef<MapViewHandle>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = setToast;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- search ----------
  const [query, setQuery] = useState('');
  const [cats, setCats] = useState<FilterCategory[]>([]);
  const search = useSearch(provider, query, cats, { enabled: url.tab === 'map' });
  const searching = url.tab === 'map' && search.results !== null;

  // ---------- selection & route ends ----------
  const selected = useDestination(provider, url.tab === 'map' ? url.dest : undefined);
  const fromDest = useDestination(provider, url.from.kind === 'destination' ? url.from.id : undefined);
  const toDest = useDestination(provider, url.to);

  // ---------- indoor view ----------
  // With MazeMap's map, one floor (z-level) is shown across the whole campus and floors are always on.
  const baseMap = provider.baseMap;
  const [indoorView, setIndoorViewRaw] = useState<IndoorViewState | null>(null);
  const setIndoorView = useCallback(
    (v: IndoorViewState | null) => {
      if (!baseMap) return setIndoorViewRaw(v);
      if (v) setIndoorViewRaw({ buildingId: ALL_BUILDINGS, level: v.level });
    },
    [baseMap],
  );
  const [campusFloors, setCampusFloors] = useState<Floor[]>([]);
  useEffect(() => {
    if (!baseMap || !buildings.length) return;
    let cancelled = false;
    Promise.all(buildings.map((b) => provider.getFloors(b.id).catch(() => [] as Floor[]))).then((lists) => {
      if (cancelled) return;
      const byLevel = new Map<number, Floor>();
      for (const fl of lists.flat()) if (!byLevel.has(fl.level)) byLevel.set(fl.level, fl);
      setCampusFloors([...byLevel.values()].sort((a, b) => a.level - b.level));
    });
    return () => {
      cancelled = true;
    };
  }, [baseMap, buildings, provider]);
  const [indoorMap, setIndoorMap] = useState<IndoorMap | null>(null);
  useEffect(() => {
    if (!indoorView || indoorMap?.buildingId === indoorView.buildingId || !provider.getIndoorMap) return;
    let cancelled = false;
    provider.getIndoorMap(indoorView.buildingId).then((m) => !cancelled && setIndoorMap(m));
    return () => {
      cancelled = true;
    };
  }, [indoorView, indoorMap, provider]);
  const hasIndoor = (buildingId?: string) => Boolean(buildingId && (baseMap || buildingById.get(buildingId)?.hasIndoorData));

  // ---------- picker (From / To) ----------
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerSearch = useSearch(provider, pickerQuery, [], { enabled: picker !== null, allowEmpty: true });
  const openPicker = (which: 'from' | 'to') => {
    setPickerQuery('');
    setPicker(which);
  };

  // ---------- routing ----------
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
            ? { status: 'error', chooseStart: true, message: `You seem to be away from campus (about ${formatKm(e.distanceMetres)} from the nearest path). Choose a starting point.` }
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
  const activeStep = route ? Math.min(url.step ?? 0, route.steps.length - 1) : 0;

  // Fit a new route into view.
  const fittedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!route || fittedRoute.current === route.id) return;
    fittedRoute.current = route.id;
    mapRef.current?.fitPoints(route.steps.flatMap((s) => s.path));
  }, [route]);

  // Follow the active step: show its floor and centre on it.
  const followStep = useCallback(
    (step: RouteStep) => {
      const p = step.location;
      if (p.buildingId !== undefined && p.level !== undefined && hasIndoor(p.buildingId)) {
        setIndoorView({ buildingId: p.buildingId, level: p.level });
      } else if (step.type !== 'arrive') {
        setIndoorView(null);
      }
      mapRef.current?.flyTo(p, p.level !== undefined ? 18.6 : 18);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildingById],
  );

  const goToStep = (i: number) => {
    if (!route) return;
    const idx = Math.max(0, Math.min(route.steps.length - 1, i));
    update({ step: idx || undefined });
    followStep(route.steps[idx]);
  };

  // A new route that starts or ends indoors shows that floor.
  const [focusedRoute, setFocusedRoute] = useState<string | null>(null);
  if (route && focusedRoute !== route.id) {
    setFocusedRoute(route.id);
    const end = route.steps.at(-1)!.location;
    const start = route.steps[0].location;
    const focus = start.buildingId !== undefined ? start : end.buildingId !== undefined ? end : null;
    if (focus?.buildingId && focus.level !== undefined && hasIndoor(focus.buildingId)) {
      setIndoorView({ buildingId: focus.buildingId, level: focus.level });
    }
  }

  // A place opened from a link: show its floor and centre on it once.
  const [shownDest, setShownDest] = useState<string | null>(null);
  if (selected && shownDest !== selected.id) {
    setShownDest(selected.id);
    if (selected.level !== undefined && selected.buildingId && hasIndoor(selected.buildingId)) {
      setIndoorView({ buildingId: selected.buildingId, level: selected.level });
    }
  }
  useEffect(() => {
    if (!selected) return;
    mapRef.current?.flyTo(selected.location, selected.level !== undefined ? 18.2 : selected.kind === 'building' ? 17.5 : 18);
    // Only when the place changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // ---------- actions ----------
  const select = (d: Destination) => {
    setQuery('');
    setCats([]);
    update({ tab: 'map', dest: d.id });
    if (d.level !== undefined && d.buildingId && hasIndoor(d.buildingId)) {
      setIndoorView({ buildingId: d.buildingId, level: d.level });
    } else if (indoorView && indoorView.buildingId !== d.buildingId) {
      setIndoorView(null);
    }
    if (d.id === url.dest) mapRef.current?.flyTo(d.location, d.level !== undefined ? 18.2 : d.kind === 'building' ? 17.5 : 18);
  };

  const directionsTo = (d: Destination) => {
    update({ tab: 'navigate', to: d.id, step: undefined, from: url.from.kind === 'destination' && url.from.id === d.id ? { kind: 'me' } : url.from });
  };

  const setTab = (tab: Tab) => {
    setPicker(null);
    update({ tab });
    if (tab === 'navigate' && !url.to) openPicker('to');
  };

  const share = async () => {
    const link = routeShareUrl(window.location.origin, url);
    const title = toDest ? `Walking route to ${toDest.name}` : 'Campus route';
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} on the Stirling campus map`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      showToast('Link copied');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') window.prompt('Copy this link', link);
    }
  };

  const locate = () => {
    if (geo.position) mapRef.current?.flyTo(geo.position, 18);
    else showToast(GEO_MESSAGES.locating);
    geo.request();
  };

  // Tell people when location fails after they asked for it.
  const [seenGeoStatus, setSeenGeoStatus] = useState(geo.status);
  if (seenGeoStatus !== geo.status) {
    setSeenGeoStatus(geo.status);
    if (geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error') setToast("Couldn't find your location");
  }
  // Centre on the first location fix (not while following a route).
  const centredOnFix = useRef(false);
  useEffect(() => {
    if (geo.status !== 'ok' || !geo.position || centredOnFix.current || needsLocation) return;
    centredOnFix.current = true;
    mapRef.current?.flyTo(geo.position, 18);
  }, [geo.status, geo.position, needsLocation]);

  // ---------- AR ----------
  const [ar, setAr] = useState<{ simulate: boolean } | null>(null);
  // Called straight from a tap: iPhone only shows the compass prompt then.
  const startAr = (opts: { simulate: boolean }) => {
    requestMotionPermission().finally(() => {
      if (!opts.simulate) geo.request();
      setAr(opts);
    });
  };

  // ---------- layout ----------
  const fullTab = url.tab === 'explore' || url.tab === 'saved' || url.tab === 'ar';
  const padding: Padding = desktop
    ? { top: 20, bottom: 20, left: 20, right: 60 }
    : {
        top: url.tab === 'navigate' ? 200 : 130,
        bottom: url.tab === 'navigate' ? 290 : selected ? 330 : 90,
        left: 16,
        right: 64,
      };
  const highlightIds = url.tab === 'map' && search.results ? search.results.map((d) => d.id) : null;
  const lastRoute = useMemo(() => {
    if (route) return route;
    try {
      const raw = sessionStorage.getItem(LAST_ROUTE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [route]);

  function pickDest(d: Destination) {
    if (picker === 'from') update({ from: { kind: 'destination', id: d.id }, step: undefined });
    else update({ to: d.id, step: undefined });
    setPicker(null);
  }

  const pickerView = picker && (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:flex-1">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <IconButton label="Back" onClick={() => setPicker(null)}>
          <ArrowLeft aria-hidden className="size-5" />
        </IconButton>
        <h2 className="font-semibold">{picker === 'from' ? 'Choose starting point' : 'Choose destination'}</h2>
      </div>
      <div className="space-y-3 overflow-y-auto p-3">
        <SearchBar
          value={pickerQuery}
          onChange={setPickerQuery}
          autoFocus
          label={picker === 'from' ? 'Search for a starting point' : 'Search for a destination'}
          placeholder={picker === 'from' ? 'Start from…' : 'Where to?'}
          onSubmit={() => pickerSearch.results?.[0] && pickDest(pickerSearch.results[0])}
        />
        <ResultList
          results={pickerSearch.results}
          loading={pickerSearch.loading}
          error={pickerSearch.error}
          query={pickerQuery}
          onPick={(d) => pickDest(d)}
          showMyLocation={picker === 'from'}
          onPickMyLocation={() => {
            update({ from: { kind: 'me' }, step: undefined });
            setPicker(null);
            geo.request();
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background lg:flex-row">
      {/* Panel: floating over the map on phones, a side panel on desktop */}
      <aside
        className={cx(
          'absolute inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col',
          'lg:pointer-events-auto lg:static lg:h-full lg:w-[420px] lg:shrink-0 lg:border-r lg:border-border lg:bg-surface',
          fullTab && !picker ? 'pointer-events-auto overflow-y-auto bg-background' : 'pointer-events-none',
        )}
      >
        <header className="hidden items-center gap-3 px-4 pt-4 pb-2 lg:flex">
          <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-teal text-lg font-bold text-on-accent">S</span>
          <div className="leading-tight">
            <h1 className="font-semibold">Stirling Campus Map</h1>
            <p className="text-xs text-muted">University of Stirling · student project</p>
          </div>
        </header>
        <TabBar tab={url.tab} onTab={setTab} variant="top" />

        <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
          {warning && (
            <div className="pointer-events-auto p-3 pb-0 lg:px-4">
              <Notice tone="warning">{warning}</Notice>
            </div>
          )}
          {loadError && (
            <div className="pointer-events-auto p-3 lg:px-4">
              <Notice tone="error" action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
                Couldn&apos;t load campus data. {loadError}
              </Notice>
            </div>
          )}

          {picker ? (
            pickerView
          ) : url.tab === 'map' ? (
            <>
              <div className="pointer-events-auto space-y-2 p-3 lg:p-4">
                <h1 className="sr-only lg:hidden">Stirling Campus Map</h1>
                <SearchBar value={query} onChange={setQuery} onSubmit={() => search.results?.[0] && select(search.results[0])} />
                <FilterChips value={cats} onChange={setCats} />
                {searching && (
                  <ResultList results={search.results} loading={search.loading} error={search.error} query={query} onPick={select} />
                )}
              </div>
              <div className="mt-auto space-y-2 p-3 lg:mt-0 lg:p-4 lg:pt-0">
                {!searching && selected && (
                  <div className="pointer-events-auto">
                    <DestinationCard
                      destination={selected}
                      saved={savedIds.includes(selected.id)}
                      hasIndoorMap={!baseMap && hasIndoor(selected.buildingId)}
                      onDirections={() => directionsTo(selected)}
                      onToggleSave={() => showToast(savedStore.toggle(selected.id) ? 'Saved' : 'Removed from saved')}
                      onIndoor={() => setIndoorView({ buildingId: selected.buildingId!, level: selected.level ?? 0 })}
                      onClose={() => update({ dest: undefined })}
                    />
                  </div>
                )}
                {!searching && !selected && (
                  <div className="pointer-events-auto flex justify-center lg:justify-start">
                    <Button onClick={() => setTab('navigate')} className="h-14 px-7 text-base shadow-lg">
                      <Navigation aria-hidden className="size-5" />
                      Start navigation
                    </Button>
                  </div>
                )}
                <SampleNote sample={provider.isSampleData} />
              </div>
            </>
          ) : url.tab === 'navigate' ? (
            <>
              <div className="pointer-events-auto p-3 lg:p-4">
                <RouteForm
                  from={url.from}
                  fromDest={fromDest}
                  toDest={toDest}
                  accessible={url.accessible}
                  onAccessible={(accessible) => update({ accessible, step: undefined })}
                  onPickFrom={() => openPicker('from')}
                  onPickTo={() => openPicker('to')}
                  onSwap={() => url.from.kind === 'destination' && update({ from: { kind: 'destination', id: url.to! }, to: url.from.id, step: undefined })}
                />
              </div>
              <div className="mt-auto space-y-2 p-3 lg:mt-0 lg:p-4 lg:pt-0">
                <div className="pointer-events-auto">
                  <RouteSheet
                    state={routeState}
                    activeStep={activeStep}
                    onStep={goToStep}
                    onShare={share}
                    onRetry={() => {
                      if (url.from.kind === 'me') geo.request();
                      setComputed(null);
                    }}
                    onChooseStart={() => openPicker('from')}
                    onAr={() => startAr({ simulate: false })}
                    onShowFloor={(s) => {
                      const fc = s.floorChange!;
                      if (s.location.buildingId) setIndoorView({ buildingId: s.location.buildingId, level: fc.toLevel });
                    }}
                  />
                </div>
                {!route && routeState.status === 'idle' && (
                  <p className="pointer-events-auto rounded-xl bg-surface/95 p-3 text-sm text-muted shadow">Choose a destination to see walking directions.</p>
                )}
                <SampleNote sample={provider.isSampleData} />
              </div>
            </>
          ) : url.tab === 'explore' ? (
            <ExplorePanel provider={provider} onPick={select} />
          ) : url.tab === 'saved' ? (
            <SavedPanel provider={provider} savedIds={savedIds} onPick={select} onDirections={directionsTo} />
          ) : (
            <ArPanel route={lastRoute} onStart={startAr} onPlanRoute={() => setTab('navigate')} />
          )}
        </div>

        <footer className="hidden border-t border-border px-4 py-3 text-xs text-muted lg:block">
          {provider.isSampleData ? (
            <>
              <strong className="font-semibold text-foreground">Sample data.</strong> Positions are approximate and hand-placed for
              development. Not official University of Stirling or MazeMap data. Student project, not an official University service.
              Base map © OpenFreeMap, © OpenStreetMap contributors.
            </>
          ) : (
            <>
              <strong className="font-semibold text-foreground">University campus map by MazeMap.</strong> Buildings, rooms, floors and
              routes come from the University of Stirling&apos;s MazeMap campus. Student project, not an official University service.
            </>
          )}
        </footer>
      </aside>

      {/* Map */}
      <div className="relative mb-[calc(4rem+env(safe-area-inset-bottom))] min-h-0 flex-1 lg:mb-0">
        <MapView
          ref={mapRef}
          overlay={overlay}
          indoorMap={indoorMap}
          indoorView={indoorView}
          selected={url.tab === 'map' ? selected : null}
          highlightIds={highlightIds}
          route={url.tab === 'navigate' || url.tab === 'map' ? route : null}
          activeStep={url.tab === 'navigate' ? activeStep : null}
          user={geo.position ? { position: geo.position, accuracy: geo.accuracy } : null}
          dark={dark}
          padding={padding}
          onSelect={(id) => {
            if (url.tab !== 'map') return;
            provider.getDestination(id).then((d) => d && select(d));
          }}
          onStatus={(s, msg) => setMapError(s === 'error' ? msg ?? 'Map failed to load' : null)}
          baseMap={baseMap}
          onMapTap={(point, level) => {
            if (url.tab !== 'map' || !provider.getDestinationAt) return;
            provider.getDestinationAt(point, level).then((d) => d && select(d));
          }}
          onZLevel={(level) => setIndoorViewRaw((v) => (v?.level === level ? v : { buildingId: ALL_BUILDINGS, level }))}
        />

        {!fullTab && (
          <div className={cx('absolute right-3 z-10 flex flex-col items-end gap-2 lg:top-28', url.tab === 'navigate' ? 'top-56' : 'top-32')}>
            {baseMap && indoorView && campusFloors.length > 0 && (
              <FloorControl
                buildingName="Campus"
                floors={campusFloors}
                level={indoorView.level}
                onLevel={(level) => setIndoorView({ buildingId: ALL_BUILDINGS, level })}
              />
            )}
            {!baseMap && indoorView && indoorMap && indoorMap.buildingId === indoorView.buildingId && (
              <FloorControl
                buildingName={buildingById.get(indoorView.buildingId)?.shortName ?? buildingById.get(indoorView.buildingId)?.name ?? ''}
                floors={indoorMap.floors}
                level={indoorView.level}
                onLevel={(level) => setIndoorView({ ...indoorView, level })}
                onClose={() => setIndoorView(null)}
              />
            )}
            {!baseMap && !indoorView && url.tab === 'map' && selected && hasIndoor(selected.buildingId) && (
              <IconButton label="Show floors" onClick={() => setIndoorView({ buildingId: selected.buildingId!, level: selected.level ?? 0 })} className="bg-surface shadow-md">
                <Layers aria-hidden className="size-5" />
              </IconButton>
            )}
            <IconButton label="Show my location" onClick={locate} className={cx('bg-surface shadow-md', geo.status === 'ok' && 'text-teal')}>
              <LocateFixed aria-hidden className="size-5" />
            </IconButton>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 grid place-items-center bg-background/90 p-4">
            <Notice tone="error" action={<Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>}>
              Couldn&apos;t load the map. {mapError}
            </Notice>
          </div>
        )}
        {!dataLoaded && !loadError && !mapError && (
          <p role="status" className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface px-4 py-2 text-sm text-muted shadow">
            Loading campus map…
          </p>
        )}
      </div>

      <TabBar tab={url.tab} onTab={setTab} variant="bottom" />
      {ar && (route ?? lastRoute) && (
        <ArView
          route={(route ?? lastRoute)!}
          simulate={ar.simulate}
          geo={{ status: geo.status, position: geo.position, accuracy: geo.accuracy, request: geo.request }}
          onExit={() => setAr(null)}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

function FloorControl({
  buildingName,
  floors,
  level,
  onLevel,
  onClose,
}: {
  buildingName: string;
  floors: { id: string; level: number; name: string }[];
  level: number;
  onLevel(l: number): void;
  /** Omitted when floors cannot be turned off (MazeMap's map). */
  onClose?(): void;
}) {
  return (
    <div role="group" aria-label={`${buildingName} floors`} className="w-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      <div className="flex items-center justify-between pl-2">
        <span className="truncate text-xs font-semibold">{buildingName}</span>
        {onClose ? (
          <button type="button" aria-label="Close indoor map" onClick={onClose} className="grid size-9 place-items-center text-muted hover:text-foreground">
            <X aria-hidden className="size-4" />
          </button>
        ) : (
          <span className="h-9" />
        )}
      </div>
      {/* Many floors (MazeMap campus): scroll instead of covering the panels. */}
      <div className="max-h-[8.25rem] overflow-y-auto lg:max-h-[22rem]">
      {[...floors].reverse().map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={f.level === level}
          onClick={() => onLevel(f.level)}
          className={cx(
            'block min-h-11 w-full border-t border-border px-2 text-sm font-medium',
            f.level === level ? 'bg-teal text-on-accent' : 'hover:bg-surface-muted',
          )}
        >
          {f.name}
        </button>
      ))}
      </div>
    </div>
  );
}

function SampleNote({ sample }: { sample: boolean }) {
  if (!sample) {
    return (
      <p className="pointer-events-auto mx-auto w-fit rounded-full bg-surface px-3 py-1 text-center text-[11px] text-muted shadow-sm lg:hidden">
        University campus map by MazeMap · student project, not an official service
      </p>
    );
  }
  return (
    <p className="pointer-events-auto mx-auto w-fit rounded-full bg-surface px-3 py-1 text-center text-[11px] text-muted shadow-sm lg:hidden">
      Sample data · approximate, not official · Map{' '}
      <a className="underline" href="https://openfreemap.org" target="_blank" rel="noreferrer">© OpenFreeMap</a>{' '}
      <a className="underline" href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>{' '}
      <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </p>
  );
}

function formatKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
