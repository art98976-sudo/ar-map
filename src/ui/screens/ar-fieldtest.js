// ?fieldtest=1 on the AR screen: a log for walking a route on campus.
// - live readout: GPS accuracy, compass heading, distance from and along the route, arrow bearing
// - one sample a second, in memory (and in sessionStorage, so a reload mid-walk keeps it)
// - three big buttons that add a marked row: "Arrow correct", "Arrow wrong", "At a turn"
// - Finish: a summary, and the whole log as CSV for the clipboard
//
// Loaded only when the address asks for it. Its panel keeps to the screen's side edges, clear of
// the arrows (bottom), the step card and trip pill (top) and the mini-map (bottom left).

export const FIELD_MARKS = Object.freeze({correct: 'Arrow correct', wrong: 'Arrow wrong', turn: 'At a turn'})
export const FIELD_COLUMNS = [
  'time',
  'elapsed_s',
  'lat',
  'lon',
  'tracked_lat',
  'tracked_lon',
  'gps_accuracy_m',
  'heading_deg',
  'off_route_m',
  'along_m',
  'arrow_bearing_deg',
  'phase',
  'mark',
]
const STORE_KEY = 'welcomeAR.fieldtest.v1'
const num = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null)

/** One log row from the trip's stats. mark: null for a timed sample, else a FIELD_MARKS key. */
export function rowFrom(stats, {at, startedAt, mark = null}) {
  const s = stats ?? {}
  return {
    time: new Date(at).toISOString(),
    elapsed_s: num((at - startedAt) / 1000, 1),
    lat: num(s.gpsLat, 7),
    lon: num(s.gpsLng, 7),
    tracked_lat: num(s.trackedLat, 7),
    tracked_lon: num(s.trackedLng, 7),
    gps_accuracy_m: num(s.gpsAccuracy, 1),
    heading_deg: num(s.heading, 1),
    off_route_m: num(s.distanceFromRouteM ?? s.offRouteM, 2),
    along_m: num(s.userS, 1),
    arrow_bearing_deg: num(s.arrowBearingDeg, 1),
    phase: s.phase ?? null,
    mark: mark ? FIELD_MARKS[mark] : null,
  }
}

/** Averages and worst values over the timed samples, and how often each button was tapped. */
export function summarise(rows) {
  const samples = rows.filter((r) => !r.mark)
  const stat = (key) => {
    const values = samples.map((r) => r[key]).filter(Number.isFinite)
    if (!values.length) return {average: null, worst: null, count: 0}
    return {average: values.reduce((a, b) => a + b, 0) / values.length, worst: Math.max(...values), count: values.length}
  }
  const marks = Object.fromEntries(Object.entries(FIELD_MARKS).map(([key, label]) => [key, rows.filter((r) => r.mark === label).length]))
  const last = rows.at(-1)
  return {gpsAccuracy: stat('gps_accuracy_m'), offRoute: stat('off_route_m'), marks, samples: samples.length, rows: rows.length, durationS: last?.elapsed_s ?? 0}
}

