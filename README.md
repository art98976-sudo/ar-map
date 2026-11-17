# Stirling Welcome AR

Browser-based augmented-reality wayfinding for the University of Stirling campus.
Pick a place, allow your location, and follow arrows on the ground to its main entrance.
No app to install.

Status: **Outdoor V1, Steps A–D**: destination search, GPS location, walking route, compass, arrows on the ground.

**A trip:** the home screen is the campus map. Tap a pin or search, then "Walk here in AR" on the card: the phone asks for motion, camera and location in that tap, waits for a fix reporting ±20 m accuracy or better, plans a route, and opens the camera. The compass provides an initial bearing; local camera tracking and walked-track matching can refine placement. GPS and indoor positioning remain uncertain, and actual alignment must be field-tested.

## Quick start

Needs Node.js 20 or newer.

```bash
npm install        # also copies the 8th Wall engine into public/external/xr
npm run dev        # http://localhost:5173 on this computer
```

### Test on your phone (HTTPS)

The camera only works on `https://` links. Two ways:

1. **Live, while you code:** `npm run dev:phone`
   Starts the dev server and a free Cloudflare tunnel, then prints a QR code.
   Scan it with the iPhone camera. Changes reload on the phone automatically.
   Needs `cloudflared` (`winget install Cloudflare.cloudflared`).
2. **Vercel preview:** push your branch. Vercel builds it and posts a preview link on the commit in GitHub.

**Field test:** add `fieldtest=1` to the address (for example `/#/?to=library&fieldtest=1`, then
"Walk here in AR"). The AR screen shows GPS accuracy, compass heading, distance from and along the
route and the arrow's bearing at the left, and three buttons at the right ("Arrow correct", "Arrow
wrong", "At a turn") that mark the log. It records one row a second, kept on the phone only (it
survives a reload). **Finish** shows a summary and copies the whole log as CSV.

**AR debug panel:** add `?debug=1` to the URL (before the `#`), to see a live overlay with a minimap of the route frame, then in AR tap **Debug** (top right) for GPS accuracy, compass heading, distance to the entrance and fps.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with live reload |
| `npm run dev:phone` | Dev server + HTTPS tunnel + QR code for your phone |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build on port 4310 |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright): desktop Chrome, Android Chrome, iPhone Safari |
| `npm run lint` | ESLint |
| `npm run check` | All of the above, in order |

First time running e2e tests: `npx playwright install chromium webkit`.

## How it is built

