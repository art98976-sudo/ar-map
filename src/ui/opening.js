// The opening (7.4): a launch screen (dark green, the app name in white, at most 1.2 s), then one
// camera move onto the campus (about 1.8 s). Once per session; skipped with reduce-motion or when
// the link already names a place.
import {OPENING} from '../config.js'

const KEY = 'welcomeAR.opened.v1'

/** Play the opening for this start? Pure, so the rules are tested without a browser. */
export function shouldOpen({hash = '', reducedMotion = false, storage = null} = {}) {
  if (reducedMotion) return false
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  if (path && path !== '/') return false // straight into a trip, AR or the indoor map
  if (new URLSearchParams(query).has('to')) return false
  try {
    return storage?.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

let pending = false

/** At start: hide the launch screen after OPENING.launchMs, or at once if there is no opening. */
export function startOpening(win = window) {
  const launch = win.document.getElementById('launch')
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  pending = shouldOpen({hash: win.location.hash, reducedMotion, storage: win.sessionStorage})
  if (pending) {
    try {
      win.sessionStorage.setItem(KEY, '1')
    } catch {
      // blocked storage: it may play again, which is harmless
    }
  }
  if (!launch) return
  const hide = () => {
    launch.classList.add('is-gone')
    setTimeout(() => launch.remove(), 300)
  }
  if (pending) setTimeout(hide, OPENING.launchMs)
  else launch.remove()
}

/** The home map is ready: one camera move onto the campus, if this start opens. */
export function openingMove(map, view) {
  if (!pending) return false
  pending = false
  map.jumpTo({...view, zoom: view.zoom - OPENING.zoomOut, bearing: OPENING.fromBearing, pitch: 0})
  map.easeTo({...view, duration: OPENING.moveMs, essential: false})
  return true
}
