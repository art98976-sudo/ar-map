import {describe, expect, it} from 'vitest'
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
  it('draws the QR code inline, with a label, and loads nothing', () => {
    const markup = phoneHandoff('https://x.test/#/?to=library').value
    expect(markup).toContain('<svg')
    expect(markup).toContain('Open on your phone for AR')
    expect(markup).toMatch(/aria-label="QR code/)
    expect(markup).not.toMatch(/<img|https?:\/\/(?!www\.w3\.org)/)
  })
})
