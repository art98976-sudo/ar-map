// Room centres from the 3D campus model, by MazeMap poiId. Built by tools/build-room-centres.mjs
// into a ~110 kB file, so the AR screen never downloads the 6 MB model itself.
let request = null

function loadCentres() {
  request ??= fetch('/data/room-centres.json')
    .then((res) => (res.ok ? res.json() : {}))
    .catch((err) => {
      console.warn('[room-centres] could not load', err)
      request = null // try again next time
      return {}
    })
  return request
}

/**
 * The centre of a room in the campus model, as {lat, lng, floor}, or null when the model has
 * no room with this poiId. Only for placing a marker: routes still come from MazeMap.
 */
export async function getRoomCentre(poiId) {
  if (poiId == null) return null
  const entry = (await loadCentres())[String(poiId)]
  return entry ? {lat: entry[0], lng: entry[1], floor: entry[2]} : null
}
