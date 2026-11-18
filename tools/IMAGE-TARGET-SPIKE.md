# Image targets + SLAM: the Phase 2 spike

Question: do 8th Wall image targets run alongside world tracking (SLAM, `scale: 'absolute'`) in
our distributed engine build, on iPhone and Android, well enough to re-centre the arrows within
0.5 m at a sign?

Page: `/spike/image-targets.html` (static, in `public/spike/`, not linked from the app).
Print the two test signs from `/spike/print.html` at 100%: A (feature-rich control, 18 cm wide)
and B (a plain wayfinding-style sign, 24 cm wide, landscape).

## Phone protocol (each phone: one iPhone in Safari, one Android in Chrome)

1. Tape A and B side by side on a wall at eye height, in a corridor with some texture.
2. Open the page, tap **Start camera**, and walk slowly for ~5 s until the readout says
   `SLAM NORMAL`. If it never does, stop: that is a result.
3. **Size**: stand 1 m from A, then 2 m, then 3 m. Note `size` (long side) against 0.18 m.
4. **Stability (the 0.5 m question)**: look at A, walk 10 m away down the corridor (signs out of
   view, `lost` goes up), turn round, walk back. Repeat 3 times. Read `re-detections` (how far the
   sign "moved" in the SLAM world each time it was found again) and `spread`.
5. Repeat 3-4 for B (the realistic sign). Note the furthest `from ... m` it was found at.
6. Repeat the whole run with `?phys=1` (sends the printed widths as `physicalWidthInMeters`), and
   once with `?moveable=0`.
7. **Download log** after each run and send the files back.

Pass for building the sign anchors: SLAM stays NORMAL with targets on; B is found from at least
2 m; reported size within ~10% of the print; re-detection jumps and spread under 0.5 m.

## What the desktop run showed (Chromium as a Pixel 7, fake camera video, software GL)

- The engine loads targets made locally with the official CLI (no 8th Wall cloud) and scans with
  world tracking on and `scale: 'absolute'`: `imageloading` -> `imagescanning`.
- Both A and B were found and tracked (`imagefound`, then ~150 `imageupdated`), with position,
  rotation and scale. B is a landscape (rotated) target.
- SLAM never initialised (a flat video with no motion sensors), so every metric number on desktop
  is meaningless: sizes of tens of metres, positions 100 m off. Accuracy needs a phone.
- `physicalWidthInMeters` (undocumented; present in the engine's code) made no difference there.
