// Phase 2 spike: make 8th Wall image-target data from a photo or artwork, with the official
// generator's own code (@8thwall/image-target-cli, MIT), without its prompts. Not a dependency:
//   npm i --no-save @8thwall/image-target-cli
//   node tools/make-image-target.mjs <image> <out folder> <name> [rotated]
// "rotated" for a landscape sign: 8th Wall targets are 3:4 portrait, so a landscape crop is turned.
// Writes <name>.json (imagePath "image-targets/<name>_luminance.<ext>") and the images beside it.
import sharp from 'sharp'
import {applyCrop} from '@8thwall/image-target-cli/src/apply.js'
import {getDefaultCrop} from '@8thwall/image-target-cli/src/crop.js'

const [, , input, folder, name, rotated] = process.argv
if (!input || !folder || !name) {
  console.error('usage: node tools/make-image-target.mjs <image> <out folder> <name> [rotated]')
  process.exit(1)
}
const image = sharp(input)
const geometry = getDefaultCrop(await image.metadata(), rotated === 'rotated')
const {dataPath} = await applyCrop(image, {type: 'PLANAR', geometry}, folder, name, true)
console.log(name, JSON.stringify(geometry), dataPath)
