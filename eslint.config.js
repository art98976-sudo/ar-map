import js from '@eslint/js'
import globals from 'globals'

export default [
  {ignores: ['dist/', 'public/external/', 'node_modules/', 'playwright-report/', 'test-results/', '.venv/', '.playwright-mcp/']},
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    // __DEV_TOOLS__ is set by vite.config.js at build time (offline.js declares __BUILD_ID__ itself).
    languageOptions: {globals: {...globals.browser, __DEV_TOOLS__: 'readonly'}},
  },
  {
    files: ['public/sw.js'],
    languageOptions: {globals: {...globals.serviceworker}},
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'tools/**/*.mjs', '*.config.js', 'tests/**/*.js'],
    languageOptions: {globals: {...globals.node, ...globals.browser}},
  },
  {
    rules: {
      'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
    },
  },
]
