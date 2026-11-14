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

// Developer tools (?simulate=1, ?debug=align|scene|route|walls, ?fieldtest=1) and info logs.
// On for `npm run dev`, unit tests and `vite build --mode test` (the browser tests and the field-test
// preview); off for the production build, where their code is not even emitted.
export const devToolsFor = (command, mode, env = process.env) => command === 'serve' || mode === 'test' || env.VITE_DEV_TOOLS === '1'

export default defineConfig(({command, mode}) => ({
  define: {
    // One id per build: the service worker keeps one set of files per build (public/sw.js).
    __BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now())),
    __DEV_TOOLS__: JSON.stringify(devToolsFor(command, mode)),
  },
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
}))
