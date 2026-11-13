// Offline (8.1): the service worker, and what the app says while the connection is gone.
/* global __BUILD_ID__ */

/** Register the worker in production only: in development it would hide code changes. */
export function registerServiceWorker(win = window) {
  const sw = win.navigator.serviceWorker
  if (!sw || !import.meta.env.PROD) return
  const id = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
  win.addEventListener('load', () => {
    sw.register(`/sw.js?v=${encodeURIComponent(id)}`).catch((err) => console.warn('[sw] not registered', err))
  })
}

/** Is the phone offline right now? */
export const isOffline = (nav = navigator) => nav.onLine === false
