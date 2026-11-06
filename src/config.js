// App-wide settings. Change values here, not inside screens.

export const APP = {
  name: 'Stirling Welcome AR',
  university: 'University of Stirling',
  // The existing 2D campus map (separate Vercel project).
  campusMapUrl: 'https://stirling-campus-map.vercel.app',
  // Shown on the home and About pages.
  disclaimer: 'Student prototype – not an official University of Stirling service.',
}

// Where AR walking directions work: the area of src/data/town-footpaths.json
// [south, west, north, east]. Keep in step with TOWN_BBOX in tools/build-footpaths.mjs.
export const TOWN_BBOX = [56.105, -3.975, 56.165, -3.89]

export const MAZEMAP = {
  // University of Stirling campus on MazeMap.
  campusId: 2058,
  scriptBase: 'https://api.mazemap.com/js/v2.2.6/',
  center: {lng: -3.9205, lat: 56.1462},
  zoom: 15.6,
  // Fail with a clear message instead of a blank map when the network is slow.
  loadTimeoutMs: 15000,
}

export const XR = {
  // Served from public/external/xr (copied from @8thwall/engine-binary on install).
  scriptUrl: '/external/xr/xr.js',
  slamChunkUrl: '/external/xr/xr-slam.js',
  loadTimeoutMs: 45000,
  // Cap render resolution: 2x is sharp on iPhone and keeps 60 fps headroom.
  maxPixelRatio: 2,
}
