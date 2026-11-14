import {describe, expect, it} from 'vitest'
import {distanceM, bearingDeg} from '../../src/geo/geo.js'
import {findMarker, markerIdFromPath, MARKERS, markerStart, markerUrl, STAND_OUT_M, standingSpot} from '../../src/route/markers.js'
import {DESTINATIONS} from '../../src/map/destinations.js'
import {standHereText} from '../../src/route/start-point.js'
import {signSvg} from '../../src/ui/sign.js'
import {qrSvg} from '../../src/ui/screens/qr.js'

// Item 8: calibration signs at the main entrances and the Bus Hub.
describe('calibration signs', () => {
  it('cover the main entrances and the Bus Hub, each for real places', () => {
    expect(MARKERS.map((m) => m.id)).toEqual(['cottrell-main', 'atrium', 'andrew-miller-main', 'pathfoot-main', 'bus-hub'])
    for (const m of MARKERS) for (const id of m.serves) expect(DESTINATIONS.some((d) => d.id === id), `${m.id}: ${id}`).toBe(true)
  })

  it('a sign link is /c/<id>, and only that', () => {
    expect(markerUrl('cottrell-main')).toBe('https://stirling-welcome-ar.vercel.app/c/cottrell-main')
    expect(markerIdFromPath('/c/cottrell-main')).toBe('cottrell-main')
    expect(markerIdFromPath('/p/library')).toBeNull()
  })

  it('starts 1.5 m in front of the sign, facing the way the sign faces (its back to the walker)', () => {
    const m = findMarker('cottrell-main')
    const spot = standingSpot(m)
    expect(distanceM(m, spot)).toBeCloseTo(STAND_OUT_M, 1)
    expect(bearingDeg(m, spot)).toBeCloseTo(m.facingDeg, 0)
    const start = markerStart(m)
    expect(start).toMatchObject({type: 'place', placeId: 'cottrell', headingDeg: m.facingDeg, markerId: 'cottrell-main'})
    expect(standHereText(start)).toBe('Stand with your back to the Cottrell main entrance sign, facing north.')
  })

  it('a sign whose direction is not measured yet still sets the place, and lets the compass do the rest', () => {
    const start = markerStart(findMarker('bus-hub'))
    expect(start.headingDeg).toBeNull()
    expect(standHereText(start)).toBe('Stand in front of the Bus Hub sign.')
  })

  it('prints as A5 with the code for its link and three steps', () => {
    const m = findMarker('pathfoot-main')
    const url = markerUrl(m.id)
    const svg = signSvg({marker: m, qr: qrSvg(url), url})
    expect(svg).toMatch(/width="148mm" height="210mm"/)
    expect(svg).toContain('Pathfoot main entrance')
    expect(svg).toContain(url)
    expect(svg).toContain('Turn round so this sign is behind you.')
    expect(svg).toContain('<path d="M') // the QR modules
  })
})
