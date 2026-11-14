// Stirling Welcome AR service worker (8.1). Keeps the app shell, fonts, icons, our own data and the
// AR engine on the phone, so the app opens and a trip carries on through a dropped connection.
// Only this site's own files are cached here. MazeMap, Mapbox and their map tiles are never stored
// by this worker: the browser's normal cache handles them, within their terms.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const SHELL = `shell-${VERSION}`
const RUNTIME = `runtime-${VERSION}`
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/fonts/inter-400.woff2',
  '/fonts/inter-500.woff2',
  '/fonts/inter-600.woff2',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Cache first: hashed build files, fonts, the AR engine. They never change under one name. */
async function cacheFirst(request) {
  const hit = await caches.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) (await caches.open(RUNTIME)).put(request, response.clone())
  return response
}

/** Network first, falling back to what was saved: pages and our data files. */
async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request)
    if (response.ok) (await caches.open(RUNTIME)).put(request, response.clone())
    return response
  } catch (err) {
    const hit = (await caches.match(request)) || (fallback && (await caches.match(fallback)))
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const {request} = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // third parties: never cached here
  if (url.pathname.startsWith('/api/')) return // counts and anything live
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'))
  } else if (/^\/(assets|fonts|external)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(networkFirst(request))
  }
})
