// The green walking route drawn on the campus map.
import {COLOURS} from '../config.js'

const ROUTE_ID = 'walking-route'

export function clearRouteLine(map) {
  if (map.getLayer?.(ROUTE_ID)) map.removeLayer(ROUTE_ID)
  if (map.getSource?.(ROUTE_ID)) map.removeSource(ROUTE_ID)
}

export function drawRouteLine(map, points, bottomPadding) {
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
  map.fitBounds(bounds, {padding: {top: 150, bottom: bottomPadding, left: 40, right: 40}, maxZoom: 18})
}
