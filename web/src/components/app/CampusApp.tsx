'use client';

/**
 * The whole campus map app: the tab panels, the map, and AR. The address bar holds the state
 * (tab, place, route), so any view can be shared or bookmarked.
 *
 * Data, floors and routes come from hooks in src/hooks (useCampusData, useIndoorView, useRoutePlanning).
 */
import { Layers, LocateFixed, Navigation } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useCampusData } from '@/hooks/useCampusData';
import { useDestination } from '@/hooks/useDestination';
import { GEO_MESSAGES, useGeolocation } from '@/hooks/useGeolocation';
import { useIndoorView } from '@/hooks/useIndoorView';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRoutePlanning } from '@/hooks/useRoutePlanning';
import { useSearch } from '@/hooks/useSearch';
import { requestMotionPermission } from '@/lib/ar/orientation';
import { getMapProvider } from '@/lib/providers';
import { markOnboardingSeen, onboardingSeen } from '@/lib/state/onboarding';
import { savedStore } from '@/lib/state/saved';
import { parseUrlState, routeShareUrl, serializeUrlState, type Tab, type UrlState } from '@/lib/state/urlState';
import type { Destination, FilterCategory, RouteStep } from '@/lib/types';
import { ArPanel } from '../ar/ArPanel';
import ArView from '../ar/ArView';
import { DestinationCard } from '../destination/DestinationCard';
import { ExplorePanel } from '../explore/ExplorePanel';
import { Onboarding } from '../onboarding/Onboarding';
import MapView from '../map/MapView';
import { ALL_BUILDINGS, type MapViewHandle, type Padding } from '../map/types';
import { RouteForm, RouteSheet } from '../navigate/NavigatePanel';
import { SavedPanel } from '../saved/SavedPanel';
import { FilterChips, ResultList, SearchBar } from '../search/Search';
import { Button, IconButton, Notice, Toast, cx } from '../ui/ui';
import { FloorControl } from './FloorControl';
import { PlacePicker } from './PlacePicker';
import { TabBar } from './TabBar';

const TOAST_MS = 3500;

