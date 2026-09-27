/**
 * Loads every api/ function the way Vercel's Node runtime does: each file transpiled on its
 * own, no bundler, run as an ES module.
 *
 * Under those rules a relative import needs its `.js` extension. Vite and esbuild resolve
 * `./_lib/server` happily, so the build and the tests pass while every Node function on
 * Vercel fails with ERR_MODULE_NOT_FOUND. This is the check that sees what Vercel sees.
 *
 *   node scripts/check-api-imports.mjs
 */

import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const out = join(root, 'node_modules', '.cache', 'api-esm')

const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
const sources = [...walk(join(root, 'api')), ...walk(join(root, 'src', 'lib'))].filter((f) => f.endsWith('.ts'))

// One file in, one file out, imports untouched: what Vercel's per-file compile produces.
await build({ entryPoints: sources, outdir: out, outbase: root, format: 'esm', platform: 'node', bundle: false, logLevel: 'warning' })

let failed = 0
for (const file of walk(join(root, 'api')).filter((f) => f.endsWith('.ts') && !f.includes('_lib'))) {
  const rel = relative(root, file).replace(/\.ts$/, '.js')
  try {
    await import(pathToFileURL(join(out, rel)).href)
    console.log(`✓ ${rel}`)
  } catch (error) {
    failed++
    console.log(`✗ ${rel}\n  ${error.message.split('\n')[0]}`)
  }
}
if (failed) process.exit(1)
