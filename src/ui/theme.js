// Item 11: light or dark. "Device" follows the phone's setting; Light or Dark from the menu wins
// over it, remembered on this device. Sets data-theme on <html> ('light' | 'dark', or none for
// Device), which tokens.css reads.
const KEY = 'welcomeAR.theme.v1'
export const THEMES = [
  {id: 'device', label: 'Device setting'},
  {id: 'light', label: 'Light'},
  {id: 'dark', label: 'Dark'},
]

export function getTheme(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(KEY)
    return THEMES.some((t) => t.id === value) ? value : 'device'
  } catch {
    return 'device'
  }
}

/** Put a theme on the page (and remember it). */
export function applyTheme(theme, {doc = globalThis.document, storage = globalThis.localStorage, save = true} = {}) {
  const id = THEMES.some((t) => t.id === theme) ? theme : 'device'
  if (id === 'device') delete doc.documentElement.dataset.theme
  else doc.documentElement.dataset.theme = id
  if (save) {
    try {
      storage?.setItem(KEY, id)
    } catch {
      // storage blocked: this visit only
    }
  }
  return id
}

/** Is the page dark right now (the choice, or the phone's setting under Device)? */
export function isDark(theme = getTheme(), win = globalThis.window) {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return Boolean(win?.matchMedia?.('(prefers-color-scheme: dark)').matches)
}
