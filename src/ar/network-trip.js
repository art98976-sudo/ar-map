// ?network=1: connects an AR trip to the map-constrained pose (network-pose.js). trip.js hands it
// the camera's tracked position (through its own route frame), the tracking state, the compass and
// GPS; it keeps the pose on the network route and reports where the user is and how sure it is.
import {CAMPUS_ORIGIN} from '../map/campus-geo.js'
import {fromLocal, toLocal} from '../geo/geo.js'
import {createNetworkPose, wallTesterFrom} from './network-pose.js'
import {buildingAt} from '../route/network-router.js'

/**
 * route: a network route (planOnNetwork: points carry campus x, y, z, edgeType). origin: the
 * trip's origin ({lat, lng}), whose metres the trip's route frame uses. net: campus-network.json.
 */
export function createNetworkTrip({route, origin, net}) {
  const campus = (p) => toLocal(CAMPUS_ORIGIN, p)
  const fromTrip = (local) => campus(fromLocal(origin, local))
  const points = route.points.map((p) => (Number.isFinite(p.x) && Number.isFinite(p.y) ? p : {...p, ...campus(p)}))
  const crossesWall = wallTesterFrom(net)
  const pose = createNetworkPose({
    points,
    crossesWall,
    insideBuilding: (p) => buildingAt(net, p) != null,
    floorHeights: Object.values(net.floors ?? {})[0]?.levels ?? {},
  })
  let last = null
  let lastY = null
  let fedFix = null

  return {
    pose,
    /**
     * The walk starts. at: {lat, lng} where the user stands; manual: a picked start (a room or
     * entrance) rather than GPS; z: its floor. A GPS start that is too poor (or inside a building)
     * starts on the route where the trip placed the user instead.
     */
    begin({at, manual = false, accuracyM = 0, z = null, onRoute = null}) {
      const p = campus(at)
      const ok = pose.start({x: p.x, y: p.y, z, accuracyM, manual})
      if (!ok && onRoute) {
        const q = campus(onRoute)
        pose.start({x: q.x, y: q.y, z, manual: true})
      }
      last = null
      return pose.current
    },
    /** Every frame while guiding. camera: {x, y, z} in the camera's world; worldToRoute: trip.js's. */
    tick({camera, worldToRoute, tracking, heading = null, fix = null}) {
      pose.setTracking(tracking)
      pose.compass(heading)
      const local = worldToRoute({x: camera.x, z: camera.z})
      if (last) {
        const a = fromTrip(last)
        const b = fromTrip(local)
        pose.move({dx: b.x - a.x, dy: b.y - a.y, dh: camera.y - lastY})
      }
      last = local
      lastY = camera.y
      if (fix && fix !== fedFix) {
        fedFix = fix
        const c = campus(fix)
        pose.gps({x: c.x, y: c.y, accuracyM: fix.accuracy})
      }
      return pose.current
    },
    get current() {
      return pose.current
    },
  }
}
