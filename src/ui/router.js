// Tiny hash router: #/ (the map), #/locate, #/ar.
// Hash routes keep the phone's back button working and need no server config.
import {focusScreen} from './dom.js'

/**
 * A screen is a function (root, ctx) => cleanup | void.
 * `ctx.navigate(path)` moves to another screen. `ctx.params` holds ?query values.
 */
export function createRouter({root, routes, fallback = '/'}) {
  let cleanup = null
  let current = null
  let renderedHash = null // the address the current screen was drawn for

  function parse() {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const [path, query = ''] = raw.split('?')
    return {path, params: Object.fromEntries(new URLSearchParams(query))}
  }

  function render() {
    const {path, params} = parse()
    renderedHash = window.location.hash
    const screen = routes[path]
    if (!screen) {
      navigate(fallback, {replace: true})
      return
    }
    if (typeof cleanup === 'function') {
      try {
        cleanup()
      } catch (err) {
        console.error('[router] cleanup failed', err)
      }
    }
    root.replaceChildren()
    root.dataset.screen = path === '/' ? 'home' : path.slice(1)
    // Screens fade in with a CSS animation (base.css). We do not use the View Transitions
    // API: in testing it crashed WebKit when the address changed during a transition.
    root.classList.remove('is-entering')
    void root.offsetWidth // restart the animation
    if (current !== null) root.classList.add('is-entering')
    current = path
    window.scrollTo(0, 0)
    cleanup = screen(root, {navigate, params, path})
    // Move focus to the new screen's heading for screen-reader users.
    focusScreen(root)
  }

  /** `silent` changes the address only: the screen on show keeps itself in step with it. */
  function navigate(path, {replace = false, silent = false} = {}) {
    const hash = `#${path}`
    if (replace) window.history.replaceState(null, '', hash)
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    if (silent) renderedHash = window.location.hash
    else render()
  }

  // Back/forward fire popstate; typing a #/ address or tapping a #/ link fires hashchange
  // (WebKit does not always fire popstate for those). Draw once per address change.
  const onHistory = () => {
    if (window.location.hash !== renderedHash) render()
  }
  window.addEventListener('popstate', onHistory)
  window.addEventListener('hashchange', onHistory)
  return {start: render, navigate}
}
