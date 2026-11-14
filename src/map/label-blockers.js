// Keeps the home map's labels readable: clear of the Mapbox and MazeMap logos, the credits and
// our own buttons, and never cut off by the screen edge or by the sheet or card at the bottom.
// It also keeps the logos and credits just above that sheet or card, so they are always in view.
//
// How: an invisible "blocker" icon sits on the map under each of those things. The map places
// labels around other symbols, so a building name moves to a free side of its point, and a
// place label that has no free spot is left out until the map moves.
import {HOME_MAP} from '../config.js'

const ID = 'label-blockers'
const NAMES = 'mm-building-label'

/**
 * The lift of the logos in one bottom corner: up to the top of the sheet or card lying over that
 * corner, or 0 when nothing does. Rectangles are {left, top, right, bottom} in screen pixels.
 */
export function creditsLift(host, panels, corner, cornerPx = HOME_MAP.creditsCornerPx) {
  const x0 = corner === 'left' ? host.left : host.right - cornerPx
  const x1 = corner === 'left' ? host.left + cornerPx : host.right
  let lift = 0
  for (const p of panels) {
    if (p.right <= x0 || p.left >= x1 || p.bottom <= p.top) continue
    lift = Math.max(lift, host.bottom - p.top)
  }
  return Math.max(0, Math.round(lift))
}

/**
 * The rectangles labels must keep out of, in map pixels ({x, y, w, h}): each thing lying over the
 * map (with a little room), a strip along the top of each sheet or card, and a strip down each
 * side of the screen.
 */
export function blockerRects(host, {overlays = [], panels = []} = {}, {padPx = HOME_MAP.blockerPadPx, edgePx = HOME_MAP.blockerEdgePx} = {}) {
  const width = host.right - host.left
  const height = host.bottom - host.top
  const rects = []
  for (const o of overlays) {
    if (o.right <= o.left || o.bottom <= o.top) continue
    rects.push({x: o.left - host.left - padPx, y: o.top - host.top - padPx, w: o.right - o.left + 2 * padPx, h: o.bottom - o.top + 2 * padPx})
  }
  let floor = height // where the map stops being visible
  for (const p of panels) {
    if (p.right <= p.left || p.bottom <= p.top) continue
    rects.push({x: p.left - host.left, y: p.top - host.top - padPx, w: p.right - p.left, h: edgePx})
    if (p.left <= host.left && p.right >= host.right) floor = Math.min(floor, p.top - host.top)
  }
  // Mostly off screen: a label that would be cut by the edge touches the strip.
  rects.push({x: padPx - edgePx, y: 0, w: edgePx, h: floor}, {x: width - padPx, y: 0, w: edgePx, h: floor})
  return rects.filter((r) => r.w > 0 && r.h > 0)
}

const box = (el) => {
  const b = el.getBoundingClientRect()
  return {left: b.left, top: b.top, right: b.right, bottom: b.bottom}
}

/**
 * @param map the home map, style loaded
 * @param o.host the element the map fills
 * @param o.panels elements that cover the bottom of the map (the sheet, the place card)
 * @param o.overlays selectors (inside host) of things lying over the map
 */
export function createLabelBlockers(map, {host, panels = [], overlays = []}) {
  let frame = 0
  let destroyed = false
  const round = (n) => Math.max(8, Math.ceil(n / 8) * 8)

  function imageFor(w, h) {
    const name = `${ID}-${w}x${h}`
    if (!map.hasImage(name)) map.addImage(name, {width: w, height: h, data: new Uint8Array(w * h * 4)}) // see-through
    return name
  }

  function update() {
    frame = 0
    if (destroyed) return
    const hostBox = box(host)
    const panelBoxes = panels.filter((el) => el && !el.hidden).map(box)
    // The logos first: where they end up is one of the things labels keep clear of.
    host.style.setProperty('--credits-left-px', `${creditsLift(hostBox, panelBoxes, 'left')}px`)
    host.style.setProperty('--credits-right-px', `${creditsLift(hostBox, panelBoxes, 'right')}px`)
    const overlayBoxes = overlays.flatMap((selector) => [...host.querySelectorAll(selector)]).map(box)
    const features = blockerRects(hostBox, {overlays: overlayBoxes, panels: panelBoxes}).map((r) => {
      const w = round(r.w)
      const h = round(r.h)
      const {lng, lat} = map.unproject([r.x + r.w / 2, r.y + r.h / 2])
      return {type: 'Feature', properties: {image: imageFor(w, h)}, geometry: {type: 'Point', coordinates: [lng, lat]}}
    })
    map.getSource(ID)?.setData({type: 'FeatureCollection', features})
  }

  const schedule = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(update)
  }

  try {
    map.addSource(ID, {type: 'geojson', data: {type: 'FeatureCollection', features: []}})
    // On top of every label layer: the map places the top layer first, so the blockers win.
    map.addLayer({
      id: ID,
      type: 'symbol',
      source: ID,
      layout: {'icon-image': ['get', 'image'], 'icon-allow-overlap': true, 'icon-padding': 0},
    })
    if (map.getLayer(NAMES)) {
      // A building name tries below its point first (as before), then beside it, and last above
      // it, where a pin may sit.
      map.setLayoutProperty(NAMES, 'text-variable-anchor', ['top', 'right', 'left', 'bottom'])
      map.setLayoutProperty(NAMES, 'text-radial-offset', HOME_MAP.labelOffsetEm)
      map.setLayoutProperty(NAMES, 'text-justify', 'auto')
    }
  } catch (err) {
    console.warn('[map] label blockers not set up', err?.message)
  }

  map.on('moveend', schedule)
  map.on('resize', schedule)
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  for (const el of panels) if (el) watcher?.observe(el)
  // A panel shown or hidden (the card opens, the sheet goes).
  const attrs = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
  for (const el of panels) if (el) attrs?.observe(el, {attributes: true, attributeFilter: ['hidden']})
  update()

  return {
    update: schedule,
    destroy() {
      destroyed = true
      cancelAnimationFrame(frame)
      watcher?.disconnect()
      attrs?.disconnect()
      map.off('moveend', schedule)
      map.off('resize', schedule)
      host.style.removeProperty('--credits-left-px')
      host.style.removeProperty('--credits-right-px')
    },
  }
}
