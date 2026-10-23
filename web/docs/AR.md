# AR navigation: how the arrows are placed

## Why the arrows used to float

The AR view did not know where the real ground was. It drew every arrow on an imagined, perfectly
flat floor exactly 1.5 m below the phone, as far as 22 m ahead. Four things made arrows look like
they hovered:

- **Slopes.** Where the path goes downhill (for example, towards the loch), the real ground is
  lower than the imagined floor, so arrows hung above it.
- **Far arrows near the horizon.** At 22 m an arrow is under 4° below the horizon. There, a 1° tilt
  error, the guessed lens angle or a different holding height moves it a long way. Distant arrows
  looked like they hung in the air.
- **Compass and GPS errors.** These shifted or rotated the route off the path.
- **The arrow's drop shadow.** It was offset 2 px downwards, which made each arrow look raised.

## How it works now

There are two modes. The app picks the best one the phone supports.

| | Ground tracking (WebXR) | Camera overlay |
|---|---|---|
| Phones | Android with Chrome and ARCore | iPhone (Safari has no WebXR AR), and any phone without WebXR |
| Where the ground is | Measured: hit tests against real surfaces (`local-floor` where available). The median of recent flat hits ignores benches and walls. | A flat plane at the phone's calibrated height. Calibrate once with **Ground**: tap the ground about 3 steps ahead. |
| Arrow height | 1.5 cm above the measured ground | On the calibrated plane, only within about 13 m, so never near the horizon |
| Stability | AR tracking moves the arrows as you walk. GPS only nudges the route if it drifts more than about 5 m. The compass sets the direction once, then follows it slowly. | GPS position snapped to the route; compass heading |
| When unsure | Arrows hidden, with a message: tracking lost, ground not found, compass calibrating | Arrows hidden, with a message: no compass, weak GPS (over 30 m), compass needs calibration |

In both modes:

- **Route:** arrows are spaced every 2.5 m along the exact route polyline, the same one the 2D map
  draws. A teal turn arrow sits just past each sharp turn.
- **Arrows:** they point along the direction of travel, smoothed over 3 m so curves don't wobble.
  They are flat painted markings with a soft shadow centred under them, and fade with distance.
- **Conversion:** map ↔ AR conversion happens in one place (`src/lib/ar/alignment.ts`) and is unit
  tested, as are heading, placement and ground estimation.

**Debug overlay:** use the bug button in AR, or add `?ardebug=1` to the address. It shows the raw
route, the arrow anchors, the horizon and the tracking state: pose, ground height, compass offset,
GPS accuracy and fps.

## Not done (needs native AR or more data)

- **Occlusion** (arrows hidden behind people) needs depth data. Browsers do not reliably offer it,
  so it is not used.
- **Slopes in camera-overlay mode** are only handled by keeping arrows close. Real ground detection
  on iPhone would need a native ARKit app or App Clip.
- **Indoors**, GPS cannot tell floors apart. You confirm floor changes with a tap, and ground
  tracking then measures the new floor again.

## Test checklist on a real phone

Test with an Android phone in Chrome (ground tracking) and an iPhone in Safari (camera overlay). Use
mobile data, because the campus Wi-Fi currently blocks the site.

1. **Straight path** (for example, the main walkway). Arrows lie flat on the path and stay put as
   you walk. They don't slide, float or sink.
2. **Sharp corner or junction.** The teal turn arrow sits just past the corner and points into the
   new path. The arrows don't cut across grass or buildings.
3. **Slope** (the paths down towards the loch). On Android, the arrows stay on the sloping ground.
   On iPhone, the nearest arrows stay on the ground and none appear far ahead.
4. **Steps.** On a step-free route there are none. Otherwise, arrows near steps don't hang in the air.
5. **Phone tilt and height.** Hold the phone low, then high, then tilted down. On iPhone, tap
   **Ground** once and check the arrows still sit on the ground.
6. **Compass.** If the arrows point beside the path, stand on the path, face along it and tap
   **Align**. They should line up.
7. **Weak tracking.** Cover the camera, spin quickly, or stand somewhere with poor GPS. The arrows
   disappear and a message explains why. They never jump to wrong places.
8. **Lighting.** Check in bright sun, overcast weather and indoor light. On Android, ground tracking
   needs some texture on the ground. Plain shiny floors can be slow to detect.
9. **Matches the map.** Compare with the Navigate tab: the AR arrows follow the same route.

Turn on the debug overlay if something looks wrong. A screenshot of it shows which part (ground,
compass, GPS) is off.
