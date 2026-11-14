// WebGL context loss: the phone can take the GPU away (memory pressure, a long time in the
// background, a driver reset), which leaves a frozen or black canvas. Ask the browser to give the
// context back, and if it has not within giveUpMs, tell the screen so it can offer a reload.

/**
 * Watch one canvas. onLost() runs once the context has stayed lost for giveUpMs (0: at once);
 * onRestored() runs when the browser gives it back. Returns stop().
 */
export function watchContextLoss(canvas, {onLost, onRestored = () => {}, giveUpMs = 3000, timers = globalThis} = {}) {
  if (!canvas?.addEventListener) return () => {}
  let timer = null
  let gaveUp = false
  const lost = (event) => {
    event.preventDefault() // without this the browser never restores the context
    if (timer != null || gaveUp) return
    timer = timers.setTimeout(() => {
      timer = null
      gaveUp = true
      onLost()
    }, giveUpMs)
  }
  const restored = () => {
    if (timer != null) timers.clearTimeout(timer)
    timer = null
    gaveUp = false
    onRestored()
  }
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', restored)
  return () => {
    if (timer != null) timers.clearTimeout(timer)
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', restored)
  }
}
