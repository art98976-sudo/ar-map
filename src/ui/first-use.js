// Things shown once per device: the first-time guide before the permission prompts, and the
// tilt-to-floor animation on the first AR trip. Blocked storage means "shown": never nag.

const KEYS = {
  guide: 'welcomeAR.guideSeen.v1',
  tilt: 'welcomeAR.tiltSeen.v1',
}

/** Has this device seen it? Storage that throws counts as seen. */
export function seen(what, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEYS[what]) === '1'
  } catch {
    return true
  }
}

export function markSeen(what, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEYS[what], '1')
  } catch {
    // blocked storage: it shows again next time, which is harmless
  }
}

/** The three lines of the guide, in the order the phone asks (a trip from GPS). */
export const GUIDE_LINES = [
  {icon: 'camera', text: 'We use your camera to show arrows'},
  {icon: 'pin', text: 'We use your location to find the route'},
  {icon: 'compass', text: 'We use motion to keep the arrows on the floor'},
]

/**
 * The guide for this trip. A start the user chose by hand does not use their location: that line
 * says where the walk starts instead. startName: e.g. "Library main entrance"; null for GPS.
 */
export function guideLines(startName = null) {
  if (!startName) return GUIDE_LINES
  return GUIDE_LINES.map((l) => (l.icon === 'pin' ? {icon: 'pin', text: `Starting from ${startName}`} : l))
}
