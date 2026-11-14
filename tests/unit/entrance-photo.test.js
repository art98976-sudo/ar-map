import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {entranceFigure, entranceFor, usePlaceholderOnError} from '../../src/ui/components/entrance-photo.js'
import {DESTINATIONS} from '../../src/map/destinations.js'

// Item 10: on arrival, which door and a photo of it.
const data = JSON.parse(readFileSync('src/data/entrance-photos.json', 'utf8'))
const load = () => Promise.resolve({default: data})

describe('entrance photos', () => {
  it('every entry is a real place, with a door name, a photo path and alt text', () => {
    for (const [id, e] of Object.entries(data.photos)) {
      expect(DESTINATIONS.some((d) => d.id === id), id).toBe(true)
      expect(e.entrance.length).toBeGreaterThan(3)
      expect(e.photo).toMatch(/^\/media\/entrances\/[\w-]+\.jpg$/)
      expect(e.alt.length).toBeGreaterThan(10)
    }
  })
  it('finds the entrance for a place, or nothing', async () => {
    expect(await entranceFor('library', load)).toMatchObject({entrance: expect.stringMatching(/Andrew Miller/), placeholder: '/media/entrances/placeholder.svg'})
    expect(await entranceFor('scran', load)).toBeNull()
  })
  it('the photo loads lazily, with its size set (no jump) and alt text', async () => {
    const markup = entranceFigure(await entranceFor('cottrell', load)).value
    expect(markup).toMatch(/<img[^>]+loading="lazy"[^>]+decoding="async"/)
    expect(markup).toMatch(/width="400" height="300"/)
    expect(markup).toContain('<figcaption>Cottrell main entrance</figcaption>')
  })
  it('a photo not supplied yet shows the placeholder', async () => {
    document.body.innerHTML = entranceFigure(await entranceFor('cottrell', load)).value
    usePlaceholderOnError(document.body)
    const img = document.querySelector('img')
    img.dispatchEvent(new Event('error'))
    expect(img.getAttribute('src')).toBe('/media/entrances/placeholder.svg')
  })
})
