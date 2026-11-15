import {describe, expect, it, vi} from 'vitest'
import {installHintKind, isStandalone, showInstallHint} from '../../src/ui/components/install-hint.js'

// Map-first item 7: the one-time "Add to Home Screen for full screen" hint.
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function memoryStorage() {
  const data = new Map()
  return {getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data}
}
function fakeWin(userAgent, {standalone = false, prompt = null} = {}) {
  return {
    navigator: {userAgent, standalone: standalone === 'ios' ? true : undefined},
    matchMedia: (q) => ({matches: standalone === true && q === '(display-mode: standalone)'}),
    __installPrompt: prompt,
  }
}

describe('which hint', () => {
  it('iPhone, in Safari or Chrome: what to tap', () => {
    expect(installHintKind({userAgent: IPHONE_SAFARI})).toBe('ios')
    expect(installHintKind({userAgent: IPHONE_CHROME})).toBe('ios')
  })
  it('Android Chrome: an Install button, once Chrome has offered its prompt', () => {
    expect(installHintKind({userAgent: ANDROID_CHROME, prompt: {}})).toBe('install')
    expect(installHintKind({userAgent: ANDROID_CHROME})).toBeNull()
  })
  it('never on a computer, once installed, or once dismissed', () => {
    expect(installHintKind({userAgent: DESKTOP_CHROME, prompt: {}})).toBeNull()
    expect(installHintKind({userAgent: IPHONE_SAFARI, standalone: true})).toBeNull()
    expect(installHintKind({userAgent: ANDROID_CHROME, prompt: {}, dismissed: true})).toBeNull()
  })
  it('standalone: the display mode, or Safari’s navigator.standalone', () => {
    expect(isStandalone(fakeWin(ANDROID_CHROME, {standalone: true}))).toBe(true)
    expect(isStandalone(fakeWin(IPHONE_SAFARI, {standalone: 'ios'}))).toBe(true)
    expect(isStandalone(fakeWin(IPHONE_SAFARI))).toBe(false)
  })
})

describe('the hint', () => {
  it('iPhone: says Share, then Add to Home Screen; Dismiss hides it for good', () => {
    const host = document.createElement('div')
    const storage = memoryStorage()
    const remove = showInstallHint(host, {win: fakeWin(IPHONE_SAFARI), storage})
    expect(remove).toBeTypeOf('function')
    const hint = host.querySelector('[data-install-hint]')
    expect(hint.getAttribute('aria-label')).toBe('Add to Home Screen')
    expect(hint.textContent).toContain('Add to Home Screen for full screen')
    expect(hint.textContent).toContain('Tap Share, then Add to Home Screen.')
    expect(hint.querySelector('[data-install-go]')).toBeNull()
    const close = hint.querySelector('[data-install-close]')
    expect(close.getAttribute('aria-label')).toBe('Dismiss the Home Screen tip')
    close.click()
    expect(host.querySelector('[data-install-hint]')).toBeNull()
    expect(storage.data.get('welcomeAR.installHint.v1')).toBe('dismissed')
    expect(showInstallHint(host, {win: fakeWin(IPHONE_SAFARI), storage})).toBeNull()
  })

  it('Android: Install opens Chrome’s own prompt, once', async () => {
    const host = document.createElement('div')
    const storage = memoryStorage()
    const prompt = {prompt: vi.fn(() => Promise.resolve())}
    const win = fakeWin(ANDROID_CHROME, {prompt})
    showInstallHint(host, {win, storage})
    const go = host.querySelector('[data-install-go]')
    expect(go.textContent.trim()).toBe('Install')
    go.click()
    await Promise.resolve()
    expect(prompt.prompt).toHaveBeenCalledOnce()
    expect(win.__installPrompt).toBeNull()
    expect(host.querySelector('[data-install-hint]')).toBeNull()
    expect(storage.data.get('welcomeAR.installHint.v1')).toBe('dismissed')
  })

  it('nothing when opened from the Home Screen, and storage that throws is fine', () => {
    const host = document.createElement('div')
    expect(showInstallHint(host, {win: fakeWin(IPHONE_SAFARI, {standalone: 'ios'}), storage: memoryStorage()})).toBeNull()
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    }
    showInstallHint(host, {win: fakeWin(IPHONE_SAFARI), storage: blocked})
    expect(() => host.querySelector('[data-install-close]').click()).not.toThrow()
  })
})
