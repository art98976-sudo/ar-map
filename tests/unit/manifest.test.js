import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

// The install manifest: every icon exists, is the size it claims, and Android gets a maskable one.
const pub = join(import.meta.dirname, '..', '..', 'public')
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8'))
const sw = readFileSync(join(pub, 'sw.js'), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const b = readFileSync(join(pub, file))
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

describe('manifest.webmanifest', () => {
  it('has an id and a scope', () => {
    expect(manifest.id).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true)
  })

  it('lists PNG icons that are really the sizes they say', () => {
    for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
      expect(pngSize(icon.src.slice(1)), icon.src).toBe(icon.sizes)
    }
  })

  it('has the 192 and 512 icons Android asks for, and a 512 maskable one', () => {
    const has = (sizes, purpose) => manifest.icons.some((i) => i.sizes === sizes && (i.purpose ?? 'any').split(' ').includes(purpose))
    expect(has('192x192', 'any')).toBe(true)
    expect(has('512x512', 'any')).toBe(true)
    expect(has('512x512', 'maskable')).toBe(true)
  })

  it('keeps every icon for offline use', () => {
    for (const icon of manifest.icons) expect(sw).toContain(`'${icon.src}'`)
  })
})
