// Phase 1: ?simulate=1&replay=1 on a laptop. Load a replay log downloaded from the phone (or make a
// synthetic Library -> A3 walk), run it through the real trip logic once (replay.js), then scrub
// it frame by frame on the map: where the trip put the user (blue), where they truly were (black,
// synthetic walks only), the way the arrow pointed, and the metrics for the whole trip.
// Particles (Phase 3) draw here too, when the samples have them.
import {fromLocal, toLocal} from '../geo/geo.js'
import {isTripRecord} from '../replay/trip-recorder.js'

const SRC = 'replay-viewer'
const ARROW_M = 6

const point = (p, props = {}) => ({type: 'Feature', properties: props, geometry: {type: 'Point', coordinates: [p.lng, p.lat]}})
const line = (pts, props = {}) => ({type: 'Feature', properties: props, geometry: {type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat])}})

/** The arrow on the map: from p, ARROW_M metres along bearingDeg. */
function arrowFrom(p, bearingDeg) {
  const r = (bearingDeg * Math.PI) / 180
  return line([p, fromLocal(p, {x: Math.sin(r) * ARROW_M, y: Math.cos(r) * ARROW_M})], {kind: 'arrow'})
}

export function createReplayViewer(map, {host = document.body} = {}) {
  let result = null
  let index = 0
  let playing = false
  let timer = null
  const root = document.createElement('section')
  root.className = 'replay-viewer'
  root.setAttribute('aria-label', 'Replay a trip')
  root.innerHTML = `
    <h2>Replay a trip</h2>
    <label class="rv-file">Replay log (.json) <input type="file" accept="application/json,.json" data-rv-file></label>
    <div class="rv-row">
      <button type="button" data-rv-synth>Synthetic Library → A3</button>
      <label>seed <input type="number" value="1" min="1" max="999" data-rv-seed></label>
      <label><input type="checkbox" data-rv-away> facing away</label>
      <label><input type="checkbox" data-rv-gps> GPS start</label>
    </div>
    <div class="rv-row">
      <button type="button" data-rv-play disabled>Play</button>
      <input type="range" min="0" max="0" value="0" data-rv-scrub disabled aria-label="Frame">
      <span data-rv-time>–</span>
    </div>
    <p data-rv-status role="status">Load a log, or make a synthetic walk.</p>
    <pre data-rv-frame></pre>
    <details><summary>Metrics</summary><pre data-rv-metrics></pre></details>
    <style>
      .replay-viewer{position:absolute;right:12px;top:72px;z-index:20;width:min(360px,calc(100% - 24px));max-height:calc(100% - 96px);overflow:auto;background:#fff;color:#111;border-radius:12px;padding:12px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif}
      .replay-viewer h2{margin:0 0 8px;font-size:15px}
      .replay-viewer .rv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
      .replay-viewer input[type=range]{flex:1}
      .replay-viewer input[type=number]{width:56px}
      .replay-viewer pre{white-space:pre-wrap;margin:6px 0;font-size:12px}
      .replay-viewer button{min-height:32px}
    </style>`
  host.append(root)
  const q = (s) => root.querySelector(s)
  const status = q('[data-rv-status]')

  function ensureLayers() {
    if (map.getSource(SRC)) return
    map.addSource(SRC, {type: 'geojson', data: {type: 'FeatureCollection', features: []}})
    map.addLayer({id: `${SRC}-route`, type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'route'], paint: {'line-color': '#00843d', 'line-width': 4, 'line-opacity': 0.6}})
    map.addLayer({id: `${SRC}-trail`, type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'trail'], paint: {'line-color': '#2563eb', 'line-width': 2}})
    map.addLayer({id: `${SRC}-arrow`, type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'arrow'], paint: {'line-color': '#f59e0b', 'line-width': 4}})
    map.addLayer({id: `${SRC}-particles`, type: 'circle', source: SRC, filter: ['==', ['get', 'kind'], 'particle'], paint: {'circle-radius': 2, 'circle-color': '#7c3aed', 'circle-opacity': 0.5}})
    map.addLayer({id: `${SRC}-truth`, type: 'circle', source: SRC, filter: ['==', ['get', 'kind'], 'truth'], paint: {'circle-radius': 6, 'circle-color': '#111827'}})
    map.addLayer({id: `${SRC}-user`, type: 'circle', source: SRC, filter: ['==', ['get', 'kind'], 'user'], paint: {'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2}})
  }

  function draw() {
    if (!result) return
    const x = result.samples[index]
    if (!x) return
    ensureLayers()
    const route = [...result.meta.route.points, ...(result.meta.route.indoorPoints ?? []).slice(1)]
    const features = [line(route, {kind: 'route'})]
    const trail = result.samples.slice(0, index + 1).filter((s, i) => i % 10 === 0 && s.user).map((s) => s.user)
    if (trail.length >= 2) features.push(line(trail, {kind: 'trail'}))
    if (x.truth) features.push(point({lat: x.truth.lat, lng: x.truth.lng}, {kind: 'truth'}))
    if (x.user) features.push(point(x.user, {kind: 'user'}))
    for (const p of x.particles ?? []) features.push(point(p, {kind: 'particle'}))
    // The arrow as the user would see it: their real heading (truth) or the trip's, plus the guide.
    const facing = x.truth?.headingDeg ?? x.trackedHeadingDeg
    if (x.arrowsShown && Number.isFinite(x.guideDeg) && Number.isFinite(facing) && x.user) features.push(arrowFrom(x.truth ?? x.user, facing + x.guideDeg))
    map.getSource(SRC).setData({type: 'FeatureCollection', features})
    q('[data-rv-time]').textContent = `${(x.t / 1000).toFixed(1)} s`
    const off = x.truth && x.user ? toLocal(x.user, x.truth) : null
    q('[data-rv-frame]').textContent = [
      `phase ${x.phase} · arrows ${x.arrowsShown ? 'shown' : 'hidden'}${x.positionUncertain ? ' (unsure)' : ''}`,
      `position from ${x.positionSource ?? '–'} · heading from ${x.headingSource ?? '–'}`,
      `progress ${x.userS?.toFixed(1) ?? '–'} m${x.truth ? ` (truly ${x.truth.s.toFixed(1)} m)` : ''} · floor ${x.floorLevel ?? '–'}${x.truth ? ` (truly ${x.truth.level})` : ''}`,
      off ? `position error ${Math.hypot(off.x, off.y).toFixed(1)} m` : '',
    ].filter(Boolean).join('\n')
  }

  function setIndex(i) {
    index = Math.max(0, Math.min((result?.samples.length ?? 1) - 1, i))
    q('[data-rv-scrub]').value = String(index)
    draw()
  }

  function stop() {
    playing = false
    clearInterval(timer)
    q('[data-rv-play]').textContent = 'Play'
  }

  async function run(record) {
    stop()
    if (!isTripRecord(record)) {
      status.textContent = 'That file is not a replay log (welcome-ar-trip-record/1).'
      return
    }
    status.textContent = `Replaying ${record.events.length} events through the trip logic…`
    const [THREE, {createArTrip}, {replayTrip}, {tripMetrics, formatMetrics}] = await Promise.all([
      import('three'),
      import('../ar/trip.js'),
      import('../replay/replay.js'),
      import('../replay/metrics.js'),
    ])
    try {
      result = await replayTrip(record, {THREE, createArTrip})
    } catch (err) {
      status.textContent = `Replay failed: ${err?.message ?? err}`
      return
    }
    const m = tripMetrics(result)
    q('[data-rv-metrics]').textContent = formatMetrics(m).join('\n')
    root.querySelector('details').open = true
    status.textContent = `${result.samples.length} frames${m.truth ? ' (with ground truth)' : ' (phone log: self-reported only)'}.`
    const scrub = q('[data-rv-scrub]')
    scrub.max = String(result.samples.length - 1)
    scrub.disabled = false
    q('[data-rv-play]').disabled = false
    const first = result.samples.find((s) => s.user) ?? result.samples[0]
    if (first?.user) map.easeTo({center: [first.user.lng, first.user.lat], zoom: 18})
    setIndex(0)
  }

  q('[data-rv-file]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await run(JSON.parse(await file.text()))
    } catch (err) {
      status.textContent = `Could not read the file: ${err?.message ?? err}`
    }
  })
  q('[data-rv-synth]').addEventListener('click', async () => {
    status.textContent = 'Making a synthetic walk…'
    try {
      const [{synthWalk}, fixture] = await Promise.all([import('../replay/synth-walk.js'), fetch('/data/replay/route-library-a3.json').then((r) => r.json())])
      const record = synthWalk({
        route: fixture.route,
        destination: fixture.destination,
        startPoint: q('[data-rv-gps]').checked ? null : fixture.startPoint,
        seed: Number(q('[data-rv-seed]').value) || 1,
        facing: q('[data-rv-away]').checked ? 'away' : 'path',
      })
      await run(record)
    } catch (err) {
      status.textContent = `Could not make the walk: ${err?.message ?? err}`
    }
  })
  q('[data-rv-scrub]').addEventListener('input', (event) => {
    stop()
    setIndex(Number(event.target.value))
  })
  q('[data-rv-play]').addEventListener('click', () => {
    if (playing) return stop()
    playing = true
    q('[data-rv-play]').textContent = 'Pause'
    timer = setInterval(() => {
      if (!result || index >= result.samples.length - 1) return stop()
      setIndex(index + 3) // about real time at 30 fps, drawn at 10 fps
    }, 100)
  })

  return {
    destroy() {
      stop()
      root.remove()
      for (const id of ['user', 'truth', 'particles', 'arrow', 'trail', 'route']) if (map.getLayer?.(`${SRC}-${id}`)) map.removeLayer(`${SRC}-${id}`)
      if (map.getSource?.(SRC)) map.removeSource(SRC)
    },
  }
}
