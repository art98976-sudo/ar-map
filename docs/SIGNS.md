# Calibration signs (item 8)

Five A5 signs, one at each main entrance and one at the Bus Hub. Scanning a sign with the phone's
own camera opens `https://stirling-welcome-ar.vercel.app/c/<sign id>`. The app then starts the
trip exactly there: the place (1.5 m in front of the sign) and the direction (the walker turns
round so the sign is behind them). AR starts from that, and camera tracking carries on from there,
so neither GPS nor the compass has to be right at the start. Then the walker picks where to go.

The Library and Campus Central share one door (into the Andrew Miller Building), so one sign
serves both.

## The signs

Print files: `docs/signs/sign-<id>.svg` (A5 portrait, 148 x 210 mm), or open
`/#/qr?marker=<id>` in the app and press Print. Print at 100%, on matt card or vinyl.

| Sign id | Name | Place id(s) | Spot (lat, lng: the door) | Sign faces | Code centre height | Where exactly |
|---|---|---|---|---|---|---|
| `cottrell-main` | Cottrell main entrance | `cottrell` | 56.144904, -3.920317 | 20° (N) | 1.4 m | Beside the main doors (the A3 entrance foyer), on the wall to the right as you face the doors. |
| `atrium` | Atrium entrance | `atrium` | 56.145956, -3.919276 | 91° (E) | 1.4 m | Beside the Atrium doors, on the wall to the right as you face the doors. |
| `andrew-miller-main` | Andrew Miller main entrance | `library`, `campus-central` | 56.145454, -3.919805 | 190° (S) | 1.4 m | The door into the Andrew Miller Building used for both the Library and Campus Central. On the wall to the right of the doors. |
| `pathfoot-main` | Pathfoot main entrance | `pathfoot` | 56.148705, -3.926991 | 194° (S) | 1.4 m | Beside the main doors, on the wall to the right as you face the doors. |
| `bus-hub` | Bus Hub | `bus-hub` | 56.143862, -3.921099 | — | 1.4 m | On the shelter end panel facing the footpath to campus. Facing direction to be measured on site. |

"Sign faces" is the compass direction (true north) the printed face points: straight out from the
wall. The numbers come from the MazeMap building centre to its door, so they are **estimates**.
The Bus Hub has none yet.

## Before printing: check each spot on site

1. Stand with your back flat against the wall where the sign will go. Hold a phone flat in front
   of you, top edge pointing straight ahead, away from the wall, and read the compass heading: that
   is "Sign faces".
2. If it differs from the table by more than 10°, put the measured value in `facingDeg` in
   `src/data/markers.json`. Also correct `lat`/`lng` if the sign goes more than 2 m from the door.
3. Set `"checked": true` for that sign, run `node tools/build-signs.mjs` to remake the print
   files, and deploy.
4. Mount the sign flat on the wall to the right of the doors (as you face them), with the centre
   of the QR code at the height in the table, nothing in front of it, and in daylight or lit at
   night. The arrow on the sign plays no part in the direction: only the wall it is on does.

## After mounting

Scan each sign with an iPhone and an Android phone. The app should open with the toast
"Starting at the … sign. Where to?" and the search open. Choose a place and press Go: the
camera screen says "Stand with your back to the … sign, facing …". The arrows should lie along the
path without any compass wave.

Data: `src/data/markers.json` · code: `src/route/markers.js`, `src/ui/sign.js` · print files:
`tools/build-signs.mjs`.
