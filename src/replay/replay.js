// Phase 1: replay a trip record (trip-recorder.js) through the REAL trip logic (createArTrip): the
// same compass readings, GPS fixes, tracking states, camera poses and taps, at the same moments,
// on a laptop or in a test. Each frame's result (what the trip believed, the arrow it showed) is
// collected with the truth, if the record has it (synthetic walks), for metrics.js.
// Not replayed: hit tests on the camera image (the floor is the scene's, or eye height) and the
// building shell's walls; a reroute plans the route the phone planned (recorded), not a new one.
import {createTripRecorder, isTripRecord} from './trip-recorder.js'

/**
 * record: the JSON from a phone (or synthWalk). THREE: three.js. createArTrip: the trip factory.
 * loadScene: (points, origin) => scene, for the route's floors (default: none).
 * onFrame(sample): called each frame (the in-browser viewer). everyFrames: keep one sample in this many.
 * Returns {meta, samples, stats, events}.
 */
export async function replayTrip(record, {THREE, createArTrip, loadScene = null, onFrame = null, everyFrames = 1, overrides = {}} = {}) {
  if (!isTripRecord(record)) throw new Error('Not a trip record (welcome-ar-trip-record/1)')
  const {events, ...meta} = record
  let clockMs = 0
  let compassCb = null
  let gpsCb = null
  const reroutes = events.filter((e) => e.k === 'e' && e.name === 'reroute' && e.route).map((e) => e.route)
  const stats = []
  let lastStats = null
  const sensors = {
    startCompass: ({onReading}) => {
      compassCb = onReading
      return () => {}
    },
    watchLocation: ({onFix}) => {
      gpsCb = onFix
      return () => {}
    },
    locationPermissionState: () => Promise.resolve(events.some((e) => e.k === 'g') ? 'granted' : 'prompt'),
    fetchFloor: () => Promise.reject(new Error('replay: no shell')),
    getRoomCentre: () => Promise.resolve(null),
    loadScene: loadScene ?? (() => Promise.resolve(null)),
  }
  const prevThree = globalThis.window?.THREE
  if (globalThis.window) globalThis.window.THREE = THREE
  const trip = createArTrip({
    route: meta.route,
    origin: meta.origin,
    destination: meta.destination ?? {name: 'Destination'},
    startPoint: meta.startPoint ?? null,
    autoStart: Boolean(meta.autoStart),
    allowDesktop: Boolean(meta.allowDesktop),
    plan: async () => reroutes.shift() ?? {status: 'replay-no-route'},
    sensors,
    clock: () => clockMs,
    // The replayed trip keeps its own record: its reroutes and re-anchors, not the phone's.
    recorder: createTripRecorder({clock: () => clockMs, maxEvents: 2_000_000}),
    onStats: (s) => {
      lastStats = s
      stats.push({t: clockMs, ...s})
    },
    ...overrides,
  })
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 1.5, 0)
  trip.onSceneReady({scene: new THREE.Scene(), camera})
  const samples = []
  let truth = null
  let frames = 0
  try {
    for (const e of events) {
      clockMs = e.t
      switch (e.k) {
        case 'c':
          compassCb?.({heading: e.h, accuracy: e.a, source: e.s, beta: e.b})
          break
        case 'g':
          gpsCb?.({coords: {latitude: e.lat, longitude: e.lng, accuracy: e.acc, altitude: e.alt}, timestamp: e.ts ?? e.t})
          break
        case 'k':
          trip.onTracking({status: e.status, reason: e.reason})
          break
        case 'a':
          trip[e.name]?.(...(e.args ?? []))
          break
        case 't':
          truth = e
          break
        case 'f': {
          if (e.p) camera.position.set(e.p[0], e.p[1], e.p[2])
          if (e.q) camera.quaternion.set(e.q[0], e.q[1], e.q[2], e.q[3])
          camera.updateMatrixWorld(true)
          trip.onTick({dt: e.dt, time: e.time})
          frames += 1
          if (frames % everyFrames === 0) {
            const map = trip.mapState()
            const sample = {
              t: e.t,
              time: e.time,
              phase: lastStats?.phase ?? null,
              arrowsShown: Boolean(lastStats?.arrowsShown),
              guideDeg: trip.guideDeg,
              user: map?.user ?? null,
              headingDeg: map?.headingDeg ?? null,
              trackedHeadingDeg: lastStats?.trackedHeadingDeg ?? null,
              userS: lastStats?.userS ?? null,
              floorLevel: lastStats?.floorLevel ?? null,
              positionSource: lastStats?.positionSource ?? null,
              headingSource: lastStats?.headingSource ?? null,
              positionUncertain: Boolean(lastStats?.positionUncertain),
              tracking: lastStats?.tracking ?? null,
              lateralOffsetM: lastStats?.lateralOffsetM ?? null,
              truth: truth ? {...truth} : null,
            }
            samples.push(sample)
            onFrame?.(sample, trip)
          }
          // Let the trip's promises (a scene, a reroute) settle between frames, as on the phone.
          await null
          break
        }
        default:
          break
      }
    }
  } finally {
    trip.stop()
    if (globalThis.window) globalThis.window.THREE = prevThree
  }
  return {meta, samples, stats, events: (trip.recorder?.toJSON().events ?? []).filter((e) => e.k === 'e'), recordedEvents: events.filter((e) => e.k === 'e')}
}
