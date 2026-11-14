import {describe, expect, it, vi} from 'vitest'
import {planWhenStyleLoaded, whenStyleLoaded} from '../../src/map/mazemap.js'

/** A map whose style is still loading until `finish(event)` is called. */
function fakeMap(loaded = false) {
  const handlers = new Map()
  return {
    loaded,
    isStyleLoaded() {
      return this.loaded
    },
    on(event, fn) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
    },
    off(event, fn) {
      handlers.set(event, (handlers.get(event) ?? []).filter((f) => f !== fn))
    },
    listeners: (event) => (handlers.get(event) ?? []).length,
    finish(event) {
      this.loaded = true
      for (const fn of handlers.get(event) ?? []) fn()
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('waiting for the map style', () => {
  it('does not plan the route while the style is still loading', async () => {
    const map = fakeMap()
    const plan = vi.fn(async () => ({status: 'ok'}))
    const planned = planWhenStyleLoaded(map, plan)
    await tick()
    expect(plan).not.toHaveBeenCalled()
    map.finish('idle')
    await expect(planned).resolves.toEqual({status: 'ok'})
    expect(plan).toHaveBeenCalledTimes(1)
  })

  it('plans at once when the style has loaded, or when there is no map yet', async () => {
    const plan = vi.fn(async () => 'route')
    await expect(planWhenStyleLoaded(fakeMap(true), plan)).resolves.toBe('route')
    await expect(planWhenStyleLoaded(null, plan)).resolves.toBe('route')
    expect(plan).toHaveBeenCalledTimes(2)
  })

  it('is ready on the load event too, and leaves no listeners behind', async () => {
    const map = fakeMap()
    const ready = whenStyleLoaded(map)
    map.finish('load')
    await expect(ready).resolves.toBe(true)
    expect(map.listeners('load') + map.listeners('idle')).toBe(0)
  })

  it('gives up after the timeout, so a map that never loads does not block the card', async () => {
    const map = fakeMap()
    await expect(whenStyleLoaded(map, {timeoutMs: 5})).resolves.toBe(false)
    expect(map.listeners('load') + map.listeners('idle')).toBe(0)
  })
})
