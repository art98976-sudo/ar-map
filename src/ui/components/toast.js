// Toasts: short messages at the bottom of the screen ("Link copied", "Located").
// One region for the whole app, announced politely to screen readers.
import {esc} from '../dom.js'

let region = null

function getRegion() {
  if (region && document.body.contains(region)) return region
  region = document.createElement('div')
  region.className = 'toast-region'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  document.body.appendChild(region)
  return region
}

/** @param {string} message @param {{duration?: number, tone?: 'neutral'|'success'|'warning'}} opts */
export function showToast(message, {duration = 2600, tone = 'neutral'} = {}) {
  const host = getRegion()
  const toast = document.createElement('div')
  toast.className = `toast toast--${tone}`
  toast.innerHTML = `<span>${esc(message)}</span>`
  host.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('is-visible'))
  const hide = () => {
    toast.classList.remove('is-visible')
    setTimeout(() => toast.remove(), 250)
  }
  const timer = setTimeout(hide, duration)
  return () => {
    clearTimeout(timer)
    hide()
  }
}
