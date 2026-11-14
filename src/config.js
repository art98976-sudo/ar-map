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

// The destination card (src/route/card-text.js).
export const CARD = {
  pathFactor: 1.3, // before a route is planned, paths are about this much longer than the straight line
  sameDoorM: 25, // a route door this close to a known main entrance is that entrance
  approximateM: 20, // GPS worse than this: "Location is approximate"
}

// Icons on the map for place types that have none yet (src/map/map-icons.js).
// The opening (7.4): launch screen, then one camera move. Once per session.
export const OPENING = {
  launchMs: 1200, // the launch screen shows at most this long
  moveMs: 1800, // the camera move onto the campus
  zoomOut: 1.4, // it starts this far out...
  fromBearing: -25, // ...turned this way
}

// The home map (7.3): readable pins and softer base colours.
export const HOME_MAP = {
  buildingZoom: 17, // below this, one pin per building
  clusterPx: 48, // pins closer than this on screen merge into a numbered cluster
  clusterZoomStep: 2, // tapping a cluster zooms in this much
  labelOffsetEm: 1.6, // building names sit this far below their point, clear of the pin
  pinDotPx: 18, // a pin's dot radius on screen (32 px dot, its white ring and shadow)
  campusLabelMaxZoom: 14, // the campus name ("UNIVERSITY OF STIRLING") shows only zoomed out, never cut off
  // Below this zoom the floor plans are too small to read: no stairs or lift icons, no room labels.
  indoorZoom: 17,
  outdoorFloorId: 1027233, // MazeMap's ground "floor" on this campus: car parks, cafés and other outdoor places
  stairLiftIcons: [833, 834], // MazeMap's icon numbers for stairs and lifts
  // Labels keep clear of the logos, credits and buttons (label-blockers.js).
  blockerPadPx: 4, // room around each of them
  blockerEdgePx: 16, // the strip along each screen edge and along the top of the sheet or card
  creditsCornerPx: 110, // how wide a bottom corner the logos take
  // The opening view: these places in the middle of the map between the search bar and the sheet.
  openOn: ['campus-central', 'cottrell'],
  openPaddingPx: 40, // room around them
  openMaxZoom: 16, // campus zoom: whole buildings and their names, no indoor detail
  // Softer base colours: [layer, paint property, value]. Missing layers are skipped.
  soft: [
    ['land-grass-areas', 'fill-color', 'hsla(108, 32%, 80%, 0.55)'],
    ['water', 'fill-color', '#d4e8f0'],
    ['water-shadow', 'fill-color', '#cadeed'],
    ['waterway', 'line-color', '#d4e8f0'],
    ['mm-building-fill', 'fill-opacity', 0.75],
    ['building-outline', 'line-color', 'hsl(35, 8%, 85%)'],
  ],
}

export const MAP_ICONS = {
  dotPx: 24, // the stand-in dot, in pixels (drawn at pixelRatio, so 12 px on screen)
  dotColour: [92, 107, 100], // neutral grey-green
  iconPx: 60, // MazeMap icons fetched at this size...
  pixelRatio: 2, // ...and shown at half of it
}

// The 3D campus model (public/data/stirling_campus.glb).
export const CAMPUS_MODEL = {
  // The model was built with an Earth radius of 6378137 m; the map engine and geo.js use 6371008.8 m.
  // Its metres are this much too long: scale them by it so the model sits on the map (about 1.1 m per km).
  earthScale: 6371008.8 / 6378137,
}

// The way to walk: 3D chevrons lying on the real floor along the route (src/ar/ground-arrows.js).
export const GROUND_ARROWS = {
  spacingM: 1, // one chevron every this far along the route, so several lie close to the user
  aheadM: 10, // drawn this far ahead: further away a flat arrow no longer reads as floor
  lowPowerAheadM: 6, // on a slow phone (below 24 fps for 3 s): this far, and no shadows
  nearM: 0.6, // the first one at least this far ahead (not under the feet)
  poolSize: 11, // aheadM / spacingM, plus one: made once, recycled as the user walks
  widthM: 0.5,
  depthM: 0.35, // tip to back: deep enough to read when seen along the floor
  edgeM: 0.022, // the thin white edge all round
  solidM: 3, // fully solid this close, fading to nothing by aheadM
  cornerRadiusM: 1, // corners are rounded so the arrows bend through the turn
  cornerSteps: 8,
  minCornerDeg: 8, // smaller bends are left as they are
  maxLiftM: 1.5, // the ground slope moves a chevron up or down by at most this
  minAngleDeg: 8, // seen closer than this to the horizon a chevron fades (gone at half of it)
  minBelowCameraM: 0.3, // never drawn higher than this below the phone
  green: 0x22c55e,
  shadowScale: 1.35, // the soft shadow under each chevron, this much wider
  shadowOpacity: 0.25,
  guessOpacity: 0.5, // unused since Step 3 (the scene knows the floor); kept for the simulator's old runs
  renderOrder: 20, // over the camera image (depthTest off): shadow, edge, green
  blockMarginM: 0.6, // a surface this much nearer than a chevron hides it
  blockChecksPerFrame: 3, // blocked tests, chevrons taken in turn
  blockEaseS: 0.3, // fade in and out over about this, so nothing flickers
  trackingLostS: 2, // tracking lost longer than this: hide them, "Point your phone at the floor"
}


