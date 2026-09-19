/**
 * Says whether .env.local is filled in correctly, without printing anything secret.
 *
 * Supabase hands you two keys that look identical — both long, both starting `eyJ` — and one
 * of them bypasses row level security entirely. Putting the wrong one in the wrong slot is
 * the easiest and worst mistake available here, and nothing about the strings themselves
 * tells you which is which.
 *
 * A Supabase key is a JWT, and a JWT's middle segment is base64 JSON carrying `"role"`. That
 * is readable without the signing secret, so this can confirm placement while seeing nothing
 * worth hiding: it prints a verdict and a fingerprint, never a value.
 *
 *   node scripts/check-env.mjs
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PATH = new URL('../.env.local', import.meta.url)

/** Eight hex characters, so two slots holding the same key are visibly the same. */
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 8)

/**
 * The role a key carries, whichever generation it is from.
 *
 * Supabase now issues `sb_publishable_…` and `sb_secret_…` alongside the older JWTs, and a
 * project can hand you a mix of both. The new ones say what they are in the prefix; the old
 * ones say it in the JWT payload, which is base64 JSON and readable without the signature.
 */
function roleOf(token) {
  if (token.startsWith('sb_publishable_')) return 'anon'
  if (token.startsWith('sb_secret_')) return 'service_role'
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role ?? null
  } catch {
    return null
  }
}

let text
try {
  text = readFileSync(PATH, 'utf8')
} catch {
  console.error('No .env.local found. Copy .env.example to .env.local and fill it in.')
  process.exit(1)
}

const env = {}
for (const line of text.split('\n')) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].trim()
}

const problems = []
const notes = []

const url = env.VITE_SUPABASE_URL
if (!url) problems.push('VITE_SUPABASE_URL is empty.')
else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) problems.push(`VITE_SUPABASE_URL does not look like a project URL. Expected https://something.supabase.co`)
if (url && env.SUPABASE_URL !== url) problems.push('SUPABASE_URL must be the same URL as VITE_SUPABASE_URL.')

/** The whole point of this script. */
function expectRole(name, wanted) {
  const token = env[name]
  if (!token) {
    problems.push(`${name} is empty.`)
    return
  }
  const role = roleOf(token)
  if (role === null) {
    problems.push(`${name} is not a Supabase key. Expected either sb_publishable_… / sb_secret_… or a long JWT in three dot-separated parts.`)
    return
  }
  if (role !== wanted) {
    problems.push(`${name} holds the ${role} key, not the ${wanted} one. These look identical and are not interchangeable.`)
    return
  }
  notes.push(`${name.padEnd(28)} ok  ${role.padEnd(13)} #${fingerprint(token)}`)
}

expectRole('VITE_SUPABASE_ANON_KEY', 'anon')
expectRole('SUPABASE_ANON_KEY', 'anon')
expectRole('SUPABASE_SERVICE_ROLE_KEY', 'service_role')

// The failure worth shouting about: the root key in a variable the browser will be given.
for (const [name, value] of Object.entries(env)) {
  if (name.startsWith('VITE_') && value && roleOf(value) === 'service_role') {
    problems.unshift(`${name} holds the service_role key. Anything named VITE_* is compiled into the JavaScript every visitor downloads, so this key would be public. Move it and rotate it in Supabase → Settings → API.`)
  }
}

// Both generations work, but the browser and the functions must present the same identity —
// they read the same rows under the same policies, and two different keys is two different
// stories about who is asking.
if (env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY && env.VITE_SUPABASE_ANON_KEY !== env.SUPABASE_ANON_KEY) {
  problems.push('VITE_SUPABASE_ANON_KEY and SUPABASE_ANON_KEY hold different keys. They should be the same one — copy whichever you prefer into both.')
}

const optional = ['OPENROUTER_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'VITE_STRIPE_PUBLISHABLE_KEY']
const missing = optional.filter((k) => !env[k])

console.log()
for (const note of notes) console.log('  ' + note)
if (url) console.log(`  ${'project'.padEnd(28)} ok  ${url}`)
console.log()

if (problems.length) {
  console.log('Problems:')
  for (const p of problems) console.log('  - ' + p)
  console.log()
  process.exitCode = 1
} else {
  console.log('Supabase is configured correctly.')
  if (missing.length) console.log(`Optional and still empty: ${missing.join(', ')} — the app runs without them.`)
  console.log()
}
