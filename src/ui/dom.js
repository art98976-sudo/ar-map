// Small DOM helpers. `html` escapes every interpolated value unless wrapped in raw(),
// so text from data files can never inject markup.

const RAW = Symbol('raw')

export function raw(value) {
  return {[RAW]: true, value: String(value)}
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toHtml(value) {
  if (value == null || value === false) return ''
  if (Array.isArray(value)) return value.map(toHtml).join('')
  if (typeof value === 'object' && value[RAW]) return value.value
  return esc(value)
}

/** Tagged template: html`<p>${userText}</p>` returns a raw() fragment. */
export function html(strings, ...values) {
  let out = strings[0]
  values.forEach((v, i) => {
    out += toHtml(v) + strings[i + 1]
  })
  return raw(out)
}

/** Replace the contents of `root` with an html`` fragment. */
export function render(root, fragment) {
  root.innerHTML = toHtml(fragment)
  return root
}

/** Wire click handlers by data-action name. Returns a cleanup function. */
export function onAction(root, handlers) {
  const listener = (event) => {
    const target = event.target.closest('[data-action]')
    if (!target || !root.contains(target)) return
    const handler = handlers[target.dataset.action]
    if (handler) {
      event.preventDefault()
      handler(event, target)
    }
  }
  root.addEventListener('click', listener)
  return () => root.removeEventListener('click', listener)
}

/** Light haptic tap where supported (Android). iPhone Safari ignores it silently. */
export function haptic(pattern = 12) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // not supported
  }
}
