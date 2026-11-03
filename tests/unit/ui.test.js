import {afterEach, describe, expect, it, vi} from 'vitest'
import {esc, html, render} from '../../src/ui/dom.js'
import {requestMotionPermission} from '../../src/ar/permissions.js'
import {createRouter} from '../../src/ui/router.js'
import {errorCopy} from '../../src/ui/screens/ar.js'

describe('html escaping', () => {
  it('escapes interpolated text', () => {
    const root = document.createElement('div')
    render(root, html`<p>${'<img src=x onerror=alert(1)>'}</p>`)
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe('<img src=x onerror=alert(1)>')
  })
  it('keeps nested fragments as markup', () => {
    const root = document.createElement('div')
    render(root, html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`)
    expect(root.querySelectorAll('li')).toHaveLength(2)
  })
  it('escapes quotes for attributes', () => {
    expect(esc(`"'`)).toBe('&quot;&#39;')
  })
})

describe('requestMotionPermission', () => {
  it('is not needed on Android and desktop', async () => {
    expect(await requestMotionPermission({DeviceMotionEvent: function () {}})).toBe('not-needed')
  })
  it('returns granted when iOS grants both', async () => {
    const win = {
      DeviceMotionEvent: {requestPermission: () => Promise.resolve('granted')},
      DeviceOrientationEvent: {requestPermission: () => Promise.resolve('granted')},
    }
    expect(await requestMotionPermission(win)).toBe('granted')
  })
  it('returns denied when iOS refuses or throws', async () => {
    expect(
      await requestMotionPermission({DeviceMotionEvent: {requestPermission: () => Promise.resolve('denied')}}),
    ).toBe('denied')
    expect(
      await requestMotionPermission({DeviceMotionEvent: {requestPermission: () => Promise.reject(new Error('x'))}}),
    ).toBe('denied')
  })
})

describe('errorCopy', () => {
  it('gives iPhone-specific camera steps', () => {
    const copy = errorCopy('camera-denied', {os: 'ios'})
    expect(copy.steps.join(' ')).toContain('Website Settings')
  })
  it('always offers a next action', () => {
    for (const code of ['camera-denied', 'motion-denied', 'offline', 'timeout', 'camera-failed', 'runtime', 'other']) {
      const copy = errorCopy(code)
      expect(copy.title).toBeTruthy()
      expect(copy.primary.action).toBeTruthy()
    }
  })
})

describe('router', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('renders the matching screen and cleans up the previous one', () => {
    const root = document.createElement('div')
    const cleanup = vi.fn()
    const router = createRouter({
      root,
      routes: {
        '/': (el) => {
          el.innerHTML = '<h1>Home</h1>'
          return cleanup
        },
        '/map': (el, ctx) => {
          el.innerHTML = `<h1>Map ${ctx.params.floor || ''}</h1>`
        },
      },
    })
    router.start()
    expect(root.textContent).toBe('Home')
    router.navigate('/map?floor=2')
    expect(root.textContent).toBe('Map 2')
    expect(cleanup).toHaveBeenCalledOnce()
    expect(root.dataset.screen).toBe('map')
  })

  it('falls back to home for unknown paths', () => {
    const root = document.createElement('div')
    window.history.replaceState(null, '', '#/nope')
    createRouter({root, routes: {'/': (el) => (el.innerHTML = '<h1>Home</h1>')}}).start()
    expect(root.textContent).toBe('Home')
    expect(window.location.hash).toBe('#/')
  })
})
