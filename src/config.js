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

// Corners along the route, for the guidance and the debug panel.
export const TURNS = {
  minDeg: 30, // a bend this sharp counts as a corner
  passedM: 1, // a corner counts as passed this far beyond it
}

// The way-to-walk arrows drawn over the camera, lying on the ground at the bottom of the screen.
export const FLOOR_ARROWS = {
  easeS: 0.25, // smoothing of their turn, so the compass does not make them jitter
  turnDeg: 100, // turning further than this: a curved turn arrow instead of the chevrons...
  turnBackDeg: 85, // ...until back within this
  arriveM: 8, // this close to the entrance: a pin and "You have arrived" instead (= ARRIVAL.arriveM)
}

// The destination pin.
export const PIN = {
  green: 0x006938,
  lightGreen: 0x76b72a,
  showWithinM: 30, // the pin appears only this close to the destination, standing on the ground
  onTop: 30,
  maxLiftM: 1.5, // the slope of the ground raises or lowers the pin by at most this
  roomMaxM: 80, // the pin moves to the room only if the room is this close to the entrance
}

export const GUIDE = {
  noticeDeg: 3, // smaller bends are drawing noise
  turnDeg: 25, // a group of bends must add up to this to be a manoeuvre
  fullTurnDeg: 45, // below this it is only a "slight" turn
  groupGapM: 8, // bends the same way this close together are one turn
  groupSpanM: 30, // ...but a long sweep is not one corner
  jogM: 3, // two opposite bends this close that cancel out are a sidestep in the path, not turns
  passedM: 2, // a corner counts as passed this far beyond it
  backtrackM: 10, // this far back before a passed corner, it is ahead again
  announceM: 30, // further off than this, say "continue straight"
  hapticM: 10,
  nowM: 2, // this close, the turn is now
  landmarkM: 30, // a place this close to a corner names it
  pastAfterM: 3, // "Continue past" only names a place still this far ahead
}

export const COMPASS_GUIDE = {
  blendM: 12, // the arrow starts curving into a turn this far before it
  legAheadM: 5, // the current segment's direction is read over this much route...
  nextLegM: 8, // ...and the next segment's over this much, after the corner
  poorAccuracyDeg: 25, // iPhone's webkitCompassAccuracy worse than this: do not rely on the compass
  walkDirectionM: 6, // with no usable compass, walking this far shows which way the user faces
  walkStraightRatio: 0.7, // straight-line over walked: a wandering walk shows no direction
}

export const TRACK = {
  minStepM: 0.25, // smaller moves are SLAM noise: a user standing still must not creep along
  maxStepM: 5, // a bigger jump is SLAM recovering, not walking
  sidewaysCos: 0.3, // walking across the route does not move the user along it
  backwardsCos: -0.5,
  goodAccuracyM: 20,
  windowM: 15, // GPS can only move the user this far (plus its error) along the route
  gainAt5M: 0.35, // SLAM carries the distance: each fix only nudges it, less if it is poor
  easeS: 0.4,
}

export const MATCH = {
  sampleEveryS: 0.5,
  minStepM: 0.25, // ignore smaller moves, so a user standing still builds up no fake "walk"
  trackM: 30, // keep this much of the walk
  minWalkedM: 5, // no correction before this
  gateM: 8, // samples further than this from the route are ignored by the fine fit
  coarseM: 16, // with too few samples in the gate, line up by direction if the user is this close
  iterations: 10,
  minInliers: 6,
  maxStepM: 3, // per update
  maxStepDeg: 10,
  maxTotalM: 20, // over the whole trip
  maxTotalDeg: 75, // more than the 60° Start allows, plus some drift, or a bad compass stays uncorrected
  confidentResidualM: 1,
  cornerArmM: 4, // a turn in the walk needs this much straight walking either side
  cornerMinDeg: 35, // same as a turn in the route (findTurns)
  cornerAgreeDeg: 30, // the walk and the route turn by a similar angle...
  cornerNearM: 12, // ...this close together
  wrongWayDeg: 90, // walking further than this from the route direction: the alignment is flipped
  wrongWayChecks: 2, // seen on this many updates in a row, so one stumble cannot flip the route
  straightRatio: 0.7, // straight-line distance over distance walked, to read a walking direction
  maxSpeedMps: 5, // faster than this is a SLAM jump, not walking: start the track again
  movingWithinS: 1.5,
  ignoreM: 0.02, // smaller corrections are not worth moving the arrows for
  ignoreDeg: 0.05,
}

