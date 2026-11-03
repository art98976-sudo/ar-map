// Tiny hash router: #/ (home), #/check, #/ar, #/map, #/about.
// Hash routes keep the phone's back button working and need no server config.

/**
 * A screen is a function (root, ctx) => cleanup | void.
 * `ctx.navigate(path)` moves to another screen. `ctx.params` holds ?query values.
 */
export function createRouter({root, routes, fallback = '/'}) {
  let cleanup = null
  let current = null

  function parse() {
    const raw = window.location.hash.replace(/^#/, '') || '/'
    const [path, query = ''] = raw.split('?')
    return {path, params: Object.fromEntries(new URLSearchParams(query))}
  }

  function render({animate = true} = {}) {
    const {path, params} = parse()
    const screen = routes[path]
    if (!screen) {
      navigate(fallback, {replace: true})
      return
    }
    const swap = () => {
      if (typeof cleanup === 'function') {
        try {
          cleanup()
        } catch (err) {
          console.error('[router] cleanup failed', err)
        }
      }
      root.replaceChildren()
      root.dataset.screen = path === '/' ? 'home' : path.slice(1)
      current = path
      window.scrollTo(0, 0)
      cleanup = screen(root, {navigate, params, path})
      // Move focus to the new screen's heading for screen-reader users.
      root.querySelector('h1, [data-autofocus]')?.focus?.({preventScroll: true})
    }
    // Smooth cross-fade where supported (Safari 18+, Chrome). Skipped for reduced motion,
    // and for back/forward/link history changes: iOS swipe-back already animates, and a view
    // transition started inside a history navigation crashed WebKit in testing.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (animate && document.startViewTransition && !reduce && current !== null) document.startViewTransition(swap)
    else swap()
  }

  function navigate(path, {replace = false} = {}) {
    const hash = `#${path}`
    if (replace) window.history.replaceState(null, '', hash)
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    render()
  }

  const onHistory = () => render({animate: false})
  window.addEventListener('popstate', onHistory)
  return {start: () => render({animate: false}), navigate}
}
