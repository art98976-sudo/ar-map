# Stirling Campus Map (web)

Phase 1 of Stirling Campus XR: a mobile-first web map for the University of Stirling campus.
Search places, filter by type, get walking routes (including step-free routes), follow indoor
directions with floor changes, save places and share routes. Phase 2 will add AR navigation,
which reads the same route format.

**Live preview:** <https://stirling-campus-map.vercel.app>

The live site uses the **University's real campus map from MazeMap** (campus 2058): every
building, room and floor, indoor floor plans and official routes. See [docs/MAZEMAP.md](docs/MAZEMAP.md).
A built-in sample dataset is kept for development and tests (`MAP_PROVIDER=local`).

> Student project, not an official University service. The sample data in `public/data/` is
> approximate and hand-placed for development only; it is not official University or MazeMap data.

## Features

| Feature | Where |
|---|---|
| Search buildings, rooms, cafés, study spaces, sports, bus stops and car parks | Map tab |
| Filters: teaching rooms, food, study spaces, sports, accommodation, transport | Map tab |
| Destination card with Directions, Save and Floors | Map tab |
| Walking route with highlighted path, steps, time and distance | Navigate tab |
| Step-free route (avoids stairs and steps, uses ramps and lifts) | Navigate tab |
| Indoor view: MazeMap's floor plans with a floor selector; route parts on other floors fade; floor-change prompts | Map and Navigate |
| Tap a room on the map to open it | Map tab |
| Your location (asked for only when needed), with clear messages when it fails | Map and Navigate |
| Saved places (kept in this browser) | Saved tab |
| Share a route as a link | Navigate tab |
| Browse by category | Explore tab |
| AR navigation: arrows laid on the ground along the exact route (ground tracking with WebXR on Android; calibrated camera overlay on iPhone), turn arrows, current step, direction arrow, floor-change confirmation, off-route warning, arrival, "recalibrating" instead of wrong arrows, debug overlay; simulated walk for demos. See [docs/AR.md](docs/AR.md) | AR tab, or the AR button on a route |
| Route data download (the same JSON the AR view reads) | AR tab |
| Light and dark mode, phones from 360 px wide, desktop side panel | Everywhere |

## Run it

Needs Node.js 20.9 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

To open it on a phone on the same Wi-Fi, run `npx next dev -H 0.0.0.0` and use your computer's
IP address. Location only works over https (or on localhost), so test location on the deployed site.

## Test it

```bash
npm test               # unit tests (Vitest): routing, schema, data, providers, share links
npm run test:e2e       # end-to-end tests (Playwright) on a 360 px phone screen, sample data
npm run test:live      # a few real requests to MazeMap (campus 2058)
E2E_PROVIDER=mazemap npx playwright test   # end-to-end test on the real campus map
npm run typecheck
npm run lint
```

The first `test:e2e` run needs `npx playwright install chromium`. To test the live site (which
uses MazeMap) instead:
`E2E_PROVIDER=mazemap E2E_BASE_URL=https://stirling-campus-map.vercel.app npx playwright test`.

## Deploy (Vercel)

The project `stirling-campus-map` on Vercel builds from this GitHub repo with **Root Directory
`web`** and the Next.js framework preset. Pushing to the connected branch redeploys it.

To set it up from scratch:

1. In Vercel, choose **Add New → Project**, import `art98976-sudo/ar-map`.
2. Set **Root Directory** to `web`. Leave build settings on the Next.js defaults.
3. Add the environment variables `MAP_PROVIDER=mazemap` and `MAZEMAP_CAMPUS_ID=2058`. Deploy.

The GitHub Pages workflow in the repo root only publishes the older AR prototype and is not
affected by `web/`.

## Settings

Copy `.env.example` to `.env.local`. Values are read at build time.