export const GROUND = {
  sampleEveryS: 0.15,
  belowPhoneM: 0.3, // a hit must be at least this far below the phone
  maxDistanceM: 14,
  maxOffRouteM: 4,
  maxHits: 160,
  maxAgeS: 30,
  recencyS: 10, // newer hits count for more: e^(-age / this)
  minHits: 4,
  outlierM: 0.35,
  maxSlope: 0.18,
  minSpanM: 3, // along the route, before believing any slope
  nearUserM: 4, // hits this close teach the height of the phone above the ground
  defaultEyeM: 1.4, // with no floor found yet, the floor is this far below the phone (adjustable in debug)
  eyeStepM: 0.05, // one tap of the debug floor buttons
  minEyeM: 0.8,
  maxEyeM: 2.1,
  easeS: 0.4,
}

// Placing the route in the AR world.
export const NAV_SCENE = {
  startLookAheadM: 8,
  realignEaseS: 0.5,
  matchEaseS: 1,
}

// One AR trip, from Start to arrival.
export const TRIP = {
  uprightMaxTilt: 0.55, // |forward.y|: about 33° up or down from level
  firstHeadingWindowMs: 500, // the Start tap averages this much compass history
  minHorizontalLook: 0.2, // below this the camera looks almost straight up or down: no yaw
  steadyMaxDriftDeg: 6, // the camera must stay this close to where the window started
  realignMinDeg: 5, // smaller differences are compass noise: leave the route alone
  realignMinMatchedDeg: 15, // with a confident map match, walking beats the compass
  matchEveryS: 2,
  compassPillAfterMs: 10_000, // show the figure-8 pill after this long unsteady
  desktopStartDelayS: 2, // a webcam on a desk never reports NORMAL tracking
  rerouteFixM: 25, // only trust GPS this good to plan a new route from
  compassStaleMs: 2000, // no reading for this long: the compass has stopped
  campusFixes: 2, // fixes in a row inside the boundary, so one stray fix cannot cross it
  autoStartS: 1, // let the compass speak before a trip starts by itself
  autoStartEveryS: 0.5,
  liveFixes: 3, // good GPS this many times running: offer to switch to it
  repickForS: 20, // how long to offer choosing the start again, after going off route
  campusCheckEveryS: 1,
  instructionEveryS: 0.5,
  pointsPerSample: 3,
}

export const GPS = {
  // A fix must be at least this accurate (metres, 68% radius) before AR starts.
  goodAccuracyM: 20,
  // If we never reach a good fix for this long, the user is probably indoors.
  indoorAfterMs: 30_000,
  // How long one watchPosition attempt may wait before reporting a timeout.
  timeoutMs: 20_000,
  // Enough for a walking time: the home screen stops the GPS after this, to save battery.
  goodEnoughFixM: 50,
}

export const START = {
  weakGpsM: 25, // GPS worse than this: suggest choosing a start instead
  liveGpsM: 15, // GPS this good, a few times running: offer to switch back to it
}

export const COMPASS_MAP = {
  pitch: 45,
  zoom: 18.4,
  zoomExpanded: 17.6,
  maxTurnDegPerS: 90,
  frameMs: 50,
  dotFromTop: 0.72, // the user's dot sits this far down the map
}

// Is the position good enough to draw the AR arrow? (src/route/trip-monitors.js)
// Unreliable: GPS worse than maxGpsAccuracyM, or the compass swinging more than maxHeadingSwingDeg
// within swingWindowS while the phone itself is not turning. After unreliableAfterS of that, the
// arrow hides and the 2D map takes over; it comes back after reliableAfterS of good readings.
export const CONFIDENCE = {
  maxGpsAccuracyM: 20,
  maxHeadingSwingDeg: 40,
  swingWindowS: 2,
  unreliableAfterS: 3,
  reliableAfterS: 3,
}

// Going off the route, and arriving.
export const OFF_ROUTE = {
  offM: 15, // further from the route than this...
  forS: 5, // ...for this long, without a break, plans a new route...
  minIntervalS: 15, // ...but never more than once in this long
}

export const ARRIVAL = {
  arriveM: 8, // this close to the destination (straight line, or route left)...
  forS: 1, // ...held for this long, so a correction easing past cannot end the trip
}

// Planning a walking route.
export const ROUTING = {
  walkSpeedMps: 1.3, // about 4.7 km/h, a relaxed campus pace
  snapToPathM: 25, // GPS this close to a path means the user is ON that path
  onPathM: 0.5,
  entranceAppendM: 3,
}

// Colours drawn from JavaScript (map lines, canvases). CSS colours are in styles/tokens.css.
export const COLOURS = {
  brandGreen: '#006938',
  lightGreen: '#76b72a',
  routeGreen: '#0a8a4a',
  legGreen: '#37e07f',
  amber: '#e09a00',
  debugYellow: '#f7d64c',
  arrowGreen: '#22c55e',
  white: '#ffffff',
  confetti: ['#006938', '#76b72a', '#9fcc69', '#ffffff', '#edab00'],
}
