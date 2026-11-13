import {describe, expect, it} from 'vitest'
import {qrSvg, shortLink} from '../../src/ui/screens/qr.js'
import {nearestOf} from '../../src/ui/components/home-sheet.js'

describe('one-scan entry (Group D)', () => {
  it('the short link opens the card with Go ready', () => {
    expect(shortLink('mm-1002085033', 'https://stirling-welcome-ar.vercel.app')).toBe('https://stirling-welcome-ar.vercel.app/p/mm-1002085033')
  })
  it('draws a QR code as an SVG', () => {
    const svg = qrSvg('https://stirling-welcome-ar.vercel.app/p/library')
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/)
    expect(svg).toContain('<path')
  })
})

describe('Nearest shortcuts (Group C)', () => {
  it('picks the closest of a kind', () => {
    const roomTypes = {toilet: [[1, 56.1450, -3.9200, 1, 'Toilet A', 'X'], [2, 56.1600, -3.9300, 1, 'Toilet B', 'Y']]}
    expect(nearestOf('toilet', {lat: 56.1451, lng: -3.9201}, {roomTypes}).name).toBe('Toilet A')
    const food = [{id: 'far', name: 'Far', lat: 56.16, lng: -3.93}, {id: 'near', name: 'Near', lat: 56.1452, lng: -3.9202}]
    expect(nearestOf('cafe', {lat: 56.1451, lng: -3.9201}, {food}).id).toBe('near')
    expect(nearestOf('lift', {lat: 56.1451, lng: -3.9201}, {roomTypes})).toBeNull()
  })
})
