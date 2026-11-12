// Builds public/data/room-centres.json from the campus model: for every room mesh, the centre of
// its bounding box as GPS, and its floor. The AR screen reads this small file instead of the
// 6 MB model. Run again whenever public/data/stirling_campus.glb changes:
//   node tools/build-room-centres.mjs
import {readFileSync, writeFileSync} from 'node:fs'
import {floorLevelOf, modelToLatLng, poiIdOf} from '../src/map/campus-geo.js'

const GLB = 'public/data/stirling_campus.glb'
const OUT = 'public/data/room-centres.json'

const bin = readFileSync(GLB)
if (bin.readUInt32LE(0) !== 0x46546c67) throw new Error(`${GLB} is not a GLB file`)
const gltf = JSON.parse(bin.subarray(20, 20 + bin.readUInt32LE(12)).toString('utf8'))

// The model is exported Z-up; only the Campus root turns it to Y-up. Position accessors are
// therefore x east, y north, z up, which is what we want here.
const parentOf = new Map()
gltf.nodes.forEach((node, i) => node.children?.forEach((c) => parentOf.set(c, i)))
const transformed = gltf.nodes.filter((n) => (n.matrix || n.translation || n.rotation || n.scale) && n.name !== 'Campus')
if (transformed.length) throw new Error(`unexpected node transforms: ${transformed.map((n) => n.name).join(', ')}`)

function levelOf(index) {
  for (let i = parentOf.get(index); i != null; i = parentOf.get(i)) {
    const level = floorLevelOf(gltf.nodes[i].name)
    if (level != null) return level
  }
  return null
}

const out = {}
let skipped = 0
gltf.nodes.forEach((node, index) => {
  const poiId = poiIdOf(node.name)
  if (!poiId || node.mesh == null) return
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const prim of gltf.meshes[node.mesh].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION]
    if (!acc.min || !acc.max) {
      skipped++
      return
    }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], acc.min[k])
      max[k] = Math.max(max[k], acc.max[k])
    }
  }
  const {lat, lng} = modelToLatLng((min[0] + max[0]) / 2, (min[1] + max[1]) / 2)
  out[poiId] = [Number(lat.toFixed(7)), Number(lng.toFixed(7)), levelOf(index)]
})

writeFileSync(OUT, JSON.stringify(out))
console.log(`${OUT}: ${Object.keys(out).length} rooms${skipped ? `, ${skipped} skipped (no bounds)` : ''}`)

// ---------- public/data/room-types.json: toilets and lifts, for the quick chips on the map ----------
// [poiId, lat, lng, level, label, building]. The model names rooms "<category>_<room no>_<poiId>".
const TYPES_OUT = 'public/data/room-types.json'
const buildingOf = (index) => {
  for (let i = parentOf.get(index); i != null; i = parentOf.get(i)) {
    const name = gltf.nodes[i].name
    if (/^B_/.test(name) && floorLevelOf(name) == null) return name.slice(2).replace(/_/g, ' ')
  }
  return ''
}
const toiletLabel = (roomNo) => {
  if (/DISABLED|ACCESS/i.test(roomNo)) return 'Accessible toilet'
  if (/LADIES|FEMALE/i.test(roomNo)) return 'Toilets (ladies)'
  if (/GENTS|MALE/i.test(roomNo)) return 'Toilets (gents)'
  return 'Toilet'
}
const types = {toilet: [], lift: []}
gltf.nodes.forEach((node, index) => {
  const m = /^(toilet|lift)_(.+)_(\d{6,})$/.exec(node.name || '')
  if (!m || !out[m[3]]) return
  const [lat, lng, level] = out[m[3]]
  if (level == null) return
  types[m[1]].push([m[3], lat, lng, level, m[1] === 'lift' ? 'Lift' : toiletLabel(m[2]), buildingOf(index)])
})
writeFileSync(TYPES_OUT, JSON.stringify(types))
console.log(`${TYPES_OUT}: ${types.toilet.length} toilets, ${types.lift.length} lifts`)
