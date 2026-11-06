// The full-height sheets on the home screen.
// Each open sheet is one history entry, so the phone's back button closes it.
export function createSheets(root, sheets, behind, onHistoryChange) {
  let shown = null

  function show(name) {
    shown = name
    for (const [key, sheet] of Object.entries(sheets)) sheet.element.hidden = key !== name
    behind.forEach((el) => el.toggleAttribute('inert', true))
  }

  function hide({restoreFocus = true} = {}) {
    if (!shown) return
    const opener = root.querySelector(`[data-action="${sheets[shown].opener}"]`)
    shown = null
    for (const sheet of Object.values(sheets)) sheet.element.hidden = true
    behind.forEach((el) => el.toggleAttribute('inert', false))
    if (restoreFocus) opener?.focus({preventScroll: true})
  }

  const onPopState = () => {
    const wanted = window.history.state?.sheet ?? null
    if (wanted !== shown) {
      if (wanted) show(wanted)
      else hide()
    }
    onHistoryChange()
  }
  window.addEventListener('popstate', onPopState)

  return {
    show,
    open(name) {
      show(name)
      window.history.pushState({sheet: name}, '')
    },
    close(options) {
      if (!shown) return
      hide(options)
      if (window.history.state?.sheet) window.history.back()
    },
    destroy: () => window.removeEventListener('popstate', onPopState),
  }
}
