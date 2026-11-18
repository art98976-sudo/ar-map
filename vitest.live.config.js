// Item 21: the checks against LIVE MazeMap (tests/live). Not part of `npm test`: they need the
// network, which CI and the cloud sandbox do not have. Run from a laptop: npm run test:live
import {defineConfig} from 'vitest/config'
import viteConfig from './vite.config.js'

// The app's own build settings, with its test block replaced (mergeConfig would add the unit tests).
export default defineConfig({
  ...viteConfig,
  test: {
    // Node, with Node's own fetch (it honours a proxy: NODE_USE_ENV_PROXY=1). The trip needs only
    // window.THREE, which the test file provides.
    environment: 'node',
    include: ['tests/live/**/*.test.js'],
    setupFiles: [], // no fetch stub: the trip and the checks reach MazeMap for real
    testTimeout: 900_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
