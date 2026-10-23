# The University campus map (MazeMap)

The live site uses the University of Stirling's own campus map from MazeMap (campus **2058**). It
has every building, room and floor, MazeMap's indoor floor plans, and MazeMap's official indoor and
outdoor walking routes. The earlier Stirling AR prototype used the same campus.

The app's sample data is still available for development and tests (`MAP_PROVIDER=local`).

## What the app uses

| Feature | MazeMap service |
|---|---|
| Map with buildings and indoor floor plans | MazeMap JS API 2.2.1 (`api.mazemap.com/js/v2.2.1`), loaded in the browser |
| Search rooms, cafés, buildings, car parks | `search.mazemap.com/search/equery/` (campus 2058) |
| Place details, the room tapped on the map | `api.mazemap.com/api/pois/…` |
| Buildings and their floors | `api.mazemap.com/api/buildings/?campusid=2058` |
| Walking routes and written directions | `routing.mazemap.com/routing/path/` and `/directions/` (`hc=true` for step-free) |

These are the same services MazeMap's own JS API calls. MazeMap's routes and wording are
converted into the app's route format, so the AR app can read them too. Every MazeMap route is
checked against the route schema in tests.

## MazeMap's usage rules that the app follows

| Rule from MazeMap's guidelines | How the app follows it |
|---|---|
| No scraping or bulk downloading of data | Requests happen only on user actions: typing, tapping a room, or asking for a route. Nothing is stored in the repo. |
| Route requests are slow (1 to 5 s); request sparingly | While only "My location" moves, the same trip is requested at most once every 30 seconds. |
| Search: no automatic repeated calls | Search runs as the user types, after a short pause. |

## Settings

```bash
# web/.env.local, or Vercel → Project → Settings → Environment Variables
MAP_PROVIDER=mazemap      # or "local" for the sample data
MAZEMAP_CAMPUS_ID=2058
MAZEMAP_VIEW_TOKEN=       # only if the University makes the campus or floors private
MAZEMAP_AUTH_TOKEN=
```

Values are read at build time, so redeploy after changing them.

## Checks

- `npm test` checks the MazeMap conversions with made-up data in MazeMap's response shapes.
- `npm run test:live` runs a few real requests against campus 2058: search, buildings, floors and a
  step-free route, which must pass the route schema.
- `E2E_PROVIDER=mazemap npx playwright test` runs the real campus map on a phone-sized screen.

## Permission

The campus map is public on MazeMap and the prototype has used it before. Before any official or
wider launch, confirm with the University (Estates or Digital Services, who hold the MazeMap
contract) that a student-built app may use it. Also ask:

- Whether MazeMap's Customer API is needed for the AR app (for example, offline route data).
- Whether there are branding or attribution rules.
- Whether any private floors need a view token.
