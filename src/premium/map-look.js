// The premium map's look: calm natural ground, lit 3D buildings with soft shadows, sky and
// haze, an architectural indoor plan, and labels with soft halos. Only paint, layout and
// added layers: MazeMap's own logic (floors, routes, data) is left as it is.
//
// With a Mapbox key in VITE_MAPBOX_TOKEN, aerial imagery and 3D terrain are added too.
import {buildingFeatures, loadBuildings, outlineMask} from './buildings.js'

export const PREMIUM = {
  ground: '#262a27',
  grass: '#2c3530',
  wood: '#27312b',
  water: '#1b2932',
  path: '#454a46',
  road: '#3a3f3e',
  roadCase: '#22262a',
  stone: '#b3ada2',
  glass: '#9aa3a6',
  sandstone: '#a89f90',
  indoorFloor: '#f3f1ec',
  indoorWall: '#2b2f33',
  indoorLine: '#3b4045',
  labelOut: 'rgba(255,255,255,0.92)',
  haloOut: 'rgba(8,10,12,0.75)',
  labelIn: '#2b2f33',
  haloIn: '#ffffff',
  fog: '#1d2326',
  sky: '#3d4b57',
  space: '#0b0e10',
}

/** Indoor plan appears from this zoom; 3D buildings fade out just before it. */
export const INDOOR_ZOOM = 17.8
const EXTRUDE = 'premium-buildings'
const EXTRUDE_OTHERS = 'premium-buildings-other'
const SKY = 'premium-sky'
const IMAGERY = 'premium-imagery'

/**
 * What to do with one of the map's layers: {hide: true}, or paint/layout values to set.
 * Pure, so it can be tested without a map.
 */
export function restyle(id, type) {
  const P = PREMIUM
  // Things that read as cartoon or clutter on a realistic map.
  if (/pattern|oneway-arrow|shield|level-crossing|turning-feature|golf-hole|aerialway|ferry|admin-|hillshade|building-number|block-number|aeroway|national-park|pitch-outline/.test(id)) return {hide: true}
  if (/^(poi-label|transit-label|airport-label|state-label|country-label|settlement)/.test(id)) return {hide: true}
  if (id === 'mm-building-label' || id === 'mm-campus-dot' || id === 'mm-campus-label' || id === 'mm-campus-area') return {hide: true}
  if (/^building/.test(id)) return {hide: true} // replaced by 3D buildings

  if (type === 'background') return {paint: {'background-color': P.ground}}
  if (/^land(cover|use)|grass/.test(id) && type === 'fill') {
    return {paint: {'fill-color': ['match', ['get', 'class'], ['wood', 'scrub'], P.wood, ['water'], P.water, P.grass], 'fill-opacity': 0.9}}
  }
  if (/parking|structure/.test(id) && type === 'fill') return {paint: {'fill-color': P.road, 'fill-opacity': 0.6}}
  if (/water/.test(id) && type === 'fill') return {paint: {'fill-color': P.water}}
  if (/water/.test(id) && type === 'line') return {paint: {'line-color': P.water}}
  if (/road-polygon|pedestrian-polygon/.test(id) && type === 'fill') return {paint: {'fill-color': P.path}}
  if (/(path|steps|pedestrian)/.test(id) && type === 'line') {
    if (/-bg|-case/.test(id)) return {paint: {'line-color': P.roadCase, 'line-opacity': 0.5}}
    return {paint: {'line-color': P.path, 'line-dasharray': [1, 0]}}
  }
  if (/rail/.test(id) && type === 'line') return {paint: {'line-color': '#4b4f52'}}
  if (/^(road|bridge|tunnel)-/.test(id) && type === 'line') {
    return {paint: {'line-color': /case/.test(id) ? P.roadCase : P.road}}
  }

  // Indoor plan: off-white floors, charcoal walls, thin precise lines, no room fills.
  if (id === 'mm-building-fill') return {paint: {'fill-color': '#d9d5cd', 'fill-opacity': 0.95}}
  if (id === 'mm-floor-outline' || id === 'mm-rooms' || id === 'mm-areas-fill') return {paint: {'fill-color': P.indoorFloor, 'fill-opacity': 1}}
  if (id === 'mm-rooms-fill') return {paint: {'fill-opacity': 0}}
  if (id === 'mm-stairs-fill' || id === 'mm-elevators-fill') return {paint: {'fill-color': '#e4e1da'}}
  if (id === 'mm-rooms-outline' || id === 'mm-stairs' || id === 'mm-inventory') return {paint: {'line-color': P.indoorLine, 'line-width': 0.75}}
  if (id === 'mm-doors') return {paint: {'line-color': P.indoorFloor, 'line-width': 1.5}}
  if (id === 'mm-walls-extrusion' || id === 'mm-area-extrusion') return {paint: {'fill-extrusion-color': P.indoorWall}}

  if (type === 'symbol') {
    const indoor = id.startsWith('mm-')
    return {
      paint: {
        'text-color': indoor ? P.labelIn : P.labelOut,
        'text-halo-color': indoor ? P.haloIn : P.haloOut,
        'text-halo-width': 1.4,
        'text-halo-blur': 0.6,
      },
    }
  }
  return null
}

