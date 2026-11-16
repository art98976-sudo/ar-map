import footpaths from '../../data/footpaths.json'
import bundledCorrections from '../../data/footpath-corrections.json'
import {distanceM} from '../../geo/geo.js'
import {footpathEdgeId} from '../../route/footpaths.js'
import {html, render} from '../dom.js'

const STORAGE_KEY = 'welcomeAR.footpathCorrections.v1'
const WIDTH = 1000
const HEIGHT = 700
const SVG_NS = 'http://www.w3.org/2000/svg'
const TYPE_COLOURS = {path: '#16834b', steps: '#b7791f', ramp: '#2563eb', road: '#69757e', main: '#4b5563'}

const coordinate = ([lat, lng]) => [lng, lat]

function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

function correctionFile(value) {
  if (!value || !Array.isArray(value.removeEdges) || !Array.isArray(value.paths) || !Array.isArray(value.points)) {
    throw new Error('Correction file must contain removeEdges, paths, and points arrays.')
  }
  return value
}

function makeSvgElement(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}

export function geometryEditorScreen(root) {
  let corrections = copy(bundledCorrections)
  let mode = 'select'
  let markerType = 'entrance'
  let drawingPoints = []
  let selectedEdge = null
  let selectedPath = null
  let selectedPoint = null
  let dragHandle = null

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) corrections = correctionFile(JSON.parse(saved))
  } catch (error) {
    console.warn('[geometry-editor] saved corrections could not be loaded', error?.message)
  }

  render(root, html`
    <main class="geometry-editor">
      <header class="geometry-editor__header">
        <div>
          <a class="geometry-editor__back" href="#/">← Campus map</a>
          <h1 tabindex="-1">Pedestrian geometry corrections</h1>
          <p>Review the mapped footpath network and save verified corrections separately from the 3D campus model.</p>
        </div>
      </header>
      <section class="geometry-editor__notice" role="note">
        The 3D model labels outdoor surfaces generically; do not infer walkability from its horizontal faces. Only add paths you have verified.
        Corrections stay on this device until exported.
      </section>
      <div class="geometry-editor__toolbar">
        <button type="button" data-action="select">Select / remove a mapped segment</button>
        <button type="button" data-action="draw">Add verified path</button>
        <label>Path type
          <select data-type>
            <option value="path">Footpath</option>
            <option value="steps">Stairs</option>
            <option value="ramp">Ramp</option>
            <option value="road">Shared road</option>
          </select>
        </label>
        <label>Width (m) <input data-width type="number" min="0.5" max="20" step="0.1" value="1.8"></label>
        <label>Direction
          <select data-direction>
            <option value="both">Both ways</option>
            <option value="forward">Drawing direction</option>
            <option value="reverse">Reverse drawing direction</option>
          </select>
        </label>
        <label><input data-verified type="checkbox" disabled> Field verified</label>
        <button type="button" data-action="marker">Add entrance / point</button>
        <label>Point type
          <select data-marker-type>
            <option value="entrance">Entrance</option>
            <option value="important">Navigation point</option>
          </select>
        </label>
        <button type="button" data-action="finish" disabled>Finish path</button>
        <button type="button" data-action="remove" disabled>Remove selection</button>
        <button type="button" data-action="undo" disabled>Undo segment removal</button>
        <button type="button" data-action="save">Save and export corrections</button>
        <label class="geometry-editor__upload">Load corrections <input data-upload type="file" accept="application/json,.json"></label>
        <button type="button" data-action="reset">Reset local edits</button>
      </div>
      <p class="geometry-editor__status" data-status role="status">Select a mapped segment to remove it, or add a path by clicking its centerline points. New endpoints snap only to mapped nodes within 3 m.</p>
      <svg class="geometry-editor__map" data-map viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Campus pedestrian path network; click to edit geometry"></svg>
      <p class="geometry-editor__legend">Green: mapped pedestrian path · Blue: ramp · Amber: stairs · Gray: shared road · Dashed red: removed source segment · Circle: entrance/point. Drag added-path handles to move nodes.</p>
    </main>
  `)

  const svg = root.querySelector('[data-map]')
  const status = root.querySelector('[data-status]')
  const widthInput = root.querySelector('[data-width]')
  const directionInput = root.querySelector('[data-direction]')
  const typeInput = root.querySelector('[data-type]')
  const markerInput = root.querySelector('[data-marker-type]')
  const verifiedInput = root.querySelector('[data-verified]')
  const bounds = footpaths.bbox
  const [south, west, north, east] = bounds
  const toScreen = ([lng, lat]) => ({x: (lng - west) / (east - west) * WIDTH, y: (north - lat) / (north - south) * HEIGHT})
  const fromScreen = (x, y) => [west + x / WIDTH * (east - west), north - y / HEIGHT * (north - south)]

  function snapToNode(point) {
    let best = null
    for (const node of footpaths.nodes) {
      const nodePoint = coordinate(node)
      const distance = distanceM({lat: point[1], lng: point[0]}, {lat: nodePoint[1], lng: nodePoint[0]})
      if (distance <= 3 && (!best || distance < best.distance)) best = {point: nodePoint, distance}
    }
    return best?.point ?? point
  }

  function pathWidthPixels(widthM) {
    const metresPerPixel = ((east - west) * 111_320 * Math.cos(((south + north) / 2) * Math.PI / 180)) / WIDTH
    return Math.max(1, (widthM || 1.8) / metresPerPixel)
  }

  function updateControls() {
    root.querySelector('[data-action="finish"]').disabled = drawingPoints.length < 2
    root.querySelector('[data-action="remove"]').disabled = !selectedEdge && selectedPath == null && selectedPoint == null
    root.querySelector('[data-action="undo"]').disabled = !corrections.removeEdges.length
    const feature = selectedPath != null ? corrections.paths[selectedPath] : selectedPoint != null ? corrections.points[selectedPoint] : null
    verifiedInput.disabled = !feature
    verifiedInput.checked = feature?.properties?.verified === true
  }

  function draw() {
    svg.replaceChildren()
    const removed = new Set(corrections.removeEdges)
    for (const [a, b, , type] of footpaths.edges) {
      const id = footpathEdgeId(footpaths.nodes[a], footpaths.nodes[b])
      const start = toScreen(coordinate(footpaths.nodes[a]))
      const end = toScreen(coordinate(footpaths.nodes[b]))
      svg.append(makeSvgElement('line', {
        x1: start.x, y1: start.y, x2: end.x, y2: end.y,
        class: `geometry-editor__edge${removed.has(id) ? ' is-removed' : ''}${selectedEdge === id ? ' is-selected' : ''}`,
        stroke: TYPE_COLOURS[type] || TYPE_COLOURS.path,
        'data-edge': id,
      }))
    }

    corrections.paths.forEach((feature, index) => {
      const points = feature.geometry.coordinates.map(toScreen)
      const props = feature.properties ?? {}
      const path = makeSvgElement('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        class: `geometry-editor__correction${selectedPath === index ? ' is-selected' : ''}`,
        stroke: TYPE_COLOURS[props.type] || TYPE_COLOURS.path,
        'stroke-width': pathWidthPixels(props.widthM),
      })
      svg.append(path)
      svg.append(makeSvgElement('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        class: 'geometry-editor__path-hit-target',
        'stroke-width': Math.max(12, pathWidthPixels(props.widthM)),
        'data-path': index,
        'aria-hidden': 'true',
      }))
      if (selectedPath === index) {
        points.forEach((p, vertex) => svg.append(makeSvgElement('circle', {
          cx: p.x, cy: p.y, r: 7, class: 'geometry-editor__handle',
          'data-handle-path': index, 'data-handle-vertex': vertex,
        })))
      }
    })

    corrections.points.forEach((feature, index) => {
      const p = toScreen(feature.geometry.coordinates)
      svg.append(makeSvgElement('circle', {
        cx: p.x, cy: p.y, r: 7, class: `geometry-editor__marker${selectedPoint === index ? ' is-selected' : ''}`,
        'data-point': index,
      }))
    })

    if (drawingPoints.length) {
      const points = drawingPoints.map(toScreen)
      svg.append(makeSvgElement('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        class: 'geometry-editor__drawing',
        'stroke-width': pathWidthPixels(Number(widthInput.value)),
      }))
      points.forEach((p) => svg.append(makeSvgElement('circle', {cx: p.x, cy: p.y, r: 5, class: 'geometry-editor__draw-point'})))
    }
    updateControls()
  }

  function setMode(next) {
    mode = next
    selectedEdge = null
    selectedPath = null
    selectedPoint = null
    status.textContent = next === 'draw'
      ? 'Click centerline points; endpoints snap to nearby mapped nodes. Finish the path when complete.'
      : next === 'marker'
        ? 'Click on a mapped node to place a point. Entrances must be field-verified.'
        : 'Select a mapped segment to remove it, or select an added path to edit its width or nodes.'
    draw()
  }

  function screenPoint(event) {
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(svg.getScreenCTM().inverse())
    return {x: local.x, y: local.y, coordinate: fromScreen(local.x, local.y)}
  }

  function finishPath() {
    if (drawingPoints.length < 2) return
    corrections.paths.push({
      type: 'Feature',
      geometry: {type: 'LineString', coordinates: drawingPoints},
      properties: {
        id: `manual-${Date.now()}`,
        type: typeInput.value,
        widthM: Math.max(0.5, Number(widthInput.value) || 1.8),
        direction: directionInput.value,
        wheelchair: null,
        verified: false,
      },
    })
    drawingPoints = []
    setMode('select')
    status.textContent = 'Path added as unverified. Confirm it on site before shipping the correction file.'
  }

  root.querySelector('[data-action="select"]').addEventListener('click', () => setMode('select'))
  root.querySelector('[data-action="draw"]').addEventListener('click', () => {
    drawingPoints = []
    setMode('draw')
  })
  root.querySelector('[data-action="marker"]').addEventListener('click', () => setMode('marker'))
  root.querySelector('[data-action="finish"]').addEventListener('click', finishPath)
  root.querySelector('[data-action="remove"]').addEventListener('click', () => {
    if (selectedEdge) {
      if (!corrections.removeEdges.includes(selectedEdge)) corrections.removeEdges.push(selectedEdge)
      selectedEdge = null
    } else if (selectedPath != null) {
      corrections.paths.splice(selectedPath, 1)
      selectedPath = null
    } else if (selectedPoint != null) {
      corrections.points.splice(selectedPoint, 1)
      selectedPoint = null
    }
    draw()
  })
  root.querySelector('[data-action="undo"]').addEventListener('click', () => {
    corrections.removeEdges.pop()
    draw()
  })
  root.querySelector('[data-action="reset"]').addEventListener('click', () => {
    corrections = copy(bundledCorrections)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      status.textContent = `Local edits reset in memory, but browser storage could not be cleared: ${error.message}`
    }
    drawingPoints = []
    selectedEdge = null
    selectedPath = null
    status.textContent = 'Local corrections reset to the bundled file.'
    draw()
  })
  root.querySelector('[data-action="save"]').addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(corrections))
      const blob = new Blob([`${JSON.stringify(corrections, null, 2)}\n`], {type: 'application/json'})
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'footpath-corrections.json'
      link.click()
      URL.revokeObjectURL(url)
      status.textContent = 'Saved on this device and downloaded. Review, field-verify, then replace src/data/footpath-corrections.json to publish.'
    } catch (error) {
      console.error('[geometry-editor] could not save corrections', error)
      status.textContent = `Could not save corrections: ${error.message}`
    }
  })
  root.querySelector('[data-upload]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      corrections = correctionFile(JSON.parse(await file.text()))
      status.textContent = 'Correction file loaded. Save to activate it on this device.'
      draw()
    } catch (error) {
      status.textContent = `Could not load correction file: ${error.message}`
    }
  })
  widthInput.addEventListener('change', () => {
    if (selectedPath == null) return
    corrections.paths[selectedPath].properties.widthM = Math.max(0.5, Number(widthInput.value) || 1.8)
    draw()
  })
  typeInput.addEventListener('change', () => {
    if (selectedPath == null) return
    corrections.paths[selectedPath].properties.type = typeInput.value
    draw()
  })
  directionInput.addEventListener('change', () => {
    if (selectedPath == null) return
    corrections.paths[selectedPath].properties.direction = directionInput.value
  })
  markerInput.addEventListener('change', () => {
    markerType = markerInput.value
  })
  verifiedInput.addEventListener('change', () => {
    const feature = selectedPath != null ? corrections.paths[selectedPath] : selectedPoint != null ? corrections.points[selectedPoint] : null
    if (!feature) return
    feature.properties.verified = verifiedInput.checked
    status.textContent = verifiedInput.checked
      ? 'Marked field-verified. Include it only if the geometry was checked on site.'
      : 'Marked unverified; this feature will not be used by navigation.'
    draw()
  })

  svg.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-handle-path]')
    if (!handle) return
    event.preventDefault()
    selectedPath = Number(handle.dataset.handlePath)
    dragHandle = {path: selectedPath, vertex: Number(handle.dataset.handleVertex)}
    svg.setPointerCapture(event.pointerId)
  })
  svg.addEventListener('pointermove', (event) => {
    if (!dragHandle) return
    const p = screenPoint(event)
    const position = snapToNode(p.coordinate)
    const point = corrections.paths[dragHandle.path].geometry.coordinates[dragHandle.vertex]
    point[0] = position[0]
    point[1] = position[1]
    draw()
  })
  svg.addEventListener('pointerup', () => {
    dragHandle = null
  })
  svg.addEventListener('dblclick', (event) => {
    if (mode === 'draw') {
      event.preventDefault()
      finishPath()
    }
  })
  svg.addEventListener('click', (event) => {
    if (event.target.closest('[data-handle-path]')) return
    const edge = event.target.closest('[data-edge]')
    const addedPath = event.target.closest('[data-path]')
    const point = event.target.closest('[data-point]')
    if (mode === 'draw') {
      const p = screenPoint(event)
      drawingPoints.push(snapToNode(p.coordinate))
      draw()
    } else if (mode === 'marker') {
      const p = snapToNode(screenPoint(event).coordinate)
      corrections.points.push({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: p},
        properties: {id: `manual-point-${Date.now()}`, type: markerType, level: 0, wheelchair: null, verified: false},
      })
      setMode('select')
      status.textContent = 'Point added as unverified. Mark it verified only after checking it on site.'
    } else if (edge) {
      selectedEdge = edge.dataset.edge
      selectedPath = null
      selectedPoint = null
      draw()
    } else if (addedPath) {
      selectedPath = Number(addedPath.dataset.path)
      selectedEdge = null
      selectedPoint = null
      widthInput.value = corrections.paths[selectedPath].properties.widthM ?? 1.8
      typeInput.value = corrections.paths[selectedPath].properties.type ?? 'path'
      directionInput.value = corrections.paths[selectedPath].properties.direction ?? 'both'
      draw()
    } else if (point) {
      selectedPoint = Number(point.dataset.point)
      selectedEdge = null
      selectedPath = null
      draw()
    }
  })

  draw()
  return () => {
    svg.replaceChildren()
  }
}
