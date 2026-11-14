import {describe, expect, it} from 'vitest'
import {fallbackArrow, paintFallback, unwrapTowards} from '../../src/ui/screens/ar-fallback.js'

const ready = {phase: 'ready', arrived: false, remainingM: 120, arrowBearingDeg: 90, heading: 60}

describe('B7: the big fallback arrow', () => {
  it('hides while tracking is GOOD, while the floor arrows still show, and before Start or after arrival', () => {
    expect(fallbackArrow({...ready, trackingState: 'WEAK', arrowsShown: true}).show).toBe(false)
    expect(fallbackArrow({...ready, trackingState: 'GOOD'}).show).toBe(false)
    expect(fallbackArrow({...ready, trackingState: 'WEAK', phase: 'await-start'}).show).toBe(false)
    expect(fallbackArrow({...ready, trackingState: 'LOST', arrived: true}).show).toBe(false)
  })
  it('points the way to walk from where the phone points, with the distance left', () => {
    expect(fallbackArrow({...ready, trackingState: 'WEAK'})).toEqual({show: true, turnDeg: 30, text: '120 m'})
    expect(fallbackArrow({...ready, trackingState: 'LOST', arrowBearingDeg: 10, heading: 350}).turnDeg).toBe(20)
    expect(fallbackArrow({...ready, trackingState: 'LOST', arrowBearingDeg: 350, heading: 10}).turnDeg).toBe(-20)
  })
  it('without a compass: no arrow, "Follow the map" and the distance', () => {
    expect(fallbackArrow({...ready, trackingState: 'WEAK', heading: null})).toEqual({show: true, turnDeg: null, text: 'Follow the map · 120 m'})
  })
  it('turns the short way, never spinning round', () => {
    expect(unwrapTowards(170, -170)).toBe(190)
    expect(unwrapTowards(-170, 170)).toBe(-190)
    expect(unwrapTowards(NaN, 45)).toBe(45)
  })
  it('paints into the AR view and goes when tracking is GOOD again', () => {
    document.body.innerHTML = `<div class="ar"><div data-fallback hidden><span data-fallback-arrow></span><p data-fallback-text></p></div></div>`
    const root = document.querySelector('.ar')
    paintFallback(root, {...ready, trackingState: 'LOST'})
    const el = root.querySelector('[data-fallback]')
    expect(el.hidden).toBe(false)
    expect(root.querySelector('[data-fallback-arrow]').style.transform).toBe('rotate(30deg)')
    expect(root.querySelector('[data-fallback-text]').textContent).toBe('120 m')
    paintFallback(root, {...ready, trackingState: 'GOOD'})
    expect(el.hidden).toBe(true)
  })
})
