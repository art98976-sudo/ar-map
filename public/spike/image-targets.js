// Phase 2 spike: 8th Wall image targets alongside SLAM, with the app's own settings
// (world tracking on, scale 'absolute'). It measures what a sign anchor would rely on:
//   - SLAM keeps tracking (NORMAL) with targets configured,
//   - targets are found, and from how far,
//   - the size the engine reports for the sign (metres) against its real printed width,
//   - the sign's position in the SLAM world stays put across re-detections (< 0.5 m wanted),
//   - whether the undocumented physicalWidthInMeters / moveable fields change any of that.
// Query: ?wA=0.18&wB=0.24 (printed widths, m), ?phys=1 (send physicalWidthInMeters), ?moveable=0|1,
//        ?desktop=1 (allow a laptop webcam), ?only=a|b.
const q = new URLSearchParams(location.search)
const TRUE_W = {'spike-a': Number(q.get('wA') || 0.18), 'spike-b': Number(q.get('wB') || 0.24)}
const PHYS = q.get('phys') === '1'
const MOVEABLE = q.has('moveable') ? q.get('moveable') === '1' : null
// ?only=none: SLAM alone, the control run (does the engine track at all here, without targets?)
const NAMES = q.get('only') === 'none' ? [] : q.get('only') ? [`spike-${q.get('only')}`] : ['spike-a', 'spike-b']

const hud = document.getElementById('hud')
const t0 = performance.now()
const log = {
  meta: {ua: navigator.userAgent, started: new Date().toISOString(), trueWidthsM: TRUE_W, phys: PHYS, moveable: MOVEABLE, names: NAMES},
  events: [],
}
const note = (k, d = {}) => log.events.push({t: Math.round(performance.now() - t0), k, ...d})