/** The log as CSV: a header row, then one line per row. */
export function toCsv(rows) {
  const cell = (v) => {
    if (v == null) return ''
    const text = String(v)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [FIELD_COLUMNS.join(','), ...rows.map((r) => FIELD_COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

/** The log itself: samples and marks, kept in memory and mirrored to sessionStorage. */
export function createFieldLog({storage = globalThis.sessionStorage, now = () => Date.now()} = {}) {
  const saved = readSaved(storage)
  const rows = Array.isArray(saved?.rows) ? saved.rows : []
  let startedAt = Number.isFinite(saved?.startedAt) ? saved.startedAt : now()
  const restored = rows.length

  function save() {
    try {
      storage?.setItem(STORE_KEY, JSON.stringify({startedAt, rows}))
    } catch {
      // storage full or blocked: the log is still in memory
    }
  }

  return {
    restored,
    get rows() {
      return rows
    },
    add(stats, mark = null) {
      const row = rowFrom(stats, {at: now(), startedAt, mark})
      rows.push(row)
      save()
      return row
    },
    clear() {
      rows.length = 0
      startedAt = now()
      try {
        storage?.removeItem(STORE_KEY)
      } catch {
        // nothing to remove
      }
    },
  }
}

function readSaved(storage) {
  try {
    return JSON.parse(storage?.getItem(STORE_KEY) || 'null')
  } catch {
    return null
  }
}

/** Copy text inside a tap. iPhone Safari and Android Chrome take the Clipboard API on https. */
export async function copyText(text, doc = document) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // refused: try the old way
  }
  const area = doc.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  doc.body.append(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok
  try {
    ok = doc.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return Boolean(ok)
}

const fmt = (v, unit, digits = 1) => (Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '–')

/**
 * The field-test panel on the AR screen.
 * @param o.haptic  vibrate on a tap (dom.js haptic)
 * @returns {mount(host), update(stats), destroy()}
 */
export function createFieldTest({haptic = () => {}, storage, intervalMs = 1000} = {}) {
  const log = createFieldLog({storage})
  let latest = null
  let ui = null
  const timer = setInterval(() => log.add(latest), intervalMs)

  function mount(host) {
    ui?.root.remove()
    const root = document.createElement('div')
    root.className = 'fieldtest'
    root.innerHTML = `
      <section class="fieldtest__readout" aria-label="Field test readings">
        <p class="fieldtest__title"><span class="fieldtest__rec" aria-hidden="true"></span>Field test · <span data-ft-count>0</span></p>
        <dl>
          <dt>GPS</dt><dd data-ft="gps">–</dd>
          <dt>Heading</dt><dd data-ft="heading">–</dd>
          <dt>Off route</dt><dd data-ft="off">–</dd>
          <dt>Along</dt><dd data-ft="along">–</dd>
          <dt>Arrow</dt><dd data-ft="arrow">–</dd>
        </dl>
      </section>
      <div class="fieldtest__marks" role="group" aria-label="Mark this moment">
        <button type="button" class="fieldtest__mark fieldtest__mark--correct" data-ft-mark="correct">${FIELD_MARKS.correct}<span data-ft-n="correct"></span></button>
        <button type="button" class="fieldtest__mark fieldtest__mark--wrong" data-ft-mark="wrong">${FIELD_MARKS.wrong}<span data-ft-n="wrong"></span></button>
        <button type="button" class="fieldtest__mark fieldtest__mark--turn" data-ft-mark="turn">${FIELD_MARKS.turn}<span data-ft-n="turn"></span></button>
        <button type="button" class="fieldtest__finish" data-ft-finish>Finish</button>
      </div>
      <div class="fieldtest__sheet" role="dialog" aria-modal="true" aria-labelledby="ft-summary-title" data-ft-sheet hidden>
        <div class="fieldtest__card">
          <h2 id="ft-summary-title">Field test summary</h2>
          <dl class="fieldtest__summary" data-ft-summary></dl>
          <p class="fieldtest__status" data-ft-status role="status"></p>
          <textarea class="fieldtest__csv" data-ft-csv readonly hidden aria-label="Log as CSV"></textarea>
          <div class="fieldtest__actions">
            <button type="button" class="fieldtest__primary" data-ft-copy>Copy CSV</button>
            <button type="button" data-ft-continue>Continue</button>
            <button type="button" data-ft-clear>Clear log</button>
          </div>
        </div>
      </div>
      <style>${STYLE}</style>`
    host.append(root)
    const q = (s) => root.querySelector(s)
    ui = {root, sheet: q('[data-ft-sheet]'), status: q('[data-ft-status]'), csv: q('[data-ft-csv]'), clearArmed: false}

    for (const button of root.querySelectorAll('[data-ft-mark]')) {
      button.addEventListener('click', () => {
        log.add(latest, button.dataset.ftMark)
        haptic(25)
        button.classList.remove('is-flash')
        void button.offsetWidth // restart the flash
        button.classList.add('is-flash')
        paintCounts()
      })
    }
    q('[data-ft-finish]').addEventListener('click', openSummary)
    q('[data-ft-continue]').addEventListener('click', () => {
      ui.sheet.hidden = true
    })
    const status = ui.status
    const csvBox = ui.csv
    q('[data-ft-copy]').addEventListener('click', async () => {
      const csv = toCsv(log.rows)
      const ok = await copyText(csv)
      if (!root.isConnected) return // the AR screen closed meanwhile
      if (ok) {
        status.textContent = `Copied ${log.rows.length} rows. Paste them into a note, an email or a spreadsheet.`
        csvBox.hidden = true
      } else {
        // Last resort: show it, selected, for a long-press "Copy".
        status.textContent = 'This browser would not copy. Press and hold the text below, then choose Copy.'
        csvBox.value = csv
        csvBox.hidden = false
        csvBox.focus()
        csvBox.setSelectionRange(0, csv.length)
      }
    })
    q('[data-ft-clear]').addEventListener('click', (event) => {
      if (!ui.clearArmed) {
        ui.clearArmed = true
        event.currentTarget.textContent = 'Tap again to clear'
        return
      }
      log.clear()
      ui.clearArmed = false
      event.currentTarget.textContent = 'Clear log'
      paintSummary()
      paintCounts()
      ui.status.textContent = 'Log cleared. A new one has started.'
    })
    if (log.restored) ui.status.textContent = `Carried on from ${log.restored} rows saved before the page reloaded.`
    paintCounts()
    paint()
  }

  function openSummary() {
    paintSummary()
    ui.csv.hidden = true
    ui.sheet.hidden = false
    ui.sheet.querySelector('[data-ft-copy]').focus()
  }

  function paintSummary() {
    const s = summarise(log.rows)
    const minutes = Math.floor(s.durationS / 60)
    const rows = [
      ['GPS accuracy', `average ±${fmt(s.gpsAccuracy.average, ' m')}, worst ±${fmt(s.gpsAccuracy.worst, ' m')}`],
      ['Distance from route', `average ${fmt(s.offRoute.average, ' m')}, worst ${fmt(s.offRoute.worst, ' m')}`],
      [FIELD_MARKS.correct, String(s.marks.correct)],
      [FIELD_MARKS.wrong, String(s.marks.wrong)],
      [FIELD_MARKS.turn, String(s.marks.turn)],
      ['Logged', `${s.samples} samples over ${minutes} min ${Math.round(s.durationS - minutes * 60)} s`],
    ]
    const dl = ui.root.querySelector('[data-ft-summary]')
    dl.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt')
        dt.textContent = k
        const dd = document.createElement('dd')
        dd.textContent = v
        return [dt, dd]
      }),
    )
  }

  function paintCounts() {
    if (!ui) return
    const s = summarise(log.rows)
    ui.root.querySelector('[data-ft-count]').textContent = `${s.samples} s`
    for (const key of Object.keys(FIELD_MARKS)) {
      const n = s.marks[key]
      ui.root.querySelector(`[data-ft-n="${key}"]`).textContent = n ? ` · ${n}` : ''
    }
  }

  function paint() {
    if (!ui) return
    const s = latest ?? {}
    const set = (key, text) => {
      ui.root.querySelector(`[data-ft="${key}"]`).textContent = text
    }
    set('gps', Number.isFinite(s.gpsAccuracy) ? `±${Math.round(s.gpsAccuracy)} m` : 'waiting')
    set('heading', Number.isFinite(s.heading) ? `${Math.round(s.heading)}°` : '–')
    set('off', fmt(s.distanceFromRouteM ?? s.offRouteM, ' m'))
    set('along', fmt(s.userS, ' m', 0))
    set('arrow', Number.isFinite(s.arrowBearingDeg) ? `${Math.round(s.arrowBearingDeg)}°` : '–')
  }

  let lastCountPaint = 0
  return {
    log,
    mount,
    update(stats) {
      latest = stats
      paint()
      const now = Date.now()
      if (now - lastCountPaint > 900) {
        lastCountPaint = now
        paintCounts()
      }
    },
    destroy() {
      clearInterval(timer)
      ui?.root.remove()
      ui = null
    },
  }
}

const STYLE = `
.fieldtest{position:absolute;inset:0;pointer-events:none;z-index:6;font:13px/1.35 system-ui,-apple-system,sans-serif;color:#fff}
.fieldtest button{font:inherit;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.fieldtest__readout{position:absolute;left:calc(env(safe-area-inset-left,0px) + 8px);top:calc(env(safe-area-inset-top,0px) + 136px);
  width:132px;padding:6px 8px;border-radius:10px;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.fieldtest__title{margin:0 0 2px;font-weight:600;font-size:12px;display:flex;align-items:center;gap:5px}
.fieldtest__rec{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:ft-blink 1s steps(2,start) infinite}
@media (prefers-reduced-motion:reduce){.fieldtest__rec{animation:none}}
@keyframes ft-blink{to{visibility:hidden}}
.fieldtest__readout dl{display:grid;grid-template-columns:auto 1fr;gap:0 6px;margin:0}
.fieldtest__readout dt{opacity:.75}
.fieldtest__readout dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.fieldtest__marks{position:absolute;right:calc(env(safe-area-inset-right,0px) + 8px);top:calc(env(safe-area-inset-top,0px) + 136px);
  width:118px;display:flex;flex-direction:column;gap:8px}
.fieldtest__mark{min-height:52px;padding:6px 8px;border:0;border-radius:14px;color:#fff;font-weight:700;font-size:14px;line-height:1.15;
  box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.92}
.fieldtest__mark--correct{background:#15803d}
.fieldtest__mark--wrong{background:#b91c1c}
.fieldtest__mark--turn{background:#b45309}
.fieldtest__mark.is-flash{animation:ft-flash .35s ease-out}
@keyframes ft-flash{from{transform:scale(.92);box-shadow:0 0 0 6px rgba(255,255,255,.7)}}
.fieldtest__finish{min-height:36px;border:1px solid rgba(255,255,255,.6);border-radius:12px;background:rgba(0,0,0,.55);color:#fff;font-weight:600}
.fieldtest__sheet{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45);
  padding:12px calc(env(safe-area-inset-right,0px) + 12px) calc(env(safe-area-inset-bottom,0px) + 12px) calc(env(safe-area-inset-left,0px) + 12px)}
.fieldtest__sheet[hidden]{display:none}
.fieldtest__card{width:100%;max-width:440px;max-height:calc(100dvh - 24px);overflow:auto;background:#fff;color:#111827;border-radius:18px;padding:16px}
.fieldtest__card h2{margin:0 0 8px;font-size:17px}
.fieldtest__summary{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 8px}
.fieldtest__summary dt{color:#4b5563}
.fieldtest__summary dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.fieldtest__status{min-height:1.35em;margin:4px 0 8px;color:#166534}
.fieldtest__csv{width:100%;height:120px;font:11px/1.3 ui-monospace,monospace;margin-bottom:8px;-webkit-user-select:text;user-select:text}
.fieldtest__csv[hidden]{display:none}
.fieldtest__actions{display:flex;flex-wrap:wrap;gap:8px}
.fieldtest__actions button{flex:1 1 30%;min-height:48px;border-radius:12px;border:1px solid #d1d5db;background:#f9fafb;color:#111827;font-weight:600}
.fieldtest__actions .fieldtest__primary{background:#006938;border-color:#006938;color:#fff}
`
