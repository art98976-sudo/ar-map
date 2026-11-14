// @vitest-environment node
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {build} from 'vite'
import {devToolsFor} from '../../vite.config.js'

// The developer tools and info logs never reach the public site (item 4).
const DEBUG_CHUNKS = ['align-debug', 'scene-debug', 'walls-debug', 'simulate', 'ar-fieldtest']

describe('the developer-tools flag', () => {
  it('is on for the dev server, unit tests and test builds, off for production', () => {
    expect(devToolsFor('serve', 'development', {})).toBe(true)
    expect(devToolsFor('build', 'test', {})).toBe(true)
    expect(devToolsFor('build', 'production', {})).toBe(false)
    expect(devToolsFor('build', 'production', {VITE_DEV_TOOLS: '1'})).toBe(true)
  })
})

describe('a production build', {timeout: 180_000}, () => {
  let dir
  let files
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'welcome-ar-prod-'))
    await build({mode: 'production', logLevel: 'silent', build: {outDir: dir, emptyOutDir: true, sourcemap: false}})
    files = readdirSync(join(dir, 'assets'))
  }, 180_000)
  afterAll(() => dir && rmSync(dir, {recursive: true, force: true}))

  it('emits no debug chunks', () => {
    for (const name of DEBUG_CHUNKS) expect(files.filter((f) => f.startsWith(`${name}-`)), name).toEqual([])
  })

  it('keeps no info-level logs', () => {
    const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n')
    expect(js).not.toContain('console.info')
    expect(js).not.toMatch(/\[route\]`?,\s*\w+,\s*\w+\.length/) // the old "[route] mazemap 36 points"
  })
})
