// "Add to Home Screen for full screen": a one-time hint on the home map, on phones only. Opened
// from the Home Screen the app has no browser bars, so the map has the whole screen.
//   Android Chrome: an Install button, using the browser's own install prompt (beforeinstallprompt,
//                   kept for us by main.js, which runs before this file is loaded).
//   iPhone (Safari or Chrome): no prompt exists, so the hint says what to tap.
// Never shown once installed (opened standalone) or once dismissed. The choice stays on this device.
import {html, render} from '../dom.js'
import {icon} from '../icons.js'
import {t} from '../../i18n/i18n.js'

const KEY = 'welcomeAR.installHint.v1'

/** Which hint, if any: 'install' (Android, prompt ready), 'ios' (tell them what to tap), or null. */
export function installHintKind({userAgent = '', standalone = false, dismissed = false, prompt = null} = {}) {
  if (standalone || dismissed) return null
  if (/iPhone|iPod/.test(userAgent)) return 'ios'
  // Desktop Chrome offers to install too: the hint is for phones, where it frees the screen.
  if (prompt && /Android/.test(userAgent)) return 'install'
  return null
}

function readDismissed(storage) {
  try {
    return storage?.getItem(KEY) === 'dismissed'
  } catch {
    return false
  }
}

function saveDismissed(storage) {
  try {
    storage?.setItem(KEY, 'dismissed')
  } catch {
    // blocked storage: it may show again next visit, which is harmless
  }
}

/** Is the app already open from the Home Screen? */
export function isStandalone(win = window) {
  return Boolean(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator.standalone)
}

/**
 * Show the hint in host (the home map), if this phone should see it. Returns a function that
 * removes it (the screen going away), or null when nothing was shown.
 */
export function showInstallHint(host, {win = window, storage = win.localStorage} = {}) {
  const kind = installHintKind({
    userAgent: win.navigator.userAgent,
    standalone: isStandalone(win),
    dismissed: readDismissed(storage),
    prompt: win.__installPrompt ?? null,
  })
  if (!kind || host.querySelector('[data-install-hint]')) return null
  const box = document.createElement('section')
  box.className = 'install-hint theme-auto'
  box.dataset.installHint = kind
  box.setAttribute('aria-label', t('install.region'))
  render(
    box,
    html`
      <span class="install-hint__icon">${icon('expand', {size: 20})}</span>
      <p class="install-hint__text">
        <strong>${t('install.text')}</strong>
        ${kind === 'ios' ? html`<span>${t('install.ios')}</span>` : ''}
      </p>
      ${kind === 'install' ? html`<button class="btn btn--primary install-hint__go" type="button" data-install-go>${t('install.button')}</button>` : ''}
      <button class="icon-btn install-hint__close" type="button" data-install-close aria-label="${t('install.dismiss')}">${icon('close', {size: 20})}</button>
    `,
  )
  host.append(box)

  const remove = () => box.remove()
  const dismiss = () => {
    saveDismissed(storage)
    remove()
  }
  box.querySelector('[data-install-close]').addEventListener('click', dismiss)
  box.querySelector('[data-install-go]')?.addEventListener('click', async () => {
    const prompt = win.__installPrompt
    win.__installPrompt = null // a prompt can be used once
    dismiss() // installed or not, the browser has asked: no need to ask again
    try {
      await prompt?.prompt()
    } catch {
      // the browser refused (already shown): nothing more to do
    }
  })
  return remove
}
