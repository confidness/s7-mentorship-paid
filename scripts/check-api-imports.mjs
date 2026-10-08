/**
 * Loads every api/ function the way Vercel's Node runtime does: each file transpiled on its
 * own, no bundler, run as an ES module.
 *
 * Under those rules a relative import needs its `.js` extension. Vite and esbuild resolve
 * `./_lib/server` happily, so the build and the tests pass while every Node function on
 * Vercel fails with ERR_MODULE_NOT_FOUND. And a Node function must export named methods:
 * a default export is called as (req, res). This is the check that sees what Vercel sees.
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
    const mod = await import(pathToFileURL(join(out, rel)).href)
    // A default export on the Node runtime is called as (req, res) and its Response dropped.
    if (mod.config?.runtime === 'nodejs' && typeof mod.GET !== 'function' && typeof mod.POST !== 'function') {
      throw new Error('Node function exports no named HTTP method (GET/POST/...), so Vercel will call it as (req, res)')
    }
    console.log(`✓ ${rel}`)
  } catch (error) {
    failed++
    console.log(`✗ ${rel}\n  ${error.message.split('\n')[0]}`)
  }
}
// Vercel Hobby deploys at most twelve functions, and a thirteenth fails the whole deploy with
// an error that names no file. Every .ts under api/ outside _lib/ is one function.
const LIMIT = 12
const functions = walk(join(root, 'api')).filter((f) => f.endsWith('.ts') && !f.includes('_lib')).length
if (functions > LIMIT) {
  failed++
  console.log(`✗ ${functions} functions under api/, over the ${LIMIT} a Vercel Hobby deployment allows. Fold one into an existing route.`)
} else {
  console.log(`✓ ${functions} of ${LIMIT} functions`)
}
if (failed) process.exit(1)
