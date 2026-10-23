# Stirling Campus Map (web)

Phase 1 of Stirling Campus XR: a mobile-first web map for the University of Stirling campus.
It will offer search, filters, walking routes (including step-free routes), indoor maps,
saved places and share links. Later phases add AR navigation, which will read the same route format.

> **Sample data only.** Everything in `public/data/` is approximate and hand-placed for
> development. It is not official University of Stirling or MazeMap data and must not be used
> for real navigation. Student project, not an official University service.

## Status

| Step | What | State |
|---|---|---|
| 1 | Setup, provider interface, route schema, sample data, plain map | Done |
| 2 | Path graph and A* routing, accessible option | Next |
| 3 | Map screen, search, filters, destination card, location | |
| 4 | Navigation screen, turn-by-turn, share link | |
| 5 | Indoor view with floor changes | |
| 6 | Explore, Saved, AR placeholder, states, Playwright test, deploy | |
| 7 | MazeMap provider | |

## Run it

Needs Node.js 20.9 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Other commands:

```bash
npm test               # unit tests (Vitest)
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm run build          # production build
npm run data:generate  # rebuild public/data from scripts/generate-sample-data.mjs
```

## Settings

Copy `.env.example` to `.env.local`. Values are read at build time.

| Variable | Meaning |
|---|---|
| `MAP_PROVIDER` | `local` (default, sample data) or `mazemap`. If MazeMap is not configured, the app falls back to `local`. |
| `MAZEMAP_CAMPUS_ID` | MazeMap campus id. Must come from the University. Placeholder: `TODO`. |
| `NEXT_PUBLIC_BASEMAP_STYLE_URL` | Optional MapLibre style URL. Empty uses OpenStreetMap raster tiles, which are fine for development but should be swapped for a hosted tile service before public launch. |

## How it fits together

```
web/
  public/data/                  sample data, served at /data
    campus/                     buildings, paths, entrances, places, areas (GeoJSON)
    indoor/cottrell.json        pilot building: 2 floors, rooms, corridors, stairs, lift
    schemas/route.schema.json   the shared route format (JSON Schema 2020-12)
    examples/route.example.json example route, Library to a room in Cottrell
  scripts/
    generate-sample-data.mjs    single source for the sample data
    copy-maplibre-worker.mjs    serves MapLibre's worker file from public/vendor
  src/
    app/                        Next.js pages
    components/map/             map view
    lib/
      types/                    Destination, Building, Floor, Route...
      providers/                MapProvider interface, LocalProvider, MazeMapProvider
      route/                    route validator, walking speed, formatting
      data/                     data loading and sample file shapes
      geo/                      Turf.js helpers
  tests/unit/                   Vitest tests
```

**Provider layer.** The UI only talks to the `MapProvider` interface in
`src/lib/providers/MapProvider.ts`: `searchDestinations`, `getDestination`, `getBuildings`,
`getFloors` and `getRoute`. `LocalProvider` reads the sample data. `MazeMapProvider` is a
switched-off placeholder until the University grants access.

**Route format.** `src/lib/types/route.ts` and `public/data/schemas/route.schema.json` describe the
same thing. A route is an ordered list of steps (`walk`, `turn`, `enter-building`, `exit-building`,
`change-floor`, `arrive`). Each step has a location, the path walked, distance in metres and time in
seconds. Indoor points also carry `buildingId`, `floorId` and `level` (z-level, 0 is the ground floor).
`validateRoute()` checks a route against the schema plus ordering and total rules.

## Editing the sample data

Edit the tables in `scripts/generate-sample-data.mjs` and run `npm run data:generate`.
Paths are defined as links between named points, so connected paths always share coordinates.
The tests in `tests/unit/sample-data.test.ts` check that the path network is connected, entrances
sit on it, and the Cottrell indoor graph works with and without stairs.

## Credits

Base map © OpenStreetMap contributors. Map rendering by MapLibre GL JS.
