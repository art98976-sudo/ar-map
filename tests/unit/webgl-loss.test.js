import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {watchContextLoss} from '../../src/ui/webgl-loss.js'
import {arErrorKind} from '../../src/stats/errors.js'
import {errorCopy} from '../../src/ui/screens/ar-errors.js'

const lose = (canvas) => {
  const event = new Event('webglcontextlost', {cancelable: true})
  canvas.dispatchEvent(event)
  return event
}

describe('watchContextLoss', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks the browser for the context back', () => {
    const canvas = new EventTarget()
    watchContextLoss(canvas, {onLost: () => {}})
    expect(lose(canvas).defaultPrevented).toBe(true)
  })

  it('gives up after the wait, once', () => {
    const canvas = new EventTarget()
    const onLost = vi.fn()
    watchContextLoss(canvas, {onLost, giveUpMs: 3000})
    lose(canvas)
    lose(canvas)
    vi.advanceTimersByTime(2999)
    expect(onLost).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLost).toHaveBeenCalledTimes(1)
  })

  it('a context given back in time is not a failure', () => {
    const canvas = new EventTarget()
    const onLost = vi.fn()
    const onRestored = vi.fn()
    watchContextLoss(canvas, {onLost, onRestored, giveUpMs: 3000})
    lose(canvas)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    vi.advanceTimersByTime(5000)
    expect(onLost).not.toHaveBeenCalled()
    expect(onRestored).toHaveBeenCalledTimes(1)
  })

  it('stops listening when stopped, and copes with no canvas', () => {
    const canvas = new EventTarget()
    const onLost = vi.fn()
    const stop = watchContextLoss(canvas, {onLost, giveUpMs: 0})
    lose(canvas)
    stop()
    vi.advanceTimersByTime(10)
    expect(onLost).not.toHaveBeenCalled()
    expect(() => watchContextLoss(null, {onLost})()).not.toThrow()
  })

  it('the AR screen offers "Tap to reload AR" and counts it as webgl-lost', () => {
    const copy = errorCopy('webgl-lost')
    expect(copy.primary).toMatchObject({action: 'reload', label: 'Tap to reload AR'})
    expect(arErrorKind('webgl-lost')).toBe('webgl-lost')
  })
})