- **AR engine:** the [8th Wall](https://8thwall.org) Distributed Engine Binary (`@8thwall/engine-binary`).
  It gives world tracking (SLAM) and image targets on **iPhone Safari and Android Chrome**.
  iPhone Safari has no WebXR, so 8th Wall is the only free engine that does both on iPhone.
  The engine is self-hosted from this site and downloads only when the user taps **Start AR**.
- **3D:** Three.js (lazy-loaded with the AR screen).
- **Map and routes:** the University's MazeMap campus map (campus 2058) and its walking routes, used with the University's permission. If a MazeMap route goes indoors (GPS does not work there) or MazeMap is unreachable, an OpenStreetMap footpath network with A* is used instead ([src/route/footpaths.js](src/route/footpaths.js)).
- **Positioning:** GPS initializes and nudges progress along a route; the compass gives the initial bearing; 8th Wall world tracking supplies local motion; walked-track matching can correct the local route rotation and offset. AR is not absolutely visually positioned against the campus GLB.
- **Direction:** compass (iPhone `webkitCompassHeading`, Android `deviceorientationabsolute`), averaged over 3 s, rotates the AR world to real north.
- **App:** plain JavaScript modules and Vite. No framework.

```
src/
  main.js            app start, screen registration
  config.js          settings: campus id, URLs, tuning numbers, colours
  ar/                device check, permissions, engine, compass, trip, AR scene, arrows, pin
  geo/               GPS location, GPS <-> metres and angle maths
  route/             route planning, A*, footpaths, guidance, start point
  data/              destinations.json, footpaths.json, footpath-corrections.json
  map/               MazeMap loader, destinations, search, 3D campus model layer
  ui/                router, DOM helpers, icons, toast, screens/
  styles/            design tokens (Stirling brand palette), components, screens
public/
  brand/             University of Stirling logo (green and white)
  fonts/             Inter (self-hosted)
  data/              stirling_campus.glb (3D campus), room-centres.json (built from it)
scripts/             engine copy, phone tunnel, icon generator
tools/               find-entrances.mjs, build-footpaths.mjs, build-room-centres.mjs
tests/unit/          Vitest
tests/e2e/           Playwright
```

## Deploying (Vercel)

`vercel.json` holds the build settings, security headers and the camera/motion permissions policy.
Import the GitHub repository in Vercel with **Root Directory** left as the repository root.
Every push to a branch gets a preview URL.

## Licences and attribution

- **8th Wall XR Engine:** closed-source binary under the
  [XR Engine License Agreement](https://github.com/8thwall/engine/blob/main/LICENSE).
  The files in `public/external/xr` must stay **unmodified**. The copyright notice is at the top of `xr.js`,
  in `index.html`, and on the in-app About screen. Niantic Spatial said it would maintain the binary
  through March 2026, so it gets no further updates.
- **University of Stirling** name, logo and colours: used for this University project.
  Colours follow the [Brand Bank palette](https://www.stir.ac.uk/brand-bank/brand-assets/colour-palette/)
  (Heritage Green `#006938`).
- **MazeMap:** © MazeMap.
- **Backup footpaths:** © OpenStreetMap contributors, ODbL.
- **Three.js, qrcode:** MIT. **Inter:** SIL Open Font Licence 1.1.

## 3D campus model

The **3D** button on the map draws `public/data/stirling_campus.glb` over MazeMap (a Mapbox GL custom
layer with three.js). It downloads only the first time 3D is turned on. It shows the floor chosen in
MazeMap's floor bar, and colours the chosen room, found by its MazeMap poiId (the number at the end of
each room mesh's name). Floor heights and door positions in the model are estimates, not surveyed.

The GLB's `Outdoor` objects use a generic `outdoor` material; it does not reliably distinguish
pavement from grass, water, planting, or obstacles. Horizontal triangles alone are therefore not
safe evidence of a walkable path. The app keeps using its existing MazeMap and OpenStreetMap
pedestrian networks instead of manufacturing routes from those surfaces. The OSM import script
retains tagged widths, surfaces, one-way foot access, and wheelchair tags when available; the
checked-in network predates those attributes, so its missing values remain unknown until regenerated.

Open `/?debug=1#/geometry` (hidden without `?debug`) to inspect the campus OSM path graph and create separate manual corrections.
The editor can hide a wrongly mapped source segment, draw a path/stairs/ramp with width and
direction, move its nodes, and add entrances/navigation points. New path endpoints snap to nearby
mapped nodes within 3 m. New geometry is **excluded from routing until marked field-verified**. Save downloads
`footpath-corrections.json` and stores a local copy; reload the app to rebuild its cached graph for
local testing. Review the export and replace `src/data/footpath-corrections.json` to publish it. The original GLB and OSM source are
never modified. An entrance point is metadata, not a path connection: draw a verified path to it if
the entrance is not already connected.

**Alignment check:** open `/#/?debug=align`. The model is drawn at 50% over MazeMap's floor plan (a
slider changes that), a red dot marks the model's origin (56.1455, -3.92), and clicking the map shows
the point in lat/lon and in metres east/north of that origin.

In AR, the destination pin stands over the room's centre when the destination is a MazeMap room.
The route and arrival still use the entrance. The AR screen reads room centres from
`public/data/room-centres.json`, so it never downloads the model. After replacing the model, run:

```
node tools/build-room-centres.mjs
```

## Which way the AR arrow points

[src/route/arrow-direction.js](src/route/arrow-direction.js) works it out in four small steps:

1. `normaliseRoute(mazemapResponse)`: one ordered list of `{lat, lon, z}` points for the whole route.
2. `progressOnRoute(route, user, previous)`: the user's position projected on to the nearest route
   segment. Between updates it moves at most 5 m back and 25 m ahead, so GPS noise or another stretch
   of the same route passing nearby cannot throw it.
3. `lookAheadPoint(route, distanceAlong)`: the point 9 m further along the route (the destination
   near the end).
4. `arrowBearing(user, lookAheadPoint)`: degrees from north. On screen the arrow turns by this minus
   the phone's heading.

The arrow never points straight at the destination: it turns at each corner, and leads someone who
has wandered off the path back on to it. In AR, "the user" is where motion tracking puts the phone.

**When the arrow steps aside** ([src/route/trip-monitors.js](src/route/trip-monitors.js), numbers in
`CONFIDENCE`, `OFF_ROUTE` and `ARRIVAL` in [src/config.js](src/config.js)):

- **Finding your position:** GPS worse than 20 m, or the compass swinging more than 40° within 2 s
  while the phone itself is not turning, for 3 s: the arrow hides and the 2D map opens with "Finding
  your position. Follow the map for now." 3 s of good readings bring the arrow back. GPS only counts
  on a trip that follows GPS (not from a chosen door or pin), the compass only while it sets the direction.
- **Finding a new route:** more than 15 m from the route for 5 s in a row plans a new one from where
  the user is, at most once every 15 s.
- **You have arrived:** within 8 m of the destination (held for 1 s), the arrow hides and the card
  shows the place name.

**Test it on a laptop:** open `/#/?to=pathfoot&simulate=1` (any place id works, or pick one from the
search). A fake user walks the route at walking speed, from the starting point you chose, or a fixed
point by the loch. The green arrow is what AR would show and the orange dot is the point 9 m ahead.
The slider pushes the fake user up to 25 m off the route (past 15 m for 5 s: a new route). The GPS
accuracy slider and "Compass swinging" set off "Finding your position", and walking to the end
shows "You have arrived".

The route graph and AR alignment are not validated to survey-grade accuracy. AR placement uses GPS,
compass, and local camera tracking; it is not anchored to the GLB in the camera's world. GPS does not
identify a floor. Indoor floor transitions require MazeMap data, and new outdoor paths, entrances,
stairs, and ramps require field verification. Physical iPhone and Android field testing is required
before making accuracy or accessibility claims.

## Campus walking network (pilot)

One pre-generated, automatically checked walking network, inside and outside, for one pilot
building and route (`tools/network-pilot.json`: Pathfoot Front Car Park to Cottrell A3). The live
router, AR pose and arrows do not use it yet.

| Command | What it does |
|---|---|
| `npm run build:network` | Builds `src/data/campus-network.json`. MazeMap and Overpass answers are cached in `tools/.cache/` (2 requests a second, first run about an hour). `-- --offline` builds from the cache only |
| `npm run network:report` | Counts, generator errors and every check failure with node ids and coordinates |
| `npx vitest run tests/unit/network.test.js` | The six checks on the generated file |

- **Frame:** metres east (x) and north (y) of the campus model origin (56.1455, -3.92), MazeMap floor `z`
  (0 outdoors) and `heightM` from `src/data/floor-heights.json` (placeholders until measured).
- **Indoors:** MazeMap floor tiles (walls, doors, stairs, lifts, outlines, room and area shapes) and
  MazeMap routes between every pair of exterior doors, stairs, lifts and the pilot room, merged
  into one graph. A level change is a stair or lift only where MazeMap's route flags it.
- **Outdoors:** the OSM footpaths plus verified `footpath-corrections.json`. A door joins the nearest
  path within 5 m, otherwise it is an error. Unjoined doors get a *proposed* connection (MazeMap's own
  approach line) in `tools/network-proposed-corrections.json`: never routed; check it on site, then
  copy it into `footpath-corrections.json` with `verified: true`.
- **Viewer:** `/?debug=1#/geometry` → **Show network layer**: the network over MazeMap, one floor at a
  time, failures in red. `/#/geometry` is hidden without `?debug`.
- **Trip log:** with `?debug=1`, the AR debug panel's **Download trip log** saves one row a second
  (route source, start floor, position, campus x/y, heading, tracking, distance from the route,
  confidence) as JSON. Kept in memory only.

## Entrances

Every destination has a suggested main entrance. They are **not confirmed yet**: see [ENTRANCES.md](ENTRANCES.md).

## Field testing

Walk the three routes on [docs/field-test-sheet.md](docs/field-test-sheet.md) with one iPhone and one Android phone. Add `?fieldtest=1` to log every reading as a CSV, `?debug=1` for the status line, and `?simulate=1` on a laptop to walk a route with tracking-lost and floor-change buttons.

## Anonymous counts (/#/stats)

Trips started, AR started, line-up confirmed, arrived, ended early, tracking lost and re-routed, with phone and browser type only. To switch counting on, connect Upstash Redis in Vercel (Storage → Upstash, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`) and set `STATS_PASSCODE`. Without them the counts are dropped and /#/stats says so.

## Privacy

The camera feed is processed on the phone and is never uploaded. No sign-in and no personal data.

## /premium (redesign in progress)

`/#/premium` is the redesigned map, built beside the existing screens so they can be compared.
It restyles MazeMap's layers (paint and zoom ranges only), adds 3D buildings from MazeMap's
building outlines (height estimated at 3.8 m per floor), a sun with soft shadows, sky and haze,
and an architectural indoor plan. If a phone draws fewer than 45 frames a second while the map
moves, it turns off shadows, then haze, then blur ([src/premium/fps-guard.js](src/premium/fps-guard.js)).

**Aerial imagery and 3D terrain** need your own public Mapbox token: set `VITE_MAPBOX_TOKEN`
(in `.env.local`, and in Vercel's environment variables) and rebuild. Without it the map uses
the plan colours. Add `route=demo` (`/#/premium?route=demo`) to see the route style.
