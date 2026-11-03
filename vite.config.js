import {defineConfig} from 'vite'

export default defineConfig({
  server: {
    host: true, // reachable from a phone on the same Wi-Fi
    port: 5173,
    // Allow the HTTPS tunnel used by `npm run dev:phone`.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    port: 4310,
    strictPort: true,
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
  },
})