// On the floor with the chevrons (src/ar/ground-extras.js): the path strip and the corner rings.
export const GROUND_EXTRAS = {
  stripWidthM: 0.5,
  stripOpacity: 0.25,
  stripStepM: 0.25, // the strip follows the rounded route line in steps this long
  stripStartM: 0.3, // and starts just ahead of the feet
  ringRadiusM: 0.6, // a ring on the floor at each corner within range
  ringLineM: 0.06,
  ringGreen: 0x22c55e,
  ringFillOpacity: 0.55, // the disc inside the ring, which grows as the user nears the corner
  ringPool: 3,
  cornerGreen: 0x5ef08f, // chevrons through a corner are this brighter green
  cornerNearM: 1.6, // ...if this close to the corner point
  pulseGreen: 0x8ff5b6, // a slow, light band travelling forward along the chevrons (no glow)
  pulseMix: 0.35, // at most this much of the light green
  pulseWavelengthM: 6,
  pulsePeriodS: 2.5,
}

// The building shell from MazeMap (src/ar/building-shell.js, mazemap-floor.js).
export const SHELL = {
  tileZoom: 18, // MazeMap floor tiles are read at this zoom (about 95 m across here)
  defaultLevel: 1, // outdoors with no door level known: the ground floor's walls
  loadRadiusM: 45, // walls and doors this far around the user are loaded...
  reloadAfterM: 25, // ...and loaded again once the user has walked this far from there
  wallHeightM: 2.7, // walls stand from the floor to this height
  doorClearM: 1, // ?debug=walls: a wall crossing this close to a door is the door
  sameCrossingM: 0.6, // two crossings this close are the two faces of one wall
  doorMarkerAheadM: 10, // doorway outlines for the doors within this far ahead on the route
  doorMarkerOpacity: 0.6, // soft
  occluderMinQuality: 0.7, // walls hide arrows only when the alignment quality is at least this (Step 4)
  doorMarkerDepthM: 0.3, // the outline is this deep across the doorway
  baseLineOpacity: 0.28, // the faint wall base lines shown while lining up
  lineUpWallsM: 8, // ...for the walls within this far
  lowFpsWallsM: 15, // when the frame rate drops, only walls within this far stay
  lowFps: 24, // frames a second below which...
  lowFpsForS: 3, // ...for this long, the shell (and the arrows) are lightened
  renderOrder: 5, // the occluder draws before the arrows, so they can test against it
}

// Safety (Phase 6.6): "Look up while you walk", once per trip.
/** First use only: the tilt-to-floor animation on the first AR trip. */
export const FIRST_USE = {
  tiltMs: 3000,
}

// The 3D navigation scene (Step 1): MazeMap's floors, walls, doors, stairs and lifts in metres.
export const SCENE = {
  indexCellM: 5, // the spatial index's grid cell
  nearWallM: 6, // "nearest wall" looks this far
  shaftSearchM: 6, // a level change finds its stair or lift within this distance
  marginM: 20, // floors are loaded this far around the route's points on that level
  doorOnWallM: 0.15, // a wall crossing this close to a door line is the door (doors drawn on a wall's face)
}

// Step 2: the route fitted to the scene.
export const FIT = {
  stepM: 0.5, // the route is looked at every half metre
  doorReachM: 0.6, // straight through a door this far on each side of its centre
  clearM: 0.4, // at least this far from any wall
  corridorMaxM: 3.5, // walls on both sides closer than this together: a corridor, walk its middle
  lookM: 3, // how far to look sideways for walls
  smoothN: 3, // sideways moves are averaged over this many points each side (1.5 m)
  maxShiftM: 1.5, // never move the line more than this sideways
  simplifyM: 0.25, // the line is simplified to this before its corners are placed and rounded
  junctionMoveM: 2, // a corner moves to where the legs meet if that is this close
  cornerM: 1, // corners are rounded with this radius
  minTurnDeg: 15, // smaller bends are not corners
  arcStepDeg: 15,
  repairSearchM: 6, // a stretch through a wall is repaired through a door this close
  repairSideM: [0.4, 0.8, 1.2, 1.6], // with no door near, tried sideways moves of the stretch
  clearPasses: 3, // the last clearance pushes, repeated
  finalSimplifyM: 0.05, // then the extra points that changed nothing are dropped
  endExemptM: 1, // the first and last metre: where the user stands and the room itself
  doorClearExemptM: 1, // within this of a door the route passes, the 0.4 m wall clearance does not apply
  startLookM: 60, // the start kink is looked for in the first this many metres
  startSnapM: 25, // the start joins the route at its nearest point within this
  startMinSaveM: 2, // and removed if going straight saves at least this much
  loadTimeoutMs: 6000, // the floors for fitting: past this, fit outdoors only
}

