// App-wide settings. Change values here, not inside screens.

export const APP = {
  name: 'Stirling Welcome AR',
  university: 'University of Stirling',
  // The existing 2D campus map (separate Vercel project).
  campusMapUrl: 'https://stirling-campus-map.vercel.app',
}

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