/** MazeMap indoor layers (not its route) wait until the 3D buildings have faded out. */
export function indoorMinZoom(id) {
  return id.startsWith('mm-') && !id.includes('route') ? INDOOR_ZOOM - 0.3 : null
}

function apply(map, id, rule) {
  try {
    if (rule.hide) {
      map.setLayoutProperty(id, 'visibility', 'none')
      return
    }
    const minzoom = indoorMinZoom(id)
    if (minzoom != null) map.setLayerZoomRange(id, minzoom, 24)
    for (const [k, v] of Object.entries(rule.paint || {})) map.setPaintProperty(id, k, v)
  } catch {
    // a property this layer type does not take: leave it as MazeMap drew it
  }
}

/** Restyle every layer not in `done` (and add it there), so new MazeMap layers get the look once. */
export function restyleAll(map, done = new Set()) {
  for (const layer of map.getStyle()?.layers || []) {
    if (layer.id.startsWith('premium-') || done.has(layer.id)) continue
    done.add(layer.id)
    const rule = restyle(layer.id, layer.type)
    if (rule) apply(map, layer.id, rule)
  }
}

/**
 * Where 3D starts in the layer order: the first MazeMap layer that stands up (walls) or floats
 * (labels, its route). Layer order is: ground, indoor floor plan, our route, 3D buildings, then
 * this. The indoor plan only shows once the 3D buildings have faded, so they never fight.
 */
export function firstAboveGround(map) {
  return map.getStyle().layers.find((l) => l.id.startsWith('mm-') && (!['fill', 'line'].includes(l.type) || l.id.includes('route')))?.id
}
const firstIndoorLayer = firstAboveGround

const SUN = {azimuth: 215, polar: 42}

function lights(shadows) {
  return [
    {id: 'ambient', type: 'ambient', properties: {color: '#dfe6ec', intensity: 0.42}},
    {
      id: 'sun',
      type: 'directional',
      properties: {
        color: '#fff4e6',
        intensity: 0.62,
        direction: [SUN.azimuth, SUN.polar],
        'cast-shadows': shadows,
        'shadow-intensity': 0.55,
      },
    },
  ]
}

function addBuildings(map, collection) {
  const before = firstIndoorLayer(map)
  const fade = ['interpolate', ['linear'], ['zoom'], INDOOR_ZOOM - 0.5, 1, INDOOR_ZOOM, 0]
  const paint = (tone) => ({
    'fill-extrusion-color': tone,
    'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
    'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
    'fill-extrusion-opacity': fade,
    'fill-extrusion-vertical-gradient': true,
    'fill-extrusion-ambient-occlusion-intensity': 0.35,
    'fill-extrusion-ambient-occlusion-radius': 4,
    'fill-extrusion-cast-shadows': true,
  })
  // The rest of the town's buildings, from the street map (minus the University ones).
  if (map.getSource('composite') && !map.getLayer(EXTRUDE_OTHERS)) {
    map.addLayer(
      {
        id: EXTRUDE_OTHERS,
        type: 'fill-extrusion',
        source: 'composite',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['all', ['!=', ['get', 'underground'], 'true'], ['!', ['within', outlineMask(collection)]]],
        paint: paint(PREMIUM.sandstone),
      },
      before,
    )
  }
  if (!map.getSource(EXTRUDE)) map.addSource(EXTRUDE, {type: 'geojson', data: collection})
  if (!map.getLayer(EXTRUDE)) {
    map.addLayer(
      {
        id: EXTRUDE,
        type: 'fill-extrusion',
        source: EXTRUDE,
        paint: {...paint(PREMIUM.stone), 'fill-extrusion-color': ['match', ['get', 'tone'], 1, PREMIUM.glass, 2, PREMIUM.sandstone, PREMIUM.stone]},
      },
      before,
    )
  }
}