// Step 3: the floor height comes from the scene; the camera only refines it, silently.
export const SCENE_FLOOR = {
  refineMps: 0.1, // the camera's floor moves the scene's floor at most this fast (metres per second)
  maxRefineM: 0.6, // and never more than this from where the scene put it
  settledM: 0.01, // the first floor found is followed until the finder is this close to its target
}

// Group B: no line-up step. The arrows show at once and settle as the walk is matched.
export const LINE_UP = {
  unconfirmedOpacity: 0.8, // until the walked track matches the route (or the user lined them up)
  offerAfterS: 10, // still not matching this long after walking far enough: offer Re-align
}

export const SAFETY = {
  lookUpAfterS: 10, // walking this long with the phone held up in front...
  lookUpForS: 3, // ...shows the reminder for this long
  raisedMaxY: 0.55, // "held up": the camera looks no more than this far down (0 = level, 1 = straight down)
}

// Indoors (Phase 5).
export const INDOOR = {
  indoorAR: true, // AR arrows carry on inside, along the fitted indoor route, floor by floor (Step 3)
  floorHeightM: 3.5, // one floor up or down, for arrows that climb with the route
  stairNearM: 4, // this close to a stair or lift on the route: "Go to Level n"
  poorMatchM: 2.5, // the walked track this far from the route on average...
  poorMatchForS: 10, // ...for this long: offer "I'm here" to put the user back on the map
  pickRadiusM: 25, // "I'm here" offers doors, stairs and lifts this close
  outdoorMinM: 15, // a route with less outdoor walking than this is an indoor trip: "Show the way"
}

// The destination pin.
export const PIN = {
  green: 0x006938,
  lightGreen: 0x76b72a,
  showWithinM: 30, // the pin appears only this close to the destination, standing on the ground
  onTop: 30,
  maxLiftM: 1.5, // the slope of the ground raises or lowers the pin by at most this
  roomMaxM: 80, // the pin moves to the room only if the room is this close to the entrance
  boardHeightM: 0.32, // the name board on top of the pin (6.4)
  boardY: 1.75, // its centre above the ground: just over the pin's head
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
  hapticM: 5, // a light vibration this far before a corner, and again at it
  nowM: 2, // this close, the turn is now
  landmarkM: 30, // a place this close to a corner names it
  pastAfterM: 3, // "Continue past" only names a place still this far ahead
}

// The arrow's direction (route/nav-pose.js steeredBearing): the path, leaning back only when far off it.
export const ARROW = {
  aheadM: 8, // the path direction is read this far ahead
  steerAboveM: 4, // more than this to one side of the route (and walking has proved the placement)...
  minSteerDeg: 5, // ...the arrow leans back towards it, at least this much...
  maxSteerDeg: 25, // ...and never more than this
}

export const COMPASS_GUIDE = {
  blendM: 12, // the arrow starts curving into a turn this far before it
  legAheadM: 8, // the path direction is read from the user to this far ahead (the arrow)...
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
  // The floor finder (arrows): fast, median of a flat cluster of hits.
  floorMinDropM: 0.5, // a floor hit is this far below the phone...
  floorMaxDropM: 2.2, // ...and no further
  floorNearM: 4, // and within this of the phone, sideways
  floorBandM: 0.08, // hits within this of the median count as the floor
  floorMinHits: 3, // this many surface hits before feature points are ignored
  floorFoundHits: 8, // the floor is found once this many agree...
  floorSpreadM: 0.5, // ...spread over at least this much floor
  floorMaxHits: 120,
  floorMaxAgeS: 8,
  floorEaseS: 0.3, // to the found floor in about this long
  floorMaxStepM: 0.05, // never more than this per frame
  floorTestsSearching: 6, // hit tests per frame until the floor is found
  floorTestsFound: 3, // and after
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
}

export const GPS = {
  // A fix must be at least this accurate (metres, 68% radius) before AR starts.
  goodAccuracyM: 20,
  // If we never reach a good fix for this long, the user is probably indoors.
  indoorAfterMs: 30_000,
  // Group B: no good fix within this long, ask the user to pick where they are starting.
  askStartAfterMs: 10_000,
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
