/**
 * Is the deployment up, and can it reach its database?
 *
 * GET  200 { ok: true, db: 'ok' | 'unconfigured', time }
 *      503 { ok: false, db: 'down', time }
 *
 * For an uptime monitor, which wants one URL and a status code and nothing else.
 *
 * GET ?payments=1  200 / 501 { ok, configured, checkout, webhook }
 *
 * Whether Stripe is wired up, for Settings → Server features. This used to be its own function,
 * `api/payments-health.ts`; it lives here because a Vercel Hobby deployment is allowed twelve
 * functions and a thirteenth fails every deploy. It reads two variables and names neither.
 *
 * It asks as nobody: the anon key and no session. Every policy in the schema is written for
 * `authenticated`, so row level security shows the anon role no rows at all — the query
 * proves PostgREST and Postgres answer, and there is nothing it could return even if the
 * reply were passed on, which it is not. The service role stays out of it: a route anyone on
 * the internet can call is the last place to hold the key that bypasses RLS.
 *
 * Unconfigured is a 200, not a failure. Without Supabase the app runs fully local by design,
 * and a monitor watching such a deployment should not page anybody over it.
 */

import { createClient } from '@supabase/supabase-js'
import { env, fail, json, requireMethod } from './_lib/server.js'

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET')
    if (new URL(req.url).searchParams.has('payments')) return payments()
    const time = new Date().toISOString()
    const url = env('SUPABASE_URL')
    const anonKey = env('SUPABASE_ANON_KEY')
    if (!url || !anonKey) return json({ ok: true, db: 'unconfigured', time })

    try {
      const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      // HEAD for at most one id, with no count: no body comes back and Postgres does the least
      // work that still proves it is there. Three seconds, because a health check that hangs
      // until the platform kills it has not answered the question.
      const { error } = await db.from('custom_lessons').select('id', { head: true }).limit(1).abortSignal(AbortSignal.timeout(3000))
      if (error) throw new Error(error.message)
    } catch (error) {
      // The message can name a host or a table; it goes to the log, never to the caller.
      console.error('health: database check failed:', error instanceof Error ? error.message : error)
      return json({ ok: false, db: 'down', time }, 503)
    }

    return json({ ok: true, db: 'ok', time })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Reports whether payments are configured. Names no secret and returns no value from one —
 * ServerStatus only needs to know whether a key is present.
 */
function payments(): Response {
  const checkout = Boolean(env('STRIPE_SECRET_KEY'))
  const webhook = Boolean(env('STRIPE_WEBHOOK_SECRET'))
  const configured = checkout && webhook
  // Which half is missing is the useful part when this is red.
  return json({ ok: configured, configured, checkout, webhook }, configured ? 200 : 501)
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
