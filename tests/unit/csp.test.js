// @vitest-environment node
import {existsSync, readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

// The content security policy (item 6). 'unsafe-eval' is there for MazeMap only; docs/SECURITY.md
// says why and how it was tested. This keeps the policy and the note together.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const csp = vercel.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value
const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

describe('content security policy', () => {
  it("allows 'unsafe-eval' only with the note naming the dependency that needs it", () => {
    expect(directive('script-src')).toContain("'unsafe-eval'")
    expect(existsSync('docs/SECURITY.md')).toBe(true)
    const note = readFileSync('docs/SECURITY.md', 'utf8')
    expect(note).toContain("`script-src 'unsafe-eval'`: needed by MazeMap JS API v2.2.6")
    expect(note).toContain('mazemap.min.js')
  })

  it("keeps 'wasm-unsafe-eval' for the XR engine, and no inline scripts", () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'")
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
  })

  it('loads scripts only from this site and the two map providers', () => {
    const sources = directive('script-src').split(/\s+/).slice(1).filter((s) => !s.startsWith("'"))
    expect(sources).toEqual(['https://api.mazemap.com', 'https://api.mapbox.com'])
  })
})
