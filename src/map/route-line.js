// The green walking route drawn on the campus map.
import {COLOURS} from '../config.js'

const ROUTE_ID = 'walking-route'

export function clearRouteLine(map) {
  if (map.getLayer?.(ROUTE_ID)) map.removeLayer(ROUTE_ID)
  if (map.getSource?.(ROUTE_ID)) map.removeSource(ROUTE_ID)
}

/**
 * Draw the route and frame it. frame(bounds): how to frame it (the home map frames it in the part
 * that shows above the card, map-viewport.js); without one, a plain fit.
 */
export function drawRouteLine(map, points, frame = null) {
  const coordinates = points.map((p) => [p.lng, p.lat])
  map.addSource(ROUTE_ID, {type: 'geojson', data: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}})
  map.addLayer({
    id: ROUTE_ID,
    type: 'line',
    source: ROUTE_ID,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': COLOURS.brandGreen, 'line-width': 6, 'line-opacity': 0.9},
  })
  const bounds = coordinates.reduce((b, c) => b.extend(c), new window.Mazemap.mapboxgl.LngLatBounds(coordinates[0], coordinates[0]))
  if (frame) frame(bounds)
  else map.fitBounds(bounds, {padding: 40, maxZoom: 18})
}
