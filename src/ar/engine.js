// Loads and runs the 8th Wall engine (camera feed + world tracking) with Three.js.
//
// Loading is lazy: the 6 MB engine downloads only after the user taps "Start AR",
// with real download progress. The files come from our own domain (self-hosted).
import * as THREE from 'three'
import {XR} from '../config.js'

let loadPromise = null

export class EngineError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'EngineError'
    this.code = code
  }
}

/** Download a file and report progress. The browser cache then serves the <script> tag. */
async function prefetch(url, onBytes) {
  const res = await fetch(url, {cache: 'force-cache'})
  if (!res.ok) throw new EngineError('load-failed', `Could not download the AR engine (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) {
    await res.arrayBuffer()
    onBytes(1, 1)
    return
  }
  const reader = res.body.getReader()
  let loaded = 0
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    loaded += value.length
    onBytes(Math.min(loaded, total), total)
  }
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    tag.async = true
    tag.crossOrigin = 'anonymous'
    tag.onload = resolve
    tag.onerror = () => reject(new EngineError('load-failed', 'The AR engine could not start.'))
    document.head.appendChild(tag)
  })
}

/**
 * Load XR8 once. `onProgress(0..1)` drives the loading bar.
 * Weighted by size: the core file is ~16% of the bytes, the tracking chunk ~84%.
 */
export function loadEngine(onProgress = () => {}) {
  if (window.XR8) return Promise.resolve(window.XR8)
  if (loadPromise) return loadPromise

  // The engine's Three.js module reads Three.js from window.THREE.
  window.THREE = THREE

  const weights = {core: 0.16, slam: 0.84}
  const parts = {core: 0, slam: 0}
  const report = () => onProgress(Math.min(0.99, parts.core * weights.core + parts.slam * weights.slam))

  const work = (async () => {
    await Promise.all([
      prefetch(XR.scriptUrl, (l, t) => {
        parts.core = l / t
        report()
      }),
      prefetch(XR.slamChunkUrl, (l, t) => {
        parts.slam = l / t
        report()
      }),
    ])
    const ready = new Promise((resolve) => {
      if (window.XR8) resolve(window.XR8)
      else window.addEventListener('xrloaded', () => resolve(window.XR8), {once: true})
    })
    await injectScript(XR.scriptUrl)
    const XR8 = await ready
    await XR8.loadChunk('slam')
    onProgress(1)
    return XR8
  })()

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new EngineError('timeout', 'The AR engine is taking too long to download. Check your connection.')),
      XR.loadTimeoutMs,
    )
  })

  loadPromise = Promise.race([work, timeout])
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      loadPromise = null // allow "Try again"
      throw err instanceof EngineError
        ? err
        : new EngineError(navigator.onLine === false ? 'offline' : 'load-failed', 'The AR engine could not load.')
    })
  return loadPromise
}

/** Keep the canvas the size of the screen, at a capped pixel ratio for a steady frame rate. */
function fitCanvas(canvas) {
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, XR.maxPixelRatio)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)
  return () => {
    window.removeEventListener('resize', resize)
    window.removeEventListener('orientationchange', resize)
  }
}

/**
 * Start camera + world tracking on `canvas`.
 * Handlers:
 *   onCamera(status, reason)  'requesting' | 'ready' | 'denied' | 'failed'
 *   onTracking({status, reason})  status 'NORMAL' | 'LIMITED'
 *   onFrame(fps)  about once a second
 *   onError(EngineError)
 *   onSceneReady({scene, camera, renderer, XR8})  add 3D content here (Phase 1+)
 * Returns stop().
 */
export function startSession(XR8, canvas, handlers = {}, {allowDesktop = false} = {}) {
  const {onCamera = noop, onTracking = noop, onFrame = noop, onError = noop, onSceneReady = noop, onTick = noop} = handlers
  let lastTime = null
  const unfit = fitCanvas(canvas)

  let frames = 0
  let lastTick = performance.now()

  const statusModule = {
    name: 'welcome-ar-status',
    onStart: () => {
      const {scene, camera, renderer} = XR8.Threejs.xrScene()
      onSceneReady({scene, camera, renderer, XR8})
    },
    onCameraStatusChange: ({status, reason}) => {
      if (status === 'requesting') onCamera('requesting')
      else if (status === 'hasVideo') onCamera('ready')
      else if (status === 'failed') {
        // Engine reasons: DENY_CAMERA (user said no), NO_CAMERA (no rear camera), UNSPECIFIED.
        const code = String(reason?.name || reason || '')
        if (/DENY|NotAllowed|Permission/i.test(code)) onCamera('denied', code)
        else if (/NO_CAMERA|NotFound/i.test(code)) onCamera('missing', code)
        else onCamera('failed', code)
      }
    },
    onException: (err) => {
      console.error('[xr] runtime error', err)
      onError(new EngineError('runtime', 'AR stopped unexpectedly.'))
    },
    onUpdate: () => {
      frames += 1
      const now = performance.now()
      // Per-frame hook for 3D content. dt is capped so a paused tab never causes a jump.
      const dt = lastTime == null ? 0 : Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now
      try {
        onTick({dt, time: now / 1000})
      } catch (err) {
        console.error('[xr] tick failed', err)
      }
      if (now - lastTick >= 1000) {
        onFrame(Math.round((frames * 1000) / (now - lastTick)))
        frames = 0
        lastTick = now
      }
    },
    listeners: [{event: 'reality.trackingstatus', process: ({detail}) => onTracking(detail || {})}],
  }

  // 'absolute' scale: positions are in real metres and the ground is at y = 0, so a route
  // measured in metres from GPS can be drawn at true size (8th Wall XrController docs).
  XR8.XrController.configure({disableWorldTracking: false, scale: 'absolute'})
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
    XR8.Threejs.pipelineModule(), // Three.js scene driven by the tracked camera
    XR8.XrController.pipelineModule(), // world tracking (SLAM)
    statusModule,
  ])

  // Pause when the tab is hidden (app switch, phone call) to save battery; resume after.
  const onVisibility = () => {
    if (document.hidden) XR8.pause()
    else XR8.resume()
  }
  document.addEventListener('visibilitychange', onVisibility)

  try {
    XR8.run({
      canvas,
      allowedDevices: allowDesktop ? XR8.XrConfig.device().ANY : XR8.XrConfig.device().MOBILE_AND_HEADSETS,
      cameraConfig: {direction: XR8.XrConfig.camera().BACK},
    })
  } catch (err) {
    console.error('[xr] run failed', err)
    onError(new EngineError('runtime', 'AR could not start on this device.'))
  }

  return function stop() {
    document.removeEventListener('visibilitychange', onVisibility)
    unfit()
    try {
      XR8.stop()
      XR8.clearCameraPipelineModules()
    } catch (err) {
      console.warn('[xr] stop failed', err)
    }
  }
}

function noop() {}
