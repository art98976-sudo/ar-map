import {readFileSync} from 'node:fs'
import {defineConfig} from 'vite'

// The preview server sends the same security headers as Vercel (vercel.json), CSP included, so
// the browser tests run under the real policy.
const siteHeaders = Object.fromEntries(
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
    .headers.find((h) => h.source === '/(.*)')
    .headers.filter((h) => h.key !== 'Strict-Transport-Security')
    .map((h) => [h.key, h.value]),
)

export default defineConfig({
  // One id per build: the service worker keeps one set of files per build (public/sw.js).
  define: {__BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now()))},
  server: {
    host: true, // reachable from a phone on the same Wi-Fi
    port: 5173,
    // Allow the HTTPS tunnel used by `npm run dev:phone`.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    port: 4310,
    strictPort: true,
    headers: siteHeaders,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js (~190 kB gzipped) is lazy-loaded with the AR screen only.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup.js'],
  },
})