function addSkyAndHaze(map, on) {
  try {
    map.setFog(
      on
        ? {
            range: [0.8, 9],
            color: PREMIUM.fog,
            'high-color': PREMIUM.sky,
            'horizon-blend': 0.12,
            'space-color': PREMIUM.space,
            'star-intensity': 0,
          }
        : null,
    )
  } catch (err) {
    console.warn('[premium] fog', err)
  }
  if (!map.getLayer(SKY)) {
    map.addLayer({
      id: SKY,
      type: 'sky',
      paint: {
        'sky-type': 'gradient',
        'sky-gradient': ['interpolate', ['linear'], ['sky-radial-progress'], 0.8, '#4a5a66', 1, '#1a2126'],
        'sky-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0, 5, 1],
      },
    })
  }
}

function addImageryAndTerrain(map, token) {
  if (!token || map.getSource(IMAGERY)) return
  map.addSource(IMAGERY, {
    type: 'raster',
    tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${token}`],
    tileSize: 512,
    maxzoom: 19,
    attribution: '© Mapbox © Maxar',
  })
  const firstRoad = map.getStyle().layers.find((l) => /^(road|tunnel|bridge)-/.test(l.id))?.id
  map.addLayer(
    {id: IMAGERY, type: 'raster', source: IMAGERY, paint: {'raster-saturation': -0.35, 'raster-brightness-max': 0.9, 'raster-fade-duration': 200}},
    firstRoad,
  )
  // With photos underneath, roads and ground colours step back.
  for (const l of map.getStyle().layers) {
    if (/^(land|water|road-polygon)/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-opacity', 0)
    if (/^(road|bridge|tunnel)-/.test(l.id) && l.type === 'line') map.setPaintProperty(l.id, 'line-opacity', 0.35)
  }
  map.addSource('premium-dem', {
    type: 'raster-dem',
    tiles: [`https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.webp?access_token=${token}`],
    tileSize: 512,
    maxzoom: 14,
  })
  map.setTerrain({source: 'premium-dem', exaggeration: 1})
}

/**
 * Give `map` the premium look. Returns controls for the fps guard.
 * Buildings load after the map is usable, so the plan shows first and 3D fills in.
 */
export function applyPremiumLook(map, {token = import.meta.env?.VITE_MAPBOX_TOKEN} = {}) {
  let shadows = true
  let haze = true
  const done = new Set()
  restyleAll(map, done)
  // MazeMap adds layers later (indoor plan, routes); give each new one the look once.
  let pending = false
  const onStyle = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      restyleAll(map, done)
    })
  }
  map.on('styledata', onStyle)
  try {
    map.setLights(lights(shadows))
  } catch (err) {
    console.warn('[premium] lights', err)
  }
  addSkyAndHaze(map, haze)
  try {
    addImageryAndTerrain(map, token)
  } catch (err) {
    console.warn('[premium] imagery', err)
  }
  const buildings = loadBuildings()
    .then((collection) => {
      if (map.getStyle()) addBuildings(map, collection)
      return collection
    })
    .catch((err) => {
      console.warn('[premium] buildings', err)
      return buildingFeatures([])
    })

  return {
    buildings,
    hasImagery: Boolean(token),
    drop(effect) {
      if (effect === 'shadows' && shadows) {
        shadows = false
        map.setLights(lights(false))
      }
      if (effect === 'haze' && haze) {
        haze = false
        addSkyAndHaze(map, false)
      }
    },
    destroy() {
      map.off('styledata', onStyle)
    },
  }
}
