// Destination search box with autocomplete (WAI-ARIA combobox + listbox pattern).
// Empty box: recent searches and popular places. Typing: our places first, then rooms
// from the University MazeMap. Arrow keys, Enter and Escape work on a keyboard.
import {DESTINATIONS, POPULAR, TOWN_PLACES, addRecent, clearRecent, getRecent} from '../../map/destinations.js'
import {describeDestination, searchDestinations} from '../../map/search.js'
import {searchMazeMap} from '../../map/mazemap-search.js'
import {matchTier, rankResults} from '../../map/search-rank.js'
import {html, render} from '../dom.js'
import {CATEGORY_ICON, icon, iconFor} from '../icons.js'

const ROOM_SEARCH_DELAY_MS = 220
const POPULAR_IDS = POPULAR.map((d) => d.id)
let instances = 0

/**
 * @param {HTMLElement} host
 * @param {{onSelect: (dest) => void, placeholder?: string, label?: string}} options
 * @param options.places the list to search. searchRooms: also ask the campus map for rooms.
 * @param options.recent {get, add, clear} for the "Recent" list.
 */
export function createDestinationSearch(host, {
  onSelect,
  placeholder,
  label = 'Search destinations',
  places = DESTINATIONS,
  searchRooms = true,
  recent: recentStore = {get: getRecent, add: addRecent, clear: clearRecent},
}) {
  const uid = `ds${++instances}`
  let query = ''
  let local = []
  let rooms = {state: 'idle', items: []} // idle | loading | done | error
  // Our places found only through a typo ("libary"): ranked after real matches.
  const fuzzyIds = () => new Set(local.filter((d) => matchTier(d, query) == null).map((d) => d.id))
  let options = [] // flat list of selectable results, in display order
  let active = -1
  let timer = null
  let controller = null

  render(
    host,
    html`
      <div class="dsearch">
        <div class="dsearch__field">
          ${icon('search', {className: 'dsearch__icon'})}
          <input
            class="dsearch__input"
            type="search"
            role="combobox"
            aria-label="${label}"
            aria-autocomplete="list"
            aria-expanded="false"
            aria-controls="${uid}-list"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="go"
            placeholder="${placeholder || 'Building, room or service'}"
            data-input
          />
          <button class="dsearch__clear" type="button" aria-label="Clear search" data-clear hidden>
            ${icon('close', {size: 18})}
          </button>
        </div>
        <div class="dsearch__panel" data-panel></div>
      </div>
    `,
  )

  const input = host.querySelector('[data-input]')
  const clearBtn = host.querySelector('[data-clear]')
  const panel = host.querySelector('[data-panel]')

  // ---------- rendering ----------
  function row(dest, index) {
    const meta = describeDestination(dest)
    return html`
      <li
        class="dsearch__option"
        role="option"
        id="${uid}-opt-${index}"
        data-index="${index}"
        aria-selected="${index === active ? 'true' : 'false'}"
      >
        <span class="dsearch__badge" data-category="${dest.category}" data-icon="${iconFor(dest)}">${icon(iconFor(dest), {size: 20})}</span>
        <span class="dsearch__text">
          <span class="dsearch__name">${highlight(dest.name, query)}</span>
          ${meta ? html`<span class="dsearch__meta">${meta}</span>` : ''}
        </span>
        ${dest.walkMinutes ? html`<span class="dsearch__time">${icon('clock', {size: 14})}${dest.walkMinutes} min</span>` : ''}
        ${icon('chevronRight', {size: 18, className: 'dsearch__chev'})}
      </li>
    `
  }

  function draw() {
    const hasQuery = query.trim().length > 0
    clearBtn.hidden = !hasQuery
    if (!hasQuery) {
      options = recentStore.get()
      const recent = options
      render(
        panel,
        html`
          ${recent.length
            ? html`
                <section class="dsearch__section" aria-labelledby="${uid}-recent">
                  <div class="dsearch__head">
                    <h2 id="${uid}-recent" class="dsearch__title">${icon('history', {size: 16})}Recent</h2>
                    <button type="button" class="dsearch__link" data-clear-recent aria-label="Clear recent searches">Clear</button>
                  </div>
                  <ul class="dsearch__list" role="listbox" id="${uid}-list" aria-label="Recent searches">
                    ${recent.map((d, i) => row(d, i))}
                  </ul>
                </section>
              `
            : ''}
          <section class="dsearch__section" aria-labelledby="${uid}-popular">
            <h2 id="${uid}-popular" class="dsearch__title">${icon('star', {size: 16})}Popular places</h2>
            <div class="chips">
              ${POPULAR.map(
                (d) => html`
                  <button type="button" class="chip-btn" data-popular="${d.id}" aria-label="${d.name}">
                    ${icon(CATEGORY_ICON[d.category] || 'pin', {size: 16})}<span>${d.name}</span>
                  </button>
                `,
              )}
            </div>
          </section>
          <section class="dsearch__section" aria-labelledby="${uid}-town">
            <h2 id="${uid}-town" class="dsearch__title">${icon('pin', {size: 16})}In Stirling</h2>
            <div class="chips">
              ${TOWN_PLACES.map(
                (d) => html`
                  <button type="button" class="chip-btn" data-popular="${d.id}" aria-label="${d.name}">
                    ${icon('pin', {size: 16})}<span>${d.name}</span>
                  </button>
                `,
              )}
            </div>
          </section>
        `,
      )
    } else {
      // One list, ranked together (search-rank.js): our places and MazeMap rooms.
      const results = rankResults(query, [...local, ...rooms.items], {fuzzyIds: fuzzyIds()})
      options = results
      const empty = !results.length && rooms.state !== 'loading' && rooms.state !== 'offline'
      render(
        panel,
        html`
          <ul class="dsearch__list" role="listbox" id="${uid}-list" aria-label="Search results">
            ${results.map((d, i) => row(d, i))}
          </ul>
          ${rooms.state === 'loading'
            ? html`<p class="dsearch__status"><span class="spinner spinner--dark spinner--sm" aria-hidden="true"></span>Searching rooms…</p>`
            : ''}
          ${rooms.state === 'offline'
            ? html`<p class="dsearch__status" data-offline role="status">Offline. Room search is off until you reconnect.</p>`
            : ''}
          ${rooms.state === 'error' && !local.length
            ? html`<p class="dsearch__status">Room search needs an internet connection.</p>`
            : ''}
          ${empty
            ? html`
                <div class="dsearch__empty" role="status">
                  ${icon('search', {size: 28})}
                  <strong>No room found. Try the room number, like 2B87.</strong>
                  <span>Or a building name, like “Library”.</span>
                </div>
              `
            : ''}
        `,
      )
    }
    if (active >= options.length) active = options.length - 1
    input.setAttribute('aria-expanded', String(options.length > 0))
    if (active >= 0) input.setAttribute('aria-activedescendant', `${uid}-opt-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }

  // ---------- behaviour ----------
  function runSearch() {
    local = searchDestinations(places, query, {popular: POPULAR_IDS, limit: searchRooms ? 6 : 12})
    active = -1
    clearTimeout(timer)
    controller?.abort()
    const q = query.trim()
    if (q.length < 2 || !searchRooms || navigator.onLine === false) {
      // Offline (8.1): room search is off; the places kept on the phone still show.
      rooms = {state: q.length >= 2 && searchRooms ? 'offline' : 'idle', items: []}
      draw()
      return
    }
    rooms = {state: 'loading', items: []}
    draw()
    timer = setTimeout(async () => {
      controller = new AbortController()
      try {
        const found = await searchMazeMap(q, {signal: controller.signal, rows: 14})
        if (q !== query.trim()) return
        // Ranking (and removing repeats of our own places) happens when the list is drawn.
        rooms = {state: 'done', items: found}
      } catch {
        if (q !== query.trim()) return // an older request was cancelled by typing
        rooms = {state: 'error', items: []}
      }
      draw()
    }, ROOM_SEARCH_DELAY_MS)
  }

  function choose(dest) {
    if (!dest) return
    recentStore.add(dest)
    input.blur()
    onSelect(dest)
  }

  function setActive(next) {
    if (!options.length) return
    active = (next + options.length) % options.length
    draw()
    host.querySelector(`#${uid}-opt-${active}`)?.scrollIntoView({block: 'nearest'})
  }

  function clear() {
    input.value = ''
    query = ''
    runSearch()
  }

  const onInput = () => {
    query = input.value
    runSearch()
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(active - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(options[active >= 0 ? active : 0])
    } else if (e.key === 'Escape') {
      if (query) clear()
    }
  }
  const onClick = (e) => {
    const option = e.target.closest('[data-index]')
    if (option) return choose(options[Number(option.dataset.index)])
    const chip = e.target.closest('[data-popular]')
    if (chip) return choose(DESTINATIONS.find((d) => d.id === chip.dataset.popular))
    if (e.target.closest('[data-clear-recent]')) {
      recentStore.clear()
      draw()
      input.focus()
    } else if (e.target.closest('[data-clear]')) {
      clear()
      input.focus()
    }
  }

  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKeyDown)
  host.addEventListener('click', onClick)
  draw()

  return {
    focus: () => input.focus({preventScroll: true}),
    destroy: () => {
      clearTimeout(timer)
      controller?.abort()
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeyDown)
      host.removeEventListener('click', onClick)
    },
  }
}

/** Bold the part of the name that matches what was typed. */
function highlight(name, query) {
  const q = query.trim()
  if (!q) return name
  const i = name.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return name
  return html`${name.slice(0, i)}<mark>${name.slice(i, i + q.length)}</mark>${name.slice(i + q.length)}`
}
