// /indoor?to=<id>: the way inside a building, on the indoor map. Opened from the AR screen at the
// entrance ("Continue inside on the map"), or straight from the place card for a trip that is all
// indoors ("Show the way"). It shows the room's floor, the route on each floor (the floor bar
// switches floors), the start at the entrance, and the room highlighted.
import {findDestination} from '../../map/destinations.js'
import {createCampusMap, loadMazeMap} from '../../map/mazemap.js'
import {fetchPoiDestination, poiIdFrom} from '../../map/poi-lookup.js'
import {getStart, isManual} from '../../route/start-point.js'
import {planRoute, readTripRoute} from '../../route/route.js'
import {readTripFix} from '../../geo/location.js'
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'

const ROUTE = 'indoor-route'
const ROUTE_BLUE = '#1f6feb'

/** The route's stretches as GeoJSON lines, each tagged with its floor level (z). Pure. */
export function routeByFloor(points) {
  const features = []
  let line = []
  let z = null
  for (const p of points) {
    const level = Number.isFinite(p.z) ? p.z : 0
    if (z !== null && level !== z) {
      if (line.length >= 2) features.push({type: 'Feature', properties: {z}, geometry: {type: 'LineString', coordinates: line}})
      line = line.slice(-1) // join the floors at the stair or lift
    }
    z = level
    line.push([p.lng, p.lat])
  }
  if (line.length >= 2) features.push({type: 'Feature', properties: {z}, geometry: {type: 'LineString', coordinates: line}})
  return {type: 'FeatureCollection', features}
}

/** The way in from the door: the saved trip route's indoor part, or a new plan from where the user is. */
async function indoorRoute(dest) {
  const saved = readTripRoute()
  if (saved?.destinationId === dest.id && saved.indoorPoints?.length >= 2) return saved.indoorPoints
  const start = getStart()
  const from = isManual(start) ? start : readTripFix()
  if (!from) return null
  const route = await planRoute(from, dest)
  if (route.status !== 'ok') return null
  return route.indoorPoints?.length >= 2 ? route.indoorPoints : route.points
}

export function indoorScreen(root, {navigate, params}) {
  let disposed = false
  let instance = null
  render(
    root,
    html`<div class="indoor">
      <div class="indoor__map" data-map role="region" aria-label="Indoor map"></div>
      <header class="indoor__top">
        <button class="round-btn" type="button" data-action="back" aria-label="Back to the campus map">${icon('close')}</button>
        <div class="indoor__title">
          <h1 tabindex="-1" data-indoor-name>Finding the way in…</h1>
          <p data-indoor-meta></p>
        </div>
      </header>
      <section class="indoor__card" data-indoor-card aria-live="polite">
        <p data-indoor-step>Loading the indoor map…</p>
        <button class="btn btn--primary btn--block" type="button" data-action="done">Done</button>
      </section>
    </div>`,
  )
  const off = onAction(root, {
    back: () => navigate(params.to ? `/?to=${encodeURIComponent(params.to)}` : '/'),
    done: () => navigate('/'),
  })

  ;(async () => {
    let dest = findDestination(params.to)
    if (!dest && poiIdFrom(params.to)) dest = await fetchPoiDestination(poiIdFrom(params.to)).catch(() => null)
    if (disposed) return
    if (!dest) {
      root.querySelector('[data-indoor-name]').textContent = 'We couldn’t find that place'
      root.querySelector('[data-indoor-step]').textContent = 'Search for it on the campus map.'
      return
    }
    root.querySelector('[data-indoor-name]').textContent = dest.name
    root.querySelector('[data-indoor-meta]').textContent = [dest.building, dest.floor != null ? `Level ${dest.floor}` : null].filter(Boolean).join(' · ')
    const [Mazemap, points] = await Promise.all([loadMazeMap(), indoorRoute(dest).catch(() => null)])
    if (disposed) return
    instance = createCampusMap(Mazemap, root.querySelector('[data-map]'), {
      options: {zLevel: dest.floor ?? 1, center: {lng: dest.lng, lat: dest.lat}, zoom: 19},
      onReady: (map) => {
        if (disposed) return
        const step = root.querySelector('[data-indoor-step]')
        if (points?.length >= 2) {
          map.addSource(ROUTE, {type: 'geojson', data: routeByFloor(points)})
          map.addLayer({id: ROUTE, type: 'line', source: ROUTE, layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': ROUTE_BLUE, 'line-width': 6}})
          const showFloor = () => map.setFilter(ROUTE, ['==', ['get', 'z'], map.getZLevel?.() ?? dest.floor])
          showFloor()
          map.on('zlevel', showFloor)
          // You start here: the door.
          const el = document.createElement('div')
          el.className = 'map-start'
          new Mazemap.mapboxgl.Marker({element: el}).setLngLat([points[0].lng, points[0].lat]).addTo(map)
          const startZ = points[0].z
          step.textContent = Number.isFinite(startZ) && startZ > 0 && startZ !== dest.floor ? `Start at the door on Level ${startZ}, then go to Level ${dest.floor}.` : `Follow the blue line to ${dest.name}.`
        } else step.textContent = `${dest.name} is highlighted on the map.`
        // The room itself, highlighted.
        try {
          if (dest.mazemapPoi && Mazemap.Highlighter && Mazemap.Data?.getPoi) {
            const highlighter = new Mazemap.Highlighter(map, {showOutline: true, showFill: true, outlineColor: '#00693e', fillColor: '#00693e'})
            Mazemap.Data.getPoi(dest.mazemapPoi).then((poi) => !disposed && poi && highlighter.highlight(poi))
          }
        } catch (err) {
          console.warn('[indoor] could not highlight the room', err)
        }
      },
    })
  })().catch((err) => {
    console.warn('[indoor] failed', err)
    const step = root.querySelector('[data-indoor-step]')
    if (step) step.textContent = 'The indoor map could not load. Check your connection.'
  })

  return () => {
    disposed = true
    off()
    instance?.destroy()
  }
}
