// Item 10: on arrival, the entrance's name and a photo of the door, so a student knows it is the
// right one. The data (src/data/entrance-photos.json) and the photo load only on arrival; the
// service worker keeps photos for offline use (public/sw.js). A missing photo shows the placeholder.
import {html} from '../dom.js'

/** The entrance for a place: {entrance, photo, alt} or null. */
export async function entranceFor(placeId, load = () => import('../../data/entrance-photos.json')) {
  const {default: data} = await load()
  const hit = data.photos?.[placeId]
  return hit ? {...hit, placeholder: data.placeholder} : null
}

/** The figure: the entrance's name and its photo (lazy, decoded off the main thread). */
export const entranceFigure = (e) => html`
  <figure class="entrance-photo" data-entrance-photo>
    <img src="${e.photo}" alt="${e.alt}" width="400" height="300" loading="lazy" decoding="async" data-placeholder="${e.placeholder}" />
    <figcaption>${e.entrance}</figcaption>
  </figure>
`

/** Swap a photo that is not there (yet) for the placeholder, once. */
export function usePlaceholderOnError(root) {
  for (const img of root?.querySelectorAll?.('[data-entrance-photo] img') ?? []) {
    img.addEventListener(
      'error',
      () => {
        if (img.dataset.placeholder && !img.src.endsWith(img.dataset.placeholder)) img.src = img.dataset.placeholder
      },
      {once: true},
    )
  }
}

/** Put the entrance figure into host for this place (if we know its entrance). */
export async function showEntrance(host, placeId) {
  if (!host || !placeId) return null
  const e = await entranceFor(placeId).catch(() => null)
  if (!e || !host.isConnected) return null
  host.innerHTML = entranceFigure(e).value
  usePlaceholderOnError(host)
  host.hidden = false
  return e
}
