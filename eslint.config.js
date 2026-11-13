import js from '@eslint/js'
import globals from 'globals'

export default [
  {ignores: ['dist/', 'public/external/', 'node_modules/', 'playwright-report/', 'test-results/', '.venv/', '.playwright-mcp/']},
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {globals: {...globals.browser}},
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
