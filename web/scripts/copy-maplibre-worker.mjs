#!/usr/bin/env node
/**
 * MapLibre 6 loads its web worker from a separate file next to the library.
 * Bundlers do not copy it, so we serve it from public/ instead.
 * Runs on install, dev and build so the worker always matches the installed library version.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor');
mkdirSync(outDir, { recursive: true });
copyFileSync(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), join(outDir, 'maplibre-gl-worker.mjs'));
console.log('copied maplibre-gl-worker.mjs to public/vendor');
