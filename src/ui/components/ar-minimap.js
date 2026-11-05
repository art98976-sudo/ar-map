// Debug minimap: the route, the walked track, the user and where the camera looks, north up.
// If the arrow here points away from where the phone really faces, the alignment is wrong.

/** Scale and centre a set of route-frame points {x east, y north} into a square canvas. */
export function fitToBox(points, size, padding = 14) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(...xs) - minX
  const spanY = Math.max(...ys) - minY
  const scale = (size - padding * 2) / Math.max(spanX, spanY, 10)
  const offX = (size - spanX * scale) / 2
  const offY = (size - spanY * scale) / 2
  // Canvas y grows downwards, north grows upwards.
  return (p) => ({x: offX + (p.x - minX) * scale, y: size - offY - (p.y - minY) * scale})
}

export function drawMinimap(canvas, {route, user, lookDeg, track = []}) {
  const ctx = canvas?.getContext?.('2d')
  if (!ctx) return
  const size = canvas.width
  const toPx = fitToBox([...route, user, ...track], size)
  ctx.clearRect(0, 0, size, size)

  const line = (points, color, width) => {
    if (points.length < 2) return
    ctx.beginPath()
    points.forEach((p, i) => {
      const q = toPx(p)
      if (i) ctx.lineTo(q.x, q.y)
      else ctx.moveTo(q.x, q.y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  line(route, '#76b72a', 6)
  line(track, '#ffffff', 3)

  // Route start, so its direction can be read at a glance.
  const start = toPx(route[0])
  ctx.fillStyle = '#76b72a'
  ctx.beginPath()
  ctx.arc(start.x, start.y, 7, 0, Math.PI * 2)
  ctx.fill()

  // User and camera direction.
  const at = toPx(user)
  const rad = (lookDeg * Math.PI) / 180
  ctx.strokeStyle = '#f7d64c'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(at.x, at.y)
  ctx.lineTo(at.x + Math.sin(rad) * 34, at.y - Math.cos(rad) * 34)
  ctx.stroke()
  ctx.fillStyle = '#f7d64c'
  ctx.beginPath()
  ctx.arc(at.x, at.y, 8, 0, Math.PI * 2)
  ctx.fill()
}
