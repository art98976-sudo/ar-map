# Stirling Campus AR (prototype)

A working concept prototype of an augmented-reality campus map for the University of Stirling.
It is a plain static website, so there is nothing to install and it runs on any modern phone or laptop.

**Live link:** GitHub Pages (the permanent URL will be added after the first deployment).

> Student concept prototype. Not an official University of Stirling product.
> Campus map, indoor floors and official routes come from the University's MazeMap campus map (campus 2058).
> Fallback map data © OpenStreetMap contributors.

## What it does

| Feature | Description |
|---|---|
| University campus map | The Map tab shows the University's own MazeMap campus map, with indoor floor plans and a floor switcher (bottom left). |
| Official routes | Routes come from the University's MazeMap wayfinder. They go inside buildings, through lifts and stairs, to the right entrance or room. |
| Official directions | **☰ Steps** lists the University map's own written directions, for example "Take the elevator up to floor 2". |
| Turn-by-turn | The banner shows the next instruction ("In 14 m, turn left"), the floor you are on, and the distance and time left. **🔊 Voice** reads them aloud. |
| Room search | Search finds the 17 highlight places and also any room on the University map: seminar rooms, lecture theatres, offices, toilets, cafés. |
| Floors follow you | When the route goes indoors, the map switches to the floor you are on. Route parts on other floors are faded. |
| AR ground arrows | In AR View, nearby route chevrons are projected onto the ground. Floating place labels and the HUD arrow are hidden. |
| Re-routing | In live mode, walking well off the route (25 m, or twice the GPS error) asks for a new route from where you are. |
| Smoothed GPS | A Kalman filter tracks position and walking speed, weighs every fix by its accuracy and ignores jumps you could not have walked. In tests it halved GPS error with no lag. |
| Footstep tracking | When GPS is weak or stale (indoors), the phone's accelerometer counts steps and moves you along the route. |
| Snap to path | When you are within GPS error of the route, your dot and the AR view sit on the path, like a car sat-nav. |
| GPS status | The top-right pill shows live accuracy (green ±10 m or better, amber ±25 m, red worse) and waits for a real GPS fix before routing. |
| Camera alignment | The AR view uses the camera field of view and phone tilt to project route chevrons toward the ground plane. |
| Compass help | ⚙ Calibrate lets you correct the compass and lens angle. 🧭 Align sets the compass from the path you are standing on. Without a compass, the heading comes from GPS or the route. |
| Screen stays on | Live mode keeps the screen awake while you navigate. |
| Fallback | If the University map cannot be reached, the page uses OpenStreetMap and its own built-in campus footpaths, so it still works. |
| Presentation demo | Works indoors with no GPS or camera: simulated campus view, drag to look around, and "Simulate walk" to show navigation end to end. |

## Where the University map works

The University map and its routes load from MazeMap's servers (api.mazemap.com, routing.mazemap.com, search.mazemap.com).

| How you open the page | Map you get |
|---|---|
| GitHub Pages or any other HTTPS host | University MazeMap map and official routes |
| The folder served from a local web server (use 127.0.0.1, not localhost) | University MazeMap map and official routes |
| The claude.ai preview link | OpenStreetMap fallback (the preview blocks outside map servers) |

Add `?osm` to the address to force the OpenStreetMap fallback.

## Running it for the presentation (laptop / projector)

1. Host the folder (see below) or serve it locally, and open it in Chrome or Edge. An internet connection is needed.
2. Click **Presentation demo**.
3. Suggested 2-minute demo flow:
   1. **Map tab**: show the University map. Zoom in on Campus Central to show the indoor floors.
   2. Search **library** and press **Take me there**. Open **☰ Steps** to show the official directions.
   3. Search a room, for example **seminar room 2**, to show indoor navigation to a room.
   4. Switch to **AR View** and press **Simulate walk**. The arrows on the ground guide you, through the lift and stairs, to "Arrived".
   5. Optional: press **Camera** to show the arrows over your laptop webcam.

Presenter shortcuts that skip the start screen:

```
index.html?demo                     map view
index.html?demo&tab=ar&nav=library  AR view, already navigating to the Library
index.html?demo&tab=ar&nav=castle   AR view, navigating to Airthrey Castle
```

Place ids for `nav=`: cottrell, logie, amb, library, atriumfood, union, pathfoot, iris, court, macrobert, sport, tennis, loch, castle, andrewstewart, pendreich, wallace.

## Running live AR on a phone (on campus)

Phones only allow camera, GPS and compass on **HTTPS** pages. After the first GitHub Pages deployment, open its HTTPS URL on your phone.

Open the link on your phone, tap **Live AR (on campus)**, allow camera, location and motion access, and hold the phone upright.
iPhone users must use Safari for the compass permission prompt.

Tips for the best accuracy:

- Start outdoors and wait until the pill turns green (±10 m or better). The first position is often rough.
- Hold the phone upright in portrait, at chest height.
- If the arrows point slightly off the real path, stand on a straight path, point the phone along it and tap **🧭 Align**.
- If the app says the compass is unsure, move the phone in a figure-8 a few times.
- Indoors, GPS is weak. The app then follows your footsteps along the route, so keep walking along it.

## Files

| File | What it holds |
|---|---|
| `index.html` | The page layout |
| `app.css` | All styling |
| `app-1-places.js` | The 17 highlight places (`POIS`) and distance helpers |
| `app-2-router.js` | Walking router, turn detection and the reader for MazeMap's official routes |
| `app-3-map.js` | App state, the MazeMap connection (`MM_TARGET`, routing, search) and the two map engines |
| `app-4-nav.js` | Search, place sheet, turn-by-turn navigation, directions list, voice |
| `app-5-ar.js` | AR camera model, labels, ground arrows, calibration, camera |
| `app-6-live.js` | GPS filter, footsteps, compass and tilt, main loop, start-up |
| `osm-1.js` … `osm-5.js` | Built-in OpenStreetMap campus paths for the fallback map and router |

## Editing places

All places live in the `POIS` list in `app-1-places.js`.
`MM_TARGET` in `app-3-map.js` sets where each place's official route ends (a MazeMap POI id, such as a building's main entrance or reception).
After editing, upload the changed files to the host again.

## Known limits of this prototype

- **University network filter.** If the campus network blocks the hosted page, try opening it on mobile data.
- **Permission.** This prototype reads the University's MazeMap data through MazeMap's public web API. Before any real launch, get agreement from the University (Information Services / Estates) and MazeMap.
- GPS does not work well indoors. Footstep tracking keeps you moving along the route, but it drifts over long indoor stretches. The written steps and floor numbers still apply.
- The live sensors were tested with simulated GPS, compass, motion and camera in a browser, not yet on a real phone on campus.
- The Wallace Monument is off campus. MazeMap gives a route there but no written directions, so the page makes its own turn instructions.
- GPS is accurate to roughly 5–15 m outdoors, so labels and arrows can drift slightly near buildings.
