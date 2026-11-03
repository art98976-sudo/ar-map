import {describe, expect, it, vi} from 'vitest'
import {startSession} from '../../src/ar/engine.js'

// A fake 8th Wall engine that records the pipeline modules we register.
function fakeXR8() {
  const modules = []
  return {
    modules,
    XR8: {
      XrController: {configure: vi.fn(), pipelineModule: () => ({name: 'xrcontroller'})},
      GlTextureRenderer: {pipelineModule: () => ({name: 'gltexturerenderer'})},
      Threejs: {pipelineModule: () => ({name: 'threejs'}), xrScene: () => ({scene: {}, camera: {}, renderer: {}})},
      XrConfig: {device: () => ({ANY: 'any', MOBILE_AND_HEADSETS: 'mobile'}), camera: () => ({BACK: 'back'})},
      addCameraPipelineModules: (list) => modules.push(...list),
      run: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      clearCameraPipelineModules: vi.fn(),
    },
  }
}

function start(handlers, opts) {
  const {XR8, modules} = fakeXR8()
  const canvas = document.createElement('canvas')
  const stop = startSession(XR8, canvas, handlers, opts)
  const status = modules.find((m) => m.name === 'welcome-ar-status')
  return {XR8, status, stop, canvas}
}

describe('startSession camera status', () => {
  it.each([
    ['DENY_CAMERA', 'denied'],
    ['NO_CAMERA', 'missing'],
    ['UNSPECIFIED', 'failed'],
  ])('maps engine reason %s to %s', (reason, expected) => {
    const onCamera = vi.fn()
    const {status} = start({onCamera})
    status.onCameraStatusChange({status: 'failed', reason})
    expect(onCamera).toHaveBeenCalledWith(expected, reason)
  })

  it('reports ready when video arrives', () => {
    const onCamera = vi.fn()
    start({onCamera}).status.onCameraStatusChange({status: 'hasVideo'})
    expect(onCamera).toHaveBeenCalledWith('ready')
  })

  it('passes tracking status through', () => {
    const onTracking = vi.fn()
    const {status} = start({onTracking})
    status.listeners[0].process({detail: {status: 'NORMAL'}})
    expect(onTracking).toHaveBeenCalledWith({status: 'NORMAL'})
  })
})

describe('startSession lifecycle', () => {
  it('runs on phones only unless desktop is allowed', () => {
    expect(start({}).XR8.run.mock.calls[0][0].allowedDevices).toBe('mobile')
    expect(start({}, {allowDesktop: true}).XR8.run.mock.calls[0][0].allowedDevices).toBe('any')
  })

  it('caps the canvas resolution at 2x', () => {
    window.devicePixelRatio = 3
    const {canvas} = start({})
    expect(canvas.width).toBe(window.innerWidth * 2)
  })

  it('pauses when the tab is hidden and stops cleanly', () => {
    const {XR8, stop} = start({})
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true})
    document.dispatchEvent(new Event('visibilitychange'))
    expect(XR8.pause).toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => false})
    document.dispatchEvent(new Event('visibilitychange'))
    expect(XR8.resume).toHaveBeenCalled()
    stop()
    expect(XR8.stop).toHaveBeenCalled()
    expect(XR8.clearCameraPipelineModules).toHaveBeenCalled()
  })

  it('reports engine crashes as a runtime error', () => {
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    start({onError}).status.onException(new Error('boom'))
    expect(onError.mock.calls[0][0].code).toBe('runtime')
  })
})
