/**
 * Which server features are configured. Names no secret and returns no value from one —
 * whether a key is present, which models and providers will be tried, nothing more.
 *
 * Anything other than JSON coming back from here means the functions are not deployed at
 * all, usually a rewrite swallowing /api/ and answering with the page instead.
 */

declare const process: { env: Record<string, string | undefined> }

import { textKey, textModels } from './_lib/text.js'
import { imageProviders } from './_lib/images.js'
import { requireUser } from './_lib/server.js'

async function handler(req: Request): Promise<Response> {
  // Anonymous callers learn only that the functions are up. Which models, providers and
  // webhooks are wired is for signed-in members (Settings shows it), not for reconnaissance.
  const signedIn = await requireUser(req).then(
    () => true,
    () => false,
  )
  if (!signedIn) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

  const stripeKey = Boolean(process.env.STRIPE_SECRET_KEY)
  const body = {
    ok: true,
    text: { configured: Boolean(textKey()), models: textModels() },
    images: { providers: imageProviders().map((p) => p.name) },
    payments: {
      configured: stripeKey && Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      checkout: stripeKey,
      webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      connectEvents: Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
    },
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

/**
 * Node, like every other route. It only reads the environment, but its imports reach
 * server.ts and the Supabase SDK, and one runtime for every function is one less thing to
 * be surprised by.
 */
export const config = { runtime: 'nodejs' }

export { handler as GET }
