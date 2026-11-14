import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'

// Item 11: text colours meet WCAG AA (4.5:1 for normal text) on their backgrounds, in both themes.
const css = readFileSync('src/styles/tokens.css', 'utf8').replace(/\r\n/g, '\n')
function block(selector) {
  const start = css.indexOf(selector)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}
function tokens(text) {
  return Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]))
}
const light = tokens(block(':root,\n.theme-auto {'))
const dark = {...light, ...tokens(block(":root[data-theme='dark'] .theme-auto {"))}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS = [
  ['--c-text', '--c-bg'],
  ['--c-text', '--c-surface'],
  ['--c-text-2', '--c-bg'],
  ['--c-text-2', '--c-surface'],
  ['--c-on-primary', '--c-primary'],
  ['--c-primary', '--c-bg'], // links and chosen items
  ['--c-primary', '--c-surface'],
]

describe('colour contrast, WCAG AA', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of PAIRS) {
      it(`${name}: ${fg} on ${bg}`, () => {
        expect(theme[fg], fg).toBeTruthy()
        expect(theme[bg], bg).toBeTruthy()
        expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  it('the dark theme really is dark, and set for both the phone setting and the menu', () => {
    expect(luminance(dark['--c-bg'])).toBeLessThan(0.05)
    const auto = tokens(block(":root:not([data-theme='light']) .theme-auto {"))
    expect(auto).toEqual(tokens(block(":root[data-theme='dark'] .theme-auto {")))
  })
})
