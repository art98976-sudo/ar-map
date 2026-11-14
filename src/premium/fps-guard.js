// Keeps the premium map smooth: if the phone draws too few frames per second while the
// map moves, it turns off one costly effect at a time (shadows, then haze, then blur).
export const EFFECTS = ['shadows', 'haze', 'blur']
export const FPS_FLOOR = 45
const WINDOW_MS = 3000

/** Frames per second from a list of frame times (ms), using the median frame. */
export function medianFps(frameMs) {
  if (!frameMs.length) return Infinity
  const s = [...frameMs].sort((a, b) => a - b)
  const mid = s[Math.floor(s.length / 2)]
  return mid > 0 ? 1000 / mid : Infinity
}

/** The next effect to turn off, or null if all are already off. */
export function nextToDrop(dropped) {
  return EFFECTS.find((e) => !dropped.includes(e)) ?? null
}

export function createFpsGuard(map, onDrop, {now = () => performance.now(), storage = sessionStorage} = {}) {
  let dropped = []
  try {
    dropped = JSON.parse(storage.getItem('premium-dropped') || '[]')
  } catch {
    dropped = []
  }
  dropped.forEach((e) => onDrop(e))
  let frames = []
  let last = 0
  let since = 0
  let moving = false

  const onRender = () => {
    if (!moving) return
    const t = now()
    if (last) frames.push(t - last)
    last = t
    if (t - since < WINDOW_MS) return
    const fps = medianFps(frames)
    frames = []
    since = t
    if (fps < FPS_FLOOR) {
      const effect = nextToDrop(dropped)
      if (!effect) return
      dropped.push(effect)
      try {
        storage.setItem('premium-dropped', JSON.stringify(dropped))
      } catch {
        // private mode: it is only remembered for this page
      }
      if (__DEV_TOOLS__) console.info(`[premium] ${Math.round(fps)} fps: turning off ${effect}`) // gone from production builds
      onDrop(effect)
    }
  }
  const onStart = () => {
    moving = true
    last = 0
    frames = []
    since = now()
  }
  const onEnd = () => {
    moving = false
  }
  map.on('render', onRender)
  map.on('movestart', onStart)
  map.on('moveend', onEnd)
  return {
    get dropped() {
      return [...dropped]
    },
    destroy() {
      map.off('render', onRender)
      map.off('movestart', onStart)
      map.off('moveend', onEnd)
    },
  }
}
