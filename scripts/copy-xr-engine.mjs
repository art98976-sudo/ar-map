// Copies the 8th Wall engine binary from node_modules into public/external/xr,
// so Vite serves it at /external/xr/xr.js in dev and copies it into dist on build.
//
// Licence: the engine must be shipped exactly as distributed (no edits, no bundling),
// with its LICENSE file and copyright notice. We copy files byte-for-byte.
// We skip the face-tracking and sky-segmentation files: this app never loads them,
// and they would add about 14 MB to every deploy.
import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@8thwall', 'engine-binary', 'dist')
const dest = join(root, 'public', 'external', 'xr')

const SKIP = /^(xr-face\.js|face-.*\.tflite|semantics-.*)$/

if (!existsSync(src)) {
  console.warn('[copy-xr-engine] @8thwall/engine-binary is not installed yet, skipping.')
} else {
  rmSync(dest, {recursive: true, force: true})
  mkdirSync(dest, {recursive: true})
  cpSync(src, dest, {recursive: true, filter: (path) => !SKIP.test(basename(path))})
  console.log('[copy-xr-engine] 8th Wall engine copied to public/external/xr')
}
