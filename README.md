# Stirling Welcome AR

Browser-based augmented-reality wayfinding for the University of Stirling campus.
Pick a place, allow your location, and follow arrows on the ground to its main entrance.
No app to install.

Status: **Outdoor V1, Steps A–D**: destination search, GPS location, walking route, compass, arrows on the ground.

**A trip:** the home screen is the campus map. Tap a pin or search, then "Walk here in AR" on the card: the phone asks for motion, camera and location in that tap, GPS reaches ±20 m or better, the route is planned, and the camera opens with arrows on the ground. The compass keeps calibrating silently in the background, and map matching lays the walked track onto the route after 6 m, even turning it round if the compass had it backwards. Arrows stop 3 m past the next corner, so they never show through a building. Within 8 m of the entrance you get "You've arrived".

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
- **Map and routes:** the University's MazeMap campus map (campus 2058) and its walking routes, used with the University's permission. If a MazeMap route goes indoors (GPS does not work there) or MazeMap is unreachable, an OpenStreetMap footpath network with A* is used instead ([src/nav/footpaths.js](src/nav/footpaths.js)).
- **Direction:** compass (iPhone `webkitCompassHeading`, Android `deviceorientationabsolute`), averaged over 3 s, rotates the AR world to real north.
- **App:** plain JavaScript modules and Vite. No framework.

```
src/
  main.js            app start, screen registration
  config.js          settings: campus id, URLs, tuning numbers, colours
  ar/                device check, permissions, engine, compass, trip, AR scene, arrows, pin
  geo/               GPS location, GPS <-> metres and angle maths
  route/             route planning, A*, footpaths, guidance, start point
  data/              destinations.json (with entrances), footpaths.json
  map/               MazeMap loader, destinations, search, 3D campus model layer
  ui/                router, DOM helpers, icons, toast, screens/
  styles/            design tokens (Stirling brand palette), components, screens
public/
  brand/             University of Stirling logo (green and white)
  fonts/             General Sans (self-hosted)
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
- **Three.js, qrcode:** MIT. **General Sans:** ITF Free Font Licence.

## 3D campus model

The **3D** button on the map draws `public/data/stirling_campus.glb` over MazeMap (a Mapbox GL custom
layer with three.js). It downloads only the first time 3D is turned on. It shows the floor chosen in
MazeMap's floor bar, and colours the chosen room, found by its MazeMap poiId (the number at the end of
each room mesh's name). Floor heights and door positions in the model are estimates, not surveyed.

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

**Test it on a laptop:** open `/#/?to=pathfoot&simulate=1` (any place id works, or pick one from the
search). A fake user walks the route at walking speed, from the starting point you chose, or a fixed
point by the loch. The green arrow is what AR would show and the orange dot is the point 9 m ahead.
The slider pushes the fake user up to 20 m off the route.

## Entrances

Every destination has a suggested main entrance. They are **not confirmed yet**: see [ENTRANCES.md](ENTRANCES.md).

## Privacy

The camera feed is processed on the phone and is never uploaded. No sign-in and no personal data.
