# Content security policy

The policy is set in `vercel.json` (header `Content-Security-Policy`). The preview server
(`vite.config.js`) sends the same header, so the browser tests run under it. JSON cannot hold
comments, so the reasons for the less obvious sources live here.

## `script-src 'unsafe-eval'`: needed by MazeMap JS API v2.2.6

**Dependency:** `https://api.mazemap.com/js/v2.2.6/mazemap.min.js` (MazeMap, with Mapbox GL inside).

**Why:** the MazeMap bundle builds functions from strings at run time (`new Function(...)`, for
example in its bundled rbush spatial index). Without `'unsafe-eval'` the browser blocks it and the
map never loads.

**How we know (November 2026):** the app was run with the current policy minus `'unsafe-eval'`:

- Home map (desktop Chrome): the map did not load; the violation was
  `script-src eval https://api.mazemap.com/js/v2.2.6/mazemap.min.js`.
- AR screen with the 8th Wall engine (Android Chrome profile, test camera): the engine started and
  the trip reached "ready". Its only violation came from the MazeMap compass map on that screen.
  The engine's own `new Function("return this")` is a fallback that modern browsers never reach.

So the 8th Wall engine does **not** need it; MazeMap does.

**When to look again:** after any MazeMap upgrade. Run the app with `'unsafe-eval'` removed and
watch for `securitypolicyviolation` events; if there are none, remove it.
`tests/unit/csp.test.js` fails if the source is removed or this note goes missing, so the two stay
together.

## `script-src 'wasm-unsafe-eval'`: the 8th Wall engine

The engine compiles WebAssembly (`xr.js`, `xr-slam.js`). This allows WebAssembly only, not
JavaScript `eval`.

## `worker-src blob:` and `child-src blob:`

Mapbox GL (inside MazeMap) starts its tile workers from `blob:` URLs.
