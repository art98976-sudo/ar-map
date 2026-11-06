import {afterEach, describe, expect, it, vi} from 'vitest'
import {esc, focusScreen, html, render} from '../../src/ui/dom.js'
import {
  markPermissionsAllowed,
  permissionsAllowed,
  requestMotionPermission,
  settlePermissions,
  startPermissionRequests,
  takePendingPermissions,
} from '../../src/ar/permissions.js'
import {createRouter} from '../../src/ui/router.js'
import {errorCopy} from '../../src/ui/screens/ar-errors.js'

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

  it('changes only the address on a silent navigate, and does not redraw on the way back to it', () => {
    const root = document.createElement('div')
    const home = vi.fn((el) => {
      el.innerHTML = '<h1>Home</h1>'
    })
    const router = createRouter({root, routes: {'/': home}})
    router.start()
    router.navigate('/?to=library', {replace: true, silent: true})
    expect(window.location.hash).toBe('#/?to=library')
    window.dispatchEvent(new Event('popstate'))
    expect(home).toHaveBeenCalledOnce()
  })

  it('focuses the first heading that is not hidden', () => {
    const root = document.createElement('div')
    root.innerHTML = '<section hidden><h1 tabindex="-1" id="a">Hidden</h1></section><h1 tabindex="-1" id="b">Shown</h1>'
    document.body.append(root)
    focusScreen(root)
    expect(document.activeElement?.id).toBe('b')
    root.remove()
  })

  it('falls back to home for unknown paths', () => {
    const root = document.createElement('div')
    window.history.replaceState(null, '', '#/nope')
    createRouter({root, routes: {'/': (el) => (el.innerHTML = '<h1>Home</h1>')}}).start()
    expect(root.textContent).toBe('Home')
    expect(window.location.hash).toBe('#/')
  })
})

describe('the one tap', () => {
  it('starts motion, camera and GPS synchronously, before any await', () => {
    const calls = []
    vi.stubGlobal('DeviceMotionEvent', undefined)
    const getUserMedia = vi.fn(() => {
      calls.push('camera')
      return Promise.resolve({getTracks: () => []})
    })
    const watchPosition = vi.fn(() => {
      calls.push('gps')
      return 1
    })
    Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia}})
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition, clearWatch: vi.fn()}})
    window.DeviceMotionEvent = {
      requestPermission: () => {
        calls.push('motion')
        return Promise.resolve('granted')
      },
    }
    const pending = startPermissionRequests()
    // Nothing has been awaited yet, and all three have already been asked, motion first.
    expect(calls).toEqual(['motion', 'camera', 'gps'])
    expect(takePendingPermissions()).toBe(pending)
    expect(takePendingPermissions()).toBeNull()
    delete window.DeviceMotionEvent
    vi.unstubAllGlobals()
  })

  it('marks permissions allowed when motion is granted or not needed, not when denied', async () => {
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition: () => 1, clearWatch: () => {}}})
    markPermissionsAllowed(false)
    window.DeviceMotionEvent = {requestPermission: () => Promise.resolve('denied')}
    const denied = await settlePermissions(startPermissionRequests())
    expect(denied.motion).toBe('denied')
    expect(permissionsAllowed()).toBe(false)
    delete window.DeviceMotionEvent
    const fine = startPermissionRequests()
    await settlePermissions(fine)
    expect(permissionsAllowed()).toBe(true)
    markPermissionsAllowed(false)
    takePendingPermissions()
  })

  it('does not wait for ever on a camera prompt that never settles', async () => {
    const answer = await settlePermissions({motion: Promise.resolve('granted'), camera: new Promise(() => {})}, 5)
    expect(answer).toEqual({motion: 'granted', camera: 'unknown'})
  })
})

describe('the GPS watch from the tap', () => {
  it('hands over to the location screen with the fix it already has, using one watch', () => {
    const watchers = []
    const clearWatch = vi.fn()
    const watchPosition = vi.fn((ok) => {
      watchers.push(ok)
      return 1
    })
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {watchPosition, clearWatch}})
    const {gps} = startPermissionRequests()
    takePendingPermissions()
    const fix = {coords: {latitude: 56, longitude: -3, accuracy: 5}}
    watchers[0](fix) // arrives while the permission prompts are still up
    const onFix = vi.fn()
    gps.listen({onFix, onError: vi.fn()})
    expect(onFix).toHaveBeenCalledWith(fix)
    watchers[0](fix)
    expect(onFix).toHaveBeenCalledTimes(2)
    expect(watchPosition).toHaveBeenCalledTimes(1)
    gps.stop()
    expect(clearWatch).toHaveBeenCalledTimes(1)
    markPermissionsAllowed(false)
  })
})
