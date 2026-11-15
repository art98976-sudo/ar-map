import {describe, expect, it} from 'vitest'
import {placeCard} from '../../src/ui/screens/home-view.js'
import {render} from '../../src/ui/dom.js'

// The map-first home screen: the HTML of the place card.
const LIBRARY = {id: 'library', name: 'Library', category: 'library', lat: 56.146, lng: -3.92}
function card(options) {
  const el = document.createElement('section')
  render(el, placeCard(LIBRARY, '2 min · 150 m', options))
  return el
}
const label = (b) => b.textContent.replace(/\s+/g, ' ').trim()

describe('item 6: the place card buttons', () => {
  it('a phone that runs AR: Walk with AR first (data-go), Map directions second', () => {
    const buttons = [...card({arIssue: null}).querySelectorAll('[data-go-actions] button')]
    expect(buttons.map(label)).toEqual(['Walk with AR', 'Map directions'])
    expect(buttons[0].dataset.action).toBe('walk')
    expect(buttons[0].hasAttribute('data-go')).toBe(true)
    expect(buttons[0].classList.contains('btn--primary')).toBe(true)
    expect(buttons[1].dataset.action).toBe('map-trip')
    expect(buttons[1].hasAttribute('data-go')).toBe(false)
    expect(buttons[1].classList.contains('btn--secondary')).toBe(true)
  })

  it('a device that cannot run AR: the one map button, as before', () => {
    const buttons = [...card({arIssue: {code: 'desktop'}}).querySelectorAll('[data-go-actions] button')]
    expect(buttons.map(label)).toEqual(['Go'])
    expect(buttons[0].dataset.action).toBe('map-trip')
    expect(buttons[0].hasAttribute('data-go')).toBe(true)
    expect(buttons[0].hasAttribute('data-go-map')).toBe(true)
  })
})
