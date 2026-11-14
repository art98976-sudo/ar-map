import {describe, expect, it} from 'vitest'
import {directionWords, placeDetails, showArrival} from '../../src/ui/components/arrival.js'

describe('B6: the arrival card', () => {
  it('says which way the place is from where the phone points', () => {
    expect(directionWords(10)).toBe('straight ahead')
    expect(directionWords(-25)).toBe('straight ahead')
    expect(directionWords(80)).toBe('on your right')
    expect(directionWords(-80)).toBe('on your left')
    expect(directionWords(170)).toBe('behind you')
    expect(directionWords(null)).toBeNull()
  })
  it('gives the building, the level and what the place is', () => {
    expect(placeDetails({name: 'A3 Lecture Theatre', building: 'Cottrell Building', floor: 2, kind: 'Lecture theatre'})).toEqual({
      where: 'Cottrell Building · Level 2',
      about: 'Lecture theatre',
    })
    expect(placeDetails({name: 'Library', building: 'Library', floor: null, description: 'Study spaces.'})).toEqual({where: '', about: 'Study spaces.'})
  })
  it('shows them on the card, with an arrow turned the right way', () => {
    const host = document.createElement('div')
    showArrival(host, {name: 'A3 Lecture Theatre', turnDeg: -90, place: {name: 'A3 Lecture Theatre', building: 'Cottrell Building', floor: 2}, reducedMotion: true})
    expect(host.querySelector('[data-arrival-way]').textContent).toContain('It’s on your left')
    expect(host.querySelector('.arrival__way-arrow').getAttribute('style')).toContain('rotate(-90deg)')
    expect(host.querySelector('[data-arrival-about]').textContent).toContain('Cottrell Building · Level 2')
  })
  it('at a building door: "The door is …"; without a direction, no line', () => {
    const host = document.createElement('div')
    showArrival(host, {name: 'A3', entrance: 'Cottrell main entrance', turnDeg: 5, reducedMotion: true})
    expect(host.querySelector('[data-arrival-way]').textContent).toContain('The door is straight ahead')
    showArrival(host, {name: 'Library', reducedMotion: true})
    expect(host.querySelector('[data-arrival-way]')).toBeNull()
  })
})
