import {beforeEach, describe, expect, it} from 'vitest'
import {stylesheetLoaded} from '../../src/map/mazemap.js'

// Item 5: the map waits for MazeMap's stylesheet, so Mapbox never runs without its CSS.
describe('MazeMap stylesheet', () => {
  beforeEach(() => document.head.querySelectorAll('link[data-mazemap]').forEach((l) => l.remove()))

  it('adds the sheet once and resolves only when it has loaded', async () => {
    let done = false
    const p = stylesheetLoaded(document, 'https://api.mazemap.com/js/v2.2.6/mazemap.min.css', 5000).then(() => (done = true))
    const links = document.head.querySelectorAll('link[data-mazemap]')
    expect(links).toHaveLength(1)
    await Promise.resolve()
    expect(done).toBe(false) // not before the sheet is there
    links[0].dispatchEvent(new Event('load'))
    await p
    expect(done).toBe(true)
    await stylesheetLoaded(document) // a second call: already loaded, nothing added
    expect(document.head.querySelectorAll('link[data-mazemap]')).toHaveLength(1)
  })

  it('a sheet that fails is removed and reported, so "Try again" can add it again', async () => {
    const p = stylesheetLoaded(document, 'https://api.mazemap.com/x.css', 5000)
    document.head.querySelector('link[data-mazemap]').dispatchEvent(new Event('error'))
    await expect(p).rejects.toMatchObject({name: 'MapLoadError'})
    expect(document.head.querySelector('link[data-mazemap]')).toBeNull()
  })
})
