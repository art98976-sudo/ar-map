// Things shown once per device: the first-time guide before the permission prompts, and the
// tilt-to-floor animation on the first AR trip. Blocked storage means "shown": never nag.
import {t} from '../i18n/i18n.js'

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

/** The three lines of the first-time guide, in the order the phone asks. */
export const GUIDE_LINES = [
  {icon: 'camera', key: 'guide.camera'},
  {icon: 'pin', key: 'guide.location'},
  {icon: 'compass', key: 'guide.motion'},
].map((l) => ({
  icon: l.icon,
  get text() {
    return t(l.key)
  },
}))
