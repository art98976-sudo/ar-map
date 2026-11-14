// Item 9: share a place. The phone's own share sheet (Web Share API) where there is one, else the
// link is copied. The link is the app's own deep link, #/?to=<id>, with nothing added: no
// tracking, no source, no user.

/** The link for a place: this site, its card. Pure. */
export function placeLink(id, origin = globalThis.location?.origin ?? '') {
  return `${origin}/#/?${new URLSearchParams({to: id})}`
}

/** What the share sheet gets. Pure. */
export function shareData(place, origin) {
  return {title: place.name, text: `${place.name}, University of Stirling campus`, url: placeLink(place.id, origin)}
}

/**
 * Share or copy. Returns {result, url}: 'shared', 'copied', 'cancelled' (the person closed the
 * share sheet), or 'failed' (show the link).
 */
export async function sharePlace(place, {nav = globalThis.navigator, origin, doc = globalThis.document} = {}) {
  const data = shareData(place, origin)
  if (nav?.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data)
      return {result: 'shared', url: data.url}
    } catch (err) {
      if (err?.name === 'AbortError') return {result: 'cancelled', url: data.url}
      // anything else (not allowed here): fall back to copying
    }
  }
  try {
    await nav.clipboard.writeText(data.url)
    return {result: 'copied', url: data.url}
  } catch {
    // no Clipboard API, or refused: the old way
  }
  try {
    const area = doc.createElement('textarea')
    area.value = data.url
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    doc.body.append(area)
    area.select()
    const ok = doc.execCommand('copy')
    area.remove()
    if (ok) return {result: 'copied', url: data.url}
  } catch {
    // nothing left to try
  }
  return {result: 'failed', url: data.url}
}