const r3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–')
const r1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–')
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
/** Bearing (deg, about +Y) of a quaternion's local +Z axis: which way the sign faces in SLAM space. */
function facingDeg(q) {
  const {x, y, z, w} = q
  const fx = 2 * (x * z + w * y)
  const fz = 1 - 2 * (x * x + y * y)
  return ((Math.atan2(fx, fz) * 180) / Math.PI + 360) % 360
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

let state
function resetStats() {
  state = {
    tracking: {status: '–', reason: ''},
    normalFrames: 0,
    frames: 0,
    fps: 0,
    fpsFrames: 0,
    fpsAt: performance.now(),
    cam: null,
    walkedM: 0,
    lastCam: null,
    xrVersion: window.XR8?.version?.() ?? null,
    load: '–',
    targets: Object.fromEntries(NAMES.map((n) => [n, {found: 0, updated: 0, lost: 0, firstAt: null, visible: false, samples: [], last: null, lostAt: null, jumps: [], maxDistM: 0}])),
  }
  note('reset')
}
resetStats()

function onImage(kind, detail) {
  const s = state.targets[detail?.name]
  if (!s) return note(kind, {name: detail?.name})
  const p = detail.position
  const sample = {
    t: Math.round(performance.now() - t0),
    p: {x: p.x, y: p.y, z: p.z},
    yaw: facingDeg(detail.rotation),
    scale: detail.scale,
    sw: detail.scaledWidth ?? detail.geometry?.scaledWidth ?? null,
    sh: detail.scaledHeight ?? detail.geometry?.scaledHeight ?? null,
    camDistM: state.cam ? dist(state.cam, p) : null,
  }
  if (kind === 'found') {
    s.found += 1
    s.firstAt ??= sample.t
    // A re-detection: how far the sign "moved" in the SLAM world since it was last seen.
    if (s.lostAt) s.jumps.push({afterLostS: (sample.t - s.lostAt.t) / 1000, jumpM: dist(s.lostAt.p, sample.p), walkedM: state.walkedM - s.lostAt.walkedM})
    s.visible = true
  } else s.updated += 1
  s.last = sample
  if (Number.isFinite(sample.camDistM)) s.maxDistM = Math.max(s.maxDistM, sample.camDistM)
  // Keep one sample per 0.25 s per target for the spread.
  if (!s.samples.length || sample.t - s.samples.at(-1).t > 250) s.samples.push(sample)
  if (kind === 'found' || s.updated % 15 === 0) note(kind, {name: detail.name, ...sample, raw: kind === 'found' ? detail : undefined})
}

function onLost(detail) {
  const s = state.targets[detail?.name]
  if (!s) return
  s.lost += 1
  s.visible = false
  if (s.last) s.lostAt = {t: s.last.t, p: s.last.p, walkedM: state.walkedM}
  note('lost', {name: detail.name})
}

/** The spread of the sign's position over every sample: max distance from their mean (metres). */
function spread(samples) {
  if (samples.length < 2) return null
  const m = samples.reduce((a, s) => ({x: a.x + s.p.x / samples.length, y: a.y + s.p.y / samples.length, z: a.z + s.p.z / samples.length}), {x: 0, y: 0, z: 0})
  const yaws = samples.map((s) => s.yaw)
  return {maxM: Math.max(...samples.map((s) => dist(s.p, m))), yawRangeDeg: Math.max(...yaws.map((y) => angDiff(y, yaws[0])))}
}

function paint() {
  const tr = state.tracking
  const normalShare = state.frames ? state.normalFrames / state.frames : 0
  const lines = [
    `engine ${state.xrVersion ?? '?'} · ${state.fps} fps · targets: ${state.load}`,
    `SLAM ${tr.status}${tr.reason ? ` (${tr.reason})` : ''} · NORMAL ${(normalShare * 100).toFixed(0)}% of frames · walked ${r1(state.walkedM)} m`,
    `camera ${state.cam ? `${r3(state.cam.x)}, ${r3(state.cam.y)}, ${r3(state.cam.z)}` : '–'}`,
    `settings: scale absolute · physicalWidthInMeters ${PHYS ? 'SENT' : 'not sent'} · moveable ${MOVEABLE ?? 'default'}`,
    '',
  ]
  for (const [name, s] of Object.entries(state.targets)) {
    const L = s.last
    const sp = spread(s.samples)
    // The reported size: planar scale is the target's height in metres; scaledWidth/Height are its aspect.
    const w = L && Number.isFinite(L.scale) ? L.scale * (L.sw ?? 1) : null
    const h = L && Number.isFinite(L.scale) ? L.scale * (L.sh ?? 1) : null
    const sizeErr = Number.isFinite(w) ? Math.max(w, h ?? 0) - TRUE_W[name] : null
    lines.push(
      `${name}  ${s.visible ? '● TRACKING' : '○ not seen'}  found ${s.found} · lost ${s.lost} · updates ${s.updated}`,
      `  position ${L ? `${r3(L.p.x)}, ${r3(L.p.y)}, ${r3(L.p.z)}` : '–'} · faces ${L ? r1(L.yaw) : '–'}° · from ${L ? r1(L.camDistM) : '–'} m (max ${r1(s.maxDistM)} m)`,
      `  size ${r3(w)} × ${r3(h)} m · printed width ${TRUE_W[name]} m · long side off by ${r3(sizeErr)} m`,
      `  spread over ${s.samples.length} samples: ${sp ? `${r3(sp.maxM)} m, ${r1(sp.yawRangeDeg)}°` : '–'}  ${sp ? `[${sp.maxM < 0.5 ? 'under' : 'OVER'} 0.5 m]` : ''}`,
      `  re-detections: ${s.jumps.length ? s.jumps.map((j) => `${r3(j.jumpM)} m after ${r1(j.walkedM)} m walked`).join(' · ') : '–'}`,
      '',
    )
  }
  hud.textContent = lines.join('\n')
}

async function targetData() {
  const list = []
  for (const name of NAMES) {
    const json = await (await fetch(`./image-targets/${name}.json`)).json()
    if (PHYS) json.physicalWidthInMeters = TRUE_W[name]
    if (MOVEABLE != null) json.moveable = MOVEABLE
    list.push(json)
  }
  return list
}

async function start() {
  document.getElementById('start').remove()
  const XR8 = await new Promise((resolve) => (window.XR8 ? resolve(window.XR8) : window.addEventListener('xrloaded', () => resolve(window.XR8), {once: true})))
  state.xrVersion = XR8.version?.() ?? null
  await XR8.loadChunk('slam') // as the app does (src/ar/engine.js): world tracking lives in this chunk
  note('slam-loaded')
  const imageTargetData = await targetData()
  note('config', {imageTargetData: imageTargetData.map((d) => ({name: d.name, physicalWidthInMeters: d.physicalWidthInMeters, moveable: d.moveable}))})
  XR8.XrController.configure({disableWorldTracking: false, scale: 'absolute', ...(imageTargetData.length ? {imageTargetData} : {})})
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.XrController.pipelineModule(),
    {
      name: 'spike',
      onUpdate: ({processCpuResult}) => {
        const r = processCpuResult?.reality
        state.frames += 1
        state.fpsFrames += 1
        const status = r?.trackingStatus ?? state.tracking.status
        if (status === 'NORMAL') state.normalFrames += 1
        if (r?.position) {
          const c = {x: r.position.x, y: r.position.y, z: r.position.z}
          if (state.lastCam) {
            const step = Math.hypot(c.x - state.lastCam.x, c.z - state.lastCam.z)
            if (step < 1) state.walkedM += step // a bigger jump is SLAM relocalising, not walking
          }
          state.lastCam = c
          state.cam = c
        }
        const now = performance.now()
        if (now - state.fpsAt >= 1000) {
          state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsAt))
          state.fpsFrames = 0
          state.fpsAt = now
          note('tick', {fps: state.fps, status, cam: state.cam})
          paint()
        }
      },
      onException: (err) => {
        note('exception', {message: String(err?.message || err)})
        hud.textContent = `ENGINE ERROR: ${err?.message || err}\n\n` + hud.textContent
      },
      listeners: [
        {event: 'reality.trackingstatus', process: ({detail}) => ((state.tracking = detail || {}), note('tracking', detail || {}))},
        {event: 'reality.imageloading', process: ({detail}) => ((state.load = 'loading'), note('imageloading', {detail}))},
        {event: 'reality.imagescanning', process: ({detail}) => ((state.load = `scanning (${detail?.imageTargets?.length ?? '?'})`), note('imagescanning', {n: detail?.imageTargets?.length}))},
        {event: 'reality.imagefound', process: ({detail}) => onImage('found', detail)},
        {event: 'reality.imageupdated', process: ({detail}) => onImage('updated', detail)},
        {event: 'reality.imagelost', process: ({detail}) => onLost(detail)},
      ],
    },
  ])
  const canvas = document.getElementById('xr')
  canvas.width = innerWidth * devicePixelRatio
  canvas.height = innerHeight * devicePixelRatio
  XR8.run({
    canvas,
    allowedDevices: q.get('desktop') === '1' ? XR8.XrConfig.device().ANY : XR8.XrConfig.device().MOBILE_AND_HEADSETS,
    cameraConfig: {direction: XR8.XrConfig.camera().BACK},
  })
  note('run')
}

document.getElementById('go').addEventListener('click', () => start().catch((err) => (hud.textContent = `START FAILED: ${err?.message || err}`)))
document.getElementById('reset').addEventListener('click', resetStats)
document.getElementById('mark').addEventListener('click', () => {
  note('mark', {cam: state.cam})
  hud.textContent = 'MARK noted\n' + hud.textContent
})
document.getElementById('download').addEventListener('click', () => {
  log.summary = Object.fromEntries(Object.entries(state.targets).map(([n, s]) => [n, {found: s.found, lost: s.lost, updates: s.updated, spread: spread(s.samples), jumps: s.jumps, maxDistM: s.maxDistM, last: s.last}]))
  log.summary.normalShare = state.frames ? state.normalFrames / state.frames : null
  const url = URL.createObjectURL(new Blob([JSON.stringify(log)], {type: 'application/json'}))
  const a = Object.assign(document.createElement('a'), {href: url, download: `image-target-spike-${Date.now()}.json`})
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
})
