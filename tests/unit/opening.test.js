import {describe, expect, it} from 'vitest'
import {shouldOpen} from '../../src/ui/opening.js'

const memory = (v = null) => ({getItem: () => v, setItem() {}})

describe('the opening (7.4)', () => {
  it('plays on a plain start, once per session', () => {
    expect(shouldOpen({hash: '', storage: memory()})).toBe(true)
    expect(shouldOpen({hash: '#/', storage: memory()})).toBe(true)
    expect(shouldOpen({hash: '#/', storage: memory('1')})).toBe(false)
  })
  it('skips with reduce-motion, a destination link, or another screen', () => {
    expect(shouldOpen({hash: '#/', reducedMotion: true, storage: memory()})).toBe(false)
    expect(shouldOpen({hash: '#/?to=library', storage: memory()})).toBe(false)
    expect(shouldOpen({hash: '#/locate?to=library', storage: memory()})).toBe(false)
  })
})