export default function CampusApp() {
  const { provider, warning } = useMemo(() => getMapProvider(), []);
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(window.location.search));
  const update = useCallback((patch: Partial<UrlState>) => setUrl((u) => ({ ...u, ...patch })), []);

  // Keep the address bar in step, so the current view can be shared or bookmarked.
  useEffect(() => {
    const next = serializeUrlState(url) || window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [url]);

  // ---------- data and environment ----------
  const data = useCampusData(provider);
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const savedIds = useSyncExternalStore(savedStore.subscribe, savedStore.getSnapshot, savedStore.getServerSnapshot);
  const geo = useGeolocation();
  const mapRef = useRef<MapViewHandle>(null);
  // First open only: the short tutorial (remembered in the browser once seen or skipped).
  const [tutorial, setTutorial] = useState(() => !onboardingSeen());
  const [mapError, setMapError] = useState<string | null>(null);
  const [toast, showToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- search, selection and route ends ----------
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Bumped to put the cursor in the search box once it is on screen (e.g. after arriving in AR).
  const [focusSearch, setFocusSearch] = useState(0);
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);
  const [cats, setCats] = useState<FilterCategory[]>([]);
  const search = useSearch(provider, query, cats, { enabled: url.tab === 'map' });
  const searching = url.tab === 'map' && search.results !== null;
  const selected = useDestination(provider, url.tab === 'map' ? url.dest : undefined);
  const fromDest = useDestination(provider, url.from.kind === 'destination' ? url.from.id : undefined);
  const toDest = useDestination(provider, url.to);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  // ---------- floors and route ----------
  const baseMap = provider.baseMap;
  const { indoorView, setIndoorView, onMapLevel, campusFloors, indoorMap, hasIndoor } = useIndoorView(provider, data.buildings, data.buildingById);
  const { routeState, route, lastRoute, needsLocation, retry } = useRoutePlanning(provider, url, geo);
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
    [hasIndoor, setIndoorView],
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

  // ---------- location ----------
  const locate = () => {
    if (geo.position) mapRef.current?.flyTo(geo.position, 18);
    else showToast(GEO_MESSAGES.locating);
    geo.request();
  };

  // Tell people when location fails after they asked for it.
  const [seenGeoStatus, setSeenGeoStatus] = useState(geo.status);
  if (seenGeoStatus !== geo.status) {
    setSeenGeoStatus(geo.status);
    if (geo.status === 'denied' || geo.status === 'unavailable' || geo.status === 'error') showToast("Couldn't find your location");
  }
  // Centre on the first location fix (not while following a route).
  const centredOnFix = useRef(false);
  useEffect(() => {
    if (geo.status !== 'ok' || !geo.position || centredOnFix.current || needsLocation) return;
    centredOnFix.current = true;
    mapRef.current?.flyTo(geo.position, 18);
  }, [geo.status, geo.position, needsLocation]);

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
    if (tab === 'navigate' && !url.to) setPicker('to');
  };

  const pickPlace = (d: Destination) => {
    if (picker === 'from') update({ from: { kind: 'destination', id: d.id }, step: undefined });
    else update({ to: d.id, step: undefined });
    setPicker(null);
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

  // ---------- AR ----------
  const [ar, setAr] = useState<{ simulate: boolean } | null>(null);
  // Called straight from a tap: iPhone only shows the compass prompt then.
  const startAr = (opts: { simulate: boolean }) => {
    requestMotionPermission().finally(() => {
      if (!opts.simulate) geo.request();
      setAr(opts);
    });
  };
  const arRoute = route ?? lastRoute;

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
  const shownBuilding = indoorView ? data.buildingById.get(indoorView.buildingId) : undefined;

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
          <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-teal text-lg font-bold text-on-accent">
            S
          </span>
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
          {data.error && (
            <div className="pointer-events-auto p-3 lg:px-4">
              <Notice tone="error" action={<Button variant="secondary" onClick={data.retry}>Try again</Button>}>
                Couldn&apos;t load campus data. {data.error}
              </Notice>
            </div>
          )}

          {picker ? (
            <PlacePicker
              which={picker}
              provider={provider}
              onBack={() => setPicker(null)}
              onPick={pickPlace}
              onPickMyLocation={() => {
                update({ from: { kind: 'me' }, step: undefined });
                setPicker(null);
                geo.request();
              }}
            />
          ) : url.tab === 'map' ? (
            <>
              <div className="pointer-events-auto space-y-2 p-3 lg:p-4">
                <h1 className="sr-only lg:hidden">Stirling Campus Map</h1>
                <SearchBar inputRef={searchRef} value={query} onChange={setQuery} onSubmit={() => search.results?.[0] && select(search.results[0])} />
                <FilterChips value={cats} onChange={setCats} />
                {searching && <ResultList results={search.results} loading={search.loading} error={search.error} query={query} onPick={select} />}
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
                  onPickFrom={() => setPicker('from')}
                  onPickTo={() => setPicker('to')}
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
                    onRetry={retry}
                    onChooseStart={() => setPicker('from')}
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

      </aside>

      {/* Map */}
      <div className="relative mb-[calc(4rem+env(safe-area-inset-bottom))] min-h-0 flex-1 lg:mb-0">
        <MapView
          ref={mapRef}
          overlay={data.overlay}
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
          onStatus={(s, msg) => setMapError(s === 'error' ? (msg ?? 'Map failed to load') : null)}
          baseMap={baseMap}
          onMapTap={(point, level) => {
            if (url.tab !== 'map' || !provider.getDestinationAt) return;
            provider.getDestinationAt(point, level).then((d) => d && select(d));
          }}
          onZLevel={onMapLevel}
        />

        {/* Floors and "my location", beside the map */}
        {!fullTab && (
          <div className={cx('absolute right-3 z-10 flex flex-col items-end gap-2 lg:top-28', url.tab === 'navigate' ? 'top-56' : 'top-32')}>
            {baseMap && indoorView && campusFloors.length > 0 && (
              <FloorControl buildingName="Campus" floors={campusFloors} level={indoorView.level} onLevel={(level) => setIndoorView({ buildingId: ALL_BUILDINGS, level })} />
            )}
            {!baseMap && indoorView && indoorMap && indoorMap.buildingId === indoorView.buildingId && (
              <FloorControl
                buildingName={shownBuilding?.shortName ?? shownBuilding?.name ?? ''}
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
        {!data.loaded && !data.error && !mapError && (
          <p role="status" className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface px-4 py-2 text-sm text-muted shadow">
            Loading campus map…
          </p>
        )}
      </div>

      <TabBar tab={url.tab} onTab={setTab} variant="bottom" />
      {ar && arRoute && (
        <ArView
          route={arRoute}
          simulate={ar.simulate}
          geo={{ status: geo.status, position: geo.position, accuracy: geo.accuracy, request: geo.request }}
          onExit={() => setAr(null)}
          onShowMap={() => {
            setAr(null);
            update({ tab: 'navigate' });
          }}
          onNavigateElsewhere={() => {
            setAr(null);
            setPicker(null);
            setQuery('');
            setCats([]);
            update({ tab: 'map', dest: undefined });
            setFocusSearch((n) => n + 1);
          }}
        />
      )}
      <Toast message={toast} />
      {tutorial && (
        <Onboarding
          onClose={() => {
            markOnboardingSeen();
            setTutorial(false);
          }}
        />
      )}
    </div>
  );
}
