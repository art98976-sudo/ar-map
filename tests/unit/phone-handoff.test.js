import {describe, expect, it, vi} from 'vitest'
import {handoffUrl, needsHandoff, phoneHandoff} from '../../src/ui/components/phone-handoff.js'

describe('handoffUrl', () => {
  it('opens the place card on the phone', () => {
    expect(handoffUrl('library', 'https://stirling-welcome-ar.vercel.app')).toBe('https://stirling-welcome-ar.vercel.app/#/?to=library')
  })
  it('escapes odd ids and falls back to the home page', () => {
    expect(handoffUrl('poi:12 3', 'https://x.test')).toBe('https://x.test/#/?to=poi%3A12%203')
    expect(handoffUrl(null, 'https://x.test')).toBe('https://x.test/')
  })
})

describe('needsHandoff', () => {
  it('shows on a computer, without geolocation, or without a rear camera', () => {
    expect(needsHandoff({issueCode: 'desktop'})).toBe(true)
    expect(needsHandoff({hasGeolocation: false})).toBe(true)
    expect(needsHandoff({cameraMissing: true})).toBe(true)
  })
  it('stays away on a phone that can run AR, and in an in-app browser', () => {
    expect(needsHandoff({})).toBe(false)
    expect(needsHandoff({issueCode: 'old-os'})).toBe(false)
    expect(needsHandoff({issueCode: 'in-app-browser', hasGeolocation: false})).toBe(false)
  })
})

describe('phoneHandoff', () => {
  it('draws the QR code locally once the QR library has loaded, with a label, fetching nothing', async () => {
    const {hydrateHandoff} = await import('../../src/ui/components/phone-handoff.js')
    const markup = phoneHandoff('https://x.test/#/?to=library').value
    expect(markup).toContain('data-qr-url="https://x.test/#/?to=library"')
    document.body.innerHTML = `<div id="h">${markup}</div>`
    hydrateHandoff(document.getElementById('h'), {innerWidth: 390, matchMedia: () => ({matches: false})})
    await vi.waitFor(() => expect(document.querySelector('[data-qr-url] svg')).not.toBeNull(), {timeout: 5000}) // the QR library loads first
    expect(markup).toContain('Open on your phone for AR')
    expect(markup).toMatch(/aria-label="QR code/)
    expect(markup).not.toMatch(/<img|src="https?:/) // the code is drawn here, nothing is fetched
  })
})

describe('item 10: the AR demo video', async () => {
  const {DEMO_VIDEO, demoState, startDemoVideos} = await import('../../src/ui/components/phone-handoff.js')
  it('is in the panel, muted, looping, lazy, with a poster and captions, from this site only', () => {
    const markup = phoneHandoff('https://x.test/#/?to=library').value
    expect(markup).toMatch(/<video[^>]*\bmuted\b[^>]*\bloop\b[^>]*\bplaysinline\b[^>]*preload="none"/s)
    expect(markup).toContain(`data-src="${DEMO_VIDEO.src}"`)
    expect(markup).not.toMatch(/<video[^>]*\ssrc=/s) // not fetched until on screen
    expect(markup).toContain(`poster="${DEMO_VIDEO.poster}"`)
    expect(markup).toMatch(/<track kind="captions" srclang="en-GB"[^>]*default/)
    for (const path of [DEMO_VIDEO.src, DEMO_VIDEO.poster, DEMO_VIDEO.captions]) expect(path.startsWith('/media/')).toBe(true)
  })
  it('plays only on a wide screen while visible; poster only with reduced motion; gone if the file fails', () => {
    expect(demoState({widthPx: 390, visible: true, reducedMotion: false})).toBe('none')
    expect(demoState({widthPx: 1440, visible: true, reducedMotion: false})).toBe('play')
    expect(demoState({widthPx: 1440, visible: false, reducedMotion: false})).toBe('pause')
    expect(demoState({widthPx: 1440, visible: true, reducedMotion: true})).toBe('poster')
    expect(demoState({widthPx: 1440, visible: true, reducedMotion: false, failed: true})).toBe('none')
  })
  it('fetches the file only once it is on screen, and hides the slot if it fails', () => {
    document.body.innerHTML = `<div id="host">${phoneHandoff('https://x.test/').value}</div>`
    let observed = null
    const win = {
      innerWidth: 1440,
      matchMedia: () => ({matches: false}),
      IntersectionObserver: class {
        constructor(cb) { observed = cb }
        observe() {}
        disconnect() {}
      },
    }
    const host = document.getElementById('host')
    const video = host.querySelector('video')
    video.play = () => Promise.resolve()
    video.pause = () => {}
    startDemoVideos(host, win)
    expect(video.getAttribute('src')).toBeNull()
    observed([{target: video, isIntersecting: true}])
    expect(video.getAttribute('src')).toBe(DEMO_VIDEO.src)
    video.dispatchEvent(new Event('error'))
    expect(host.querySelector('[data-demo]').hidden).toBe(true)
  })
})
