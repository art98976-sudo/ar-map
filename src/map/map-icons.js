// Every place on the map gets an icon, and the console stays quiet.
//
// MazeMap's room labels ask for icons by number ("7367") and fetch them later. The map engine
// warns ("Image ... could not be loaded") whenever an icon is not there at the moment it is
// asked for. So when one is missing we add a small neutral dot straight away, then fetch the
// real MazeMap icon and put it in its place. A type MazeMap has no icon for keeps the dot.
import {MAP_ICONS} from '../config.js'

/** A round dot with a white ring, as raw RGBA pixels (no canvas needed). */
export function dotImage(size = MAP_ICONS.dotPx, fill = MAP_ICONS.dotColour) {
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  const outer = size / 2
  const inner = outer - Math.max(1.5, size * 0.14)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      if (d > outer) continue
      const [r, g, b] = d > inner ? [255, 255, 255] : fill
      // Soft edge: one pixel of anti-aliasing.
      const a = Math.max(0, Math.min(1, outer - d))
      data.set([r, g, b, Math.round(255 * a)], (y * size + x) * 4)
    }
  }
  return {width: size, height: size, data}
}

/** The MazeMap icon for a numeric icon id, or null for names that are not MazeMap icons. */
export function mazeMapIconUrl(id) {
  return /^\d+$/.test(String(id)) ? `https://api.mazemap.com/api/icons/${id}.png?size=${MAP_ICONS.iconPx}` : null
}

/** Listen for missing icons on `map`. Returns a function that stops listening. */
export function handleMissingImages(map) {
  const dot = dotImage()
  const fetching = new Set()
  const onMissing = (event) => {
    const id = event?.id
    if (!id || map.hasImage(id)) return
    // Synchronously, so the engine never has to warn about it.
    map.addImage(id, dot, {pixelRatio: MAP_ICONS.pixelRatio})
    const url = mazeMapIconUrl(id)
    if (!url || fetching.has(id)) return
    fetching.add(id)
    map.loadImage(url, (err, image) => {
      if (err || !image) return // no such MazeMap icon: the dot stays
      try {
        if (map.hasImage(id)) map.removeImage(id)
        map.addImage(id, image, {pixelRatio: MAP_ICONS.pixelRatio})
      } catch {
        // the map was removed meanwhile
      }
    })
  }
  map.on('styleimagemissing', onMissing)
  return () => map.off('styleimagemissing', onMissing)
}
