# Connecting to MazeMap

The app can switch from its sample data to the University's real MazeMap data by setting
`MAP_PROVIDER=mazemap`. The code for this is ready, in `src/lib/providers/mazemap/`, but it stays
switched off until the University gives permission and the values below.

Checked against MazeMap's JS API documentation, version 3.0.9 (October 2026):
<https://api.mazemap.com/js/latest/docs/>

## What to ask the University for

Send this to the University's MazeMap contact. That is usually Estates or Digital Services, who hold
the MazeMap contract and have a MazeMap Customer Success Manager.

1. **Written permission** to use the University of Stirling MazeMap campus in a student-built web app
   (and later an AR app) through MazeMap's official JS API, including search, place data and routing.
2. **The MazeMap campus id** for the Stirling campus (a number).
3. **A campus view token** or **campus access token**, if the campus or any of its floors are private.
   MazeMap's API has `setMazemapViewToken` and `setMazemapAuthToken` for this.
4. **Confirmation that routing and indoor directions are enabled** for the campus. MazeMap notes that
   text directions only work "inside campus boundaries where feature is enabled".
5. **Whether accessible routing is set up** (step-free paths and lifts marked), so the app's
   step-free option works.
6. **Whether a staging setup exists** for testing (MazeMap supports `staging-api.mazemap.com`).
7. **Any branding or attribution rules** for showing MazeMap data in the app.
8. If the AR app will need bulk or offline data, ask about **MazeMap's Customer API**. The JS API
   must not be used to download data in bulk.

## MazeMap's usage rules that the app follows

| Rule from MazeMap's guidelines | How the app follows it |
|---|---|
| No scraping or bulk downloading of data | Only searches when someone types, and looks up single places on demand. Nothing is stored in the repo. |
| Route requests are slow (1 to 5 s); request sparingly | The same trip is requested at most once every 30 seconds. |
| Search: avoid automatic repeated calls | Uses MazeMap's own `SearchController`, which waits at least 250 ms between calls. |

## Switching it on

```bash
# web/.env.local
MAP_PROVIDER=mazemap
MAZEMAP_CAMPUS_ID=<number from the University>
MAZEMAP_VIEW_TOKEN=<only if given>
MAZEMAP_AUTH_TOKEN=<only if given>
```

Then rebuild (`npm run build`). On Vercel, add the same variables in Project Settings, then redeploy.
If `MAP_PROVIDER=mazemap` is set without a valid campus id, the app falls back to sample data and
shows a warning.

## What is done and what is left

- **Done.** Search, place lookup, buildings, floors and routing go through MazeMap's official
  JS API. Results are converted into the app's own types and route format, so the UI does not change.
- **Tested.** Unit tests use a fake MazeMap SDK with made-up data shaped like MazeMap's documented
  responses.
- **Still to check with real access:**
  - The exact field names in MazeMap's responses.
  - The z-level numbering of Stirling's floors.
  - The route request's start and end format for raw positions.
  - How instruction texts map to step types.
- **Later.** Draw MazeMap's own indoor floor-plan tiles in the map, instead of the base map plus routes.
