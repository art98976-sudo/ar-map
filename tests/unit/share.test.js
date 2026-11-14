import {describe, expect, it, vi} from 'vitest'
import {placeLink, shareData, sharePlace} from '../../src/ui/share.js'

// Item 9: share a place with the deep link, nothing added; copy where there is no share sheet.
const LIBRARY = {id: 'library', name: 'Library'}
const ORIGIN = 'https://stirling-welcome-ar.vercel.app'

describe('share a place', () => {
  it('shares the deep link and nothing else', () => {
    expect(placeLink('library', ORIGIN)).toBe('https://stirling-welcome-ar.vercel.app/#/?to=library')
    expect(placeLink('mm-1002085033', ORIGIN)).toBe(`${ORIGIN}/#/?to=mm-1002085033`)
    expect(shareData(LIBRARY, ORIGIN)).toEqual({title: 'Library', text: 'Library, University of Stirling campus', url: `${ORIGIN}/#/?to=library`})
    expect(placeLink('library', ORIGIN)).not.toMatch(/utm_|ref=|src=/)
  })
  it('uses the share sheet where there is one', async () => {
    const nav = {share: vi.fn(() => Promise.resolve()), clipboard: {writeText: vi.fn()}}
    expect(await sharePlace(LIBRARY, {nav, origin: ORIGIN})).toEqual({result: 'shared', url: `${ORIGIN}/#/?to=library`})
    expect(nav.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('closing the share sheet is not an error, and copies nothing', async () => {
    const nav = {share: () => Promise.reject(Object.assign(new Error('x'), {name: 'AbortError'})), clipboard: {writeText: vi.fn()}}
    expect((await sharePlace(LIBRARY, {nav, origin: ORIGIN})).result).toBe('cancelled')
    expect(nav.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('copies the link where there is no share sheet', async () => {
    const nav = {clipboard: {writeText: vi.fn(() => Promise.resolve())}}
    expect((await sharePlace(LIBRARY, {nav, origin: ORIGIN})).result).toBe('copied')
    expect(nav.clipboard.writeText).toHaveBeenCalledWith(`${ORIGIN}/#/?to=library`)
  })
  it('says it failed (so the link can be shown) when nothing works', async () => {
    const doc = {createElement: () => {throw new Error('no')}}
    expect(await sharePlace(LIBRARY, {nav: {}, origin: ORIGIN, doc})).toEqual({result: 'failed', url: `${ORIGIN}/#/?to=library`})
  })
})
