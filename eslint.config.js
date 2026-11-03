import js from '@eslint/js'
import globals from 'globals'

export default [
  {ignores: ['dist/', 'public/external/', 'node_modules/', 'playwright-report/', 'test-results/']},
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {globals: {...globals.browser}},
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js', 'tests/**/*.js'],
    languageOptions: {globals: {...globals.node, ...globals.browser}},
  },
  {
    rules: {
      'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
    },
  },
]
