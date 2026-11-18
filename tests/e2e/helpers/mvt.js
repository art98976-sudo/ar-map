// A minimal Mapbox Vector Tile writer for tests (MazeMap floor tiles): layers of lines and polygons
// in lng/lat, with an `id` property, encoded with pbf as tiles.mazemap.com would send them.
import {PbfWriter as Pbf} from 'pbf'

const zigzag = (n) => (n << 1) ^ (n >> 31)

/** lng/lat -> tile pixel (extent 4096) in tile {x, y, z}. */
function toTile([lng, lat], {x, y, z}, extent = 4096) {
  const n = 2 ** z
  const px = ((lng + 180) / 360) * n
  const rad = (lat * Math.PI) / 180
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  return [Math.round((px - x) * extent), Math.round((py - y) * extent)]
}

function geometry(rings, tile, closed) {
  const out = []
  let cx = 0
  let cy = 0
  for (const ring of rings) {
    const pts = ring.map((p) => toTile(p, tile))
    const body = closed ? pts.slice(0, -1) : pts
    out.push((1 & 7) | (1 << 3), zigzag(body[0][0] - cx), zigzag(body[0][1] - cy))
    ;[cx, cy] = body[0]
    out.push((2 & 7) | ((body.length - 1) << 3))
    for (const [px, py] of body.slice(1)) {
      out.push(zigzag(px - cx), zigzag(py - cy))
      cx = px
      cy = py
    }
    if (closed) out.push((7 & 7) | (1 << 3))
  }
  return out
}

/** layers: {name: [{id, line: [[lng, lat], ...]} | {id, polygon: [[[lng, lat], ...]]}]}. */
export function encodeTile(layers, tile) {
  const pbf = new Pbf()
  for (const [name, features] of Object.entries(layers)) {
    pbf.writeMessage(3, (_, p) => {
      p.writeVarintField(15, 2)
      p.writeStringField(1, name)
      features.forEach((f, i) => {
        p.writeMessage(2, (_, q) => {
          q.writeVarintField(1, i + 1)
          q.writePackedVarint(2, [0, i]) // tag: key 0 ("id"), value i
          q.writeVarintField(3, f.line ? 2 : 3)
          q.writePackedVarint(4, f.line ? geometry([f.line], tile, false) : geometry(f.polygon, tile, true))
        })
      })
      p.writeStringField(3, 'id')
      features.forEach((f) => p.writeMessage(4, (_, q) => q.writeVarintField(5, Number(f.id))))
      p.writeVarintField(5, 4096)
    })
  }
  return Buffer.from(pbf.finish())
}

/** The tile {x, y, z} a point is in. */
export function tileOf([lng, lat], z) {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  return {x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n), z}
}
