// Inline SVG icons (24px grid, 2px rounded strokes). Decorative by default:
// pass a label to make an icon meaningful to screen readers.
import {raw} from './dom.js'

const PATHS = {
  camera:
    '<path d="M14.5 4h-5L7.5 6.5H5a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-2.5z"/><circle cx="12" cy="13" r="3.5"/>',
  map: '<path d="M9 4 3.6 6.2a1 1 0 0 0-.6.9V19a.6.6 0 0 0 .8.6L9 17.5l6 2.5 5.4-2.2a1 1 0 0 0 .6-.9V5a.6.6 0 0 0-.8-.6L15 6.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  footsteps:
    '<path d="M7 16.5c-1.7 0-3-1.6-3-4.2C4 9.6 5 7 7 7s2.6 2.4 2.4 5.2c-.1 1.6-.6 4.3-2.4 4.3zM6 19.5h2.6"/><path d="M17 12.5c1.7 0 3-1.6 3-4.2C20 5.6 19 3 17 3s-2.6 2.4-2.4 5.2c.1 1.6.6 4.3 2.4 4.3zM15.4 15.5H18"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  wifiOff:
    '<path d="m3 3 18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.5M12 8a12 12 0 0 1 9 3.8M2.5 8.8a15 15 0 0 1 3.1-2.2"/><path d="M12 20h.01"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  building: '<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11.5h1.5M13.5 11.5H15M10.5 20.5v-4h3v4"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h13v15h-13a2 2 0 0 0-2 2z"/><path d="M4.5 20.5v-15M19.5 18.5v2h-13"/>',
  home: '<path d="m3.5 11 8.5-7 8.5 7"/><path d="M5.5 9.5v10h13v-10M10 19.5v-5h4v5"/>',
  door: '<path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M4 20.5h16"/><path d="M14.5 12.5h.01"/>',
  dumbbell: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 2"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
}

/** Icon for a destination category (used in search results and chips). */
export const CATEGORY_ICON = {
  library: 'book',
  academic: 'building',
  services: 'info',
  sport: 'dumbbell',
  landmark: 'pin',
  living: 'home',
  room: 'door',
}

export function icon(name, {label, size = 24, className = ''} = {}) {
  const body = PATHS[name]
  if (!body) throw new Error(`Unknown icon: ${name}`)
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"'
  return raw(
    `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`,
  )
}
