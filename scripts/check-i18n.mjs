/**
 * Fails when the interface asks for a string the dictionary does not have.
 *
 * `t()` falls back to printing the key, which is the right behaviour in production — a gap
 * is visible rather than blank — and the wrong one to discover there. This reads every
 * literal `t('key')` under src/, plus the key families built from a template string, and
 * checks each against src/i18n/ui.ts.
 *
 *   node scripts/check-i18n.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))

const dictionary = readFileSync(join(root, 'src', 'i18n', 'ui.ts'), 'utf8')
const known = new Set([...dictionary.matchAll(/^\s+([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]))

const used = new Map()
for (const file of walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('ui.ts'))) {
  const source = readFileSync(file, 'utf8')
  for (const m of source.matchAll(/\b(?:t|translate)\(\s*'([a-z0-9_]+)'/g)) used.set(m[1], file)
  // `t(cond ? 'a' : 'b')` — both branches are keys.
  for (const m of source.matchAll(/\bt\(\s*[^'()]*\?\s*'([a-z0-9_]+)'\s*:\s*'([a-z0-9_]+)'/g)) {
    used.set(m[1], file)
    used.set(m[2], file)
  }
}

/** Keys assembled at runtime from a prefix and a value. Each list mirrors the type it comes from. */
const families = {
  role_: ['client', 'freelancer', 'both', 'client_note', 'freelancer_note', 'both_note'],
  skin_: ['orbit', 'plain', 'editorial', 'atelier', 'brutal', 'terminal', 'marketplace', 'academy', 'streak', 'cinema', 'poster'].flatMap((s) => [s, `${s}_note`]),
  color_role_: ['primary', 'secondary', 'accent', 'neutral', 'background'],
  status_: ['pending', 'funded', 'in_review', 'completed', 'canceled', 'refunded'].flatMap((s) => [s, `${s}_note`]),
  format_: ['instagram_caption', 'product_description', 'email', 'website_hero', 'google_ad'],
  shape_: ['square', 'portrait', 'landscape'],
  done_: ['deliver', 'request_changes', 'accept'],
  '': ['light', 'dark', 'system', 'how_it_works_kit', 'how_it_works_create', 'how_it_works_hire'],
}
for (const [prefix, values] of Object.entries(families)) for (const v of values) used.set(prefix + v, '(template)')

const missing = [...used].filter(([key]) => !known.has(key))
if (missing.length) {
  console.log(`✗ ${missing.length} interface string(s) missing from src/i18n/ui.ts:`)
  for (const [key, file] of missing) console.log(`  ${key}  ← ${file.replace(root, '')}`)
  process.exit(1)
}
console.log(`✓ ${used.size} interface strings, all in the dictionary`)
