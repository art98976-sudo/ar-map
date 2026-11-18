// Alignment Phase 1, step 1: may this GPS fix start AR?
// A start further off than map matching can correct (MATCH.maxTotalM) is never corrected: the trip
// locks onto the wrong stretch of route (outdoors instead of the corridor) for good. So GPS starts
// AR only when it is good (AR_START.gpsMaxM) AND outdoors; everything else goes to the door picker.
// No DOM, no network: the caller says whether the fix is inside a building.
import {AR_START, MATCH} from '../config.js'

// The limits must match: a start may be at most as far off as the self-correction can recover.
if (AR_START.gpsMaxM > MATCH.maxTotalM) throw new Error('AR_START.gpsMaxM must not exceed MATCH.maxTotalM')

/**
 * fix: {accuracy} or null. inside: is the fix inside a MazeMap building outline (true / false),
 * or null when the outlines could not be loaded. waitedMs: since the location step started.
 * Returns {action, reason}:
 *   'gps'   start from this fix
 *   'wait'  keep listening (the fix may still improve outdoors)
 *   'pick'  show "Where are you?": GPS cannot start this trip
 * reason: 'good' | 'indoors' | 'weak' | 'no-fix' | 'outline-unknown' (good GPS, outlines missing).
 */
export function gpsStartDecision({fix, inside = null, waitedMs = 0, maxM = AR_START.gpsMaxM, waitMs = AR_START.waitForGpsMs}) {
  const timedOut = waitedMs >= waitMs
  const accuracy = Number.isFinite(fix?.accuracy) ? fix.accuracy : null
  if (accuracy == null) return timedOut ? {action: 'pick', reason: 'no-fix'} : {action: 'wait', reason: 'no-fix'}
  // Inside a building: GPS is not going to get good enough to start AR. A fix this rough (twice the
  // limit) might be someone outside next to the wall, so that one waits like any weak fix.
  if (inside === true && accuracy <= maxM * 2) return {action: 'pick', reason: 'indoors'}
  if (accuracy <= maxM && inside !== true) return {action: 'gps', reason: inside === false ? 'good' : 'outline-unknown'}
  return timedOut ? {action: 'pick', reason: inside ? 'indoors' : 'weak'} : {action: 'wait', reason: inside ? 'indoors' : 'weak'}
}