| Variable | Meaning |
|---|---|
| `MAP_PROVIDER` | `mazemap` (the real campus map, used on the live site) or `local` (sample data, the default when unset). If MazeMap is chosen without a campus id, the app falls back to `local` and shows a warning. |
| `MAZEMAP_CAMPUS_ID` | MazeMap campus id. University of Stirling: `2058`. |
| `MAZEMAP_VIEW_TOKEN`, `MAZEMAP_AUTH_TOKEN` | Only if the University's campus needs them. |
| `NEXT_PUBLIC_BASEMAP_STYLE_URL`, `NEXT_PUBLIC_BASEMAP_STYLE_URL_DARK` | Optional MapLibre styles. Empty uses OpenFreeMap (free, no key). |

See [docs/MAZEMAP.md](docs/MAZEMAP.md) for how the MazeMap connection works and what to confirm with the University.

## How it fits together

```
web/
  public/data/                  sample data, served at /data
    campus/                     buildings, paths, entrances, places, areas (GeoJSON)
    indoor/cottrell.json        pilot building: 2 floors, rooms, corridors, stairs, lift
    schemas/route.schema.json   the shared route format (JSON Schema 2020-12)
    examples/route.example.json real router output: Library to a room in Cottrell, step-free
  scripts/
    generate-sample-data.mjs    single source for the sample data
    copy-maplibre-worker.mjs    serves MapLibre's worker file from public/vendor
  src/
    app/                        Next.js entry (renders the app in the browser)
    components/
      app/                      app shell (CampusApp), tab bar, place picker, floor control, credits
      map/                      MapView, plus its layers, data, camera helpers and styles
      ar/                       ArView, which wires together:
        engine/                   AR state, one step of the frame loop, debug text
        overlay/                  camera-overlay drawing (iPhone)
        xr/                       ground tracking with WebXR (Android)
        hooks/                    camera, sensors, wake lock, messages, idle fade
        ui/                       the on-screen controls
      search/ navigate/ destination/ explore/ saved/ ui/
    hooks/                      location, search, media queries, campus data, floors, route planning
    lib/
      types/                    Destination, Building, Floor, Route...
      providers/                MapProvider interface, LocalProvider, MazeMapProvider
      routing/                  walking graph, A*, turn-by-turn steps
      route/                    route validator, walking speeds, formatting
      state/                    share-link state, saved places
  tests/unit/                   Vitest
  e2e/                          Playwright
  docs/MAZEMAP.md               MazeMap access and integration notes
```

**Provider layer.** The UI only talks to the `MapProvider` interface:
`searchDestinations`, `getDestination`, `getBuildings`, `getFloors` and `getRoute`, plus optional
`getIndoorMap`, `getMapOverlay`, `getDestinationAt` and `baseMap`. `LocalProvider` reads the sample
data and draws it on an OpenFreeMap base map. `MazeMapProvider` uses MazeMap's services and has the
map show MazeMap's own campus map with indoor floors. `MAP_PROVIDER` picks one; the UI is the same.

**Routing.** Outdoor paths and the Cottrell corridors, stairs and lift form one walking graph. A*
finds the shortest path. Stairs and lifts carry a time cost, and step-free mode skips steps and
stairs. Endpoints can be buildings (through their entrances), rooms (through their doors), outdoor
places, or a raw position such as "My location", which snaps to the nearest path.

**Route format.** `src/lib/types/route.ts` and `public/data/schemas/route.schema.json` describe the
same thing. A route is an ordered list of steps: `walk`, `turn`, `enter-building`, `exit-building`,
`change-floor` or `arrive`. Each step has a location, the path walked, distance in metres and time
in seconds. Indoor points also carry `buildingId`, `floorId` and `level` (the z-level). Every route
the app produces is validated against the schema in tests.

**Share links.** The address bar holds the view, for example
`/?tab=navigate&from=building:library&to=room:cottrell-1-101&acc=1`. A link with "My location"
uses the location of the person who opens it.

## Editing the sample data

Edit the tables in `scripts/generate-sample-data.mjs` and run `npm run data:generate`. Paths are
links between named points, so connected paths always share coordinates. The tests check that the
network is connected, that entrances sit on it, and that Cottrell works with and without stairs.

## Credits

Campus map, floors and routes © MazeMap / University of Stirling. Sample-data base map ©
OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors. Map rendering by MapLibre GL JS
and MazeMap. Icons by Lucide.
