/**
 * Refreshes what Stripe says about a freelancer's connected account.
 *
 * Whether transfers are active is asked of Stripe rather than remembered, because it changes
 * without telling us: a document expires, a verification stalls, and an account that could
 * be paid on Monday cannot on Tuesday. The cached copy on the profile exists so the directory
 * can show who is taking work; this route, the thin-event receiver, and the hire route itself
 * are what keep it honest.
 */

import { adminClient, fail, json, requireMethod, requireUser } from '../_lib/server.js'
import { retrieveRecipient } from '../_lib/stripe.js'

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST')
    const caller = await requireUser(req)
    const db = adminClient()

    const { data: profile } = await db.from('profiles').select('stripe_connect_id').eq('id', caller.id).single()
    if (!profile?.stripe_connect_id) return json({ connected: false, transfersActive: false, status: 'unrequested', requirements: [] })

    const state = await retrieveRecipient(profile.stripe_connect_id)
    await db.from('profiles').update({ stripe_transfers_active: state.transfersActive }).eq('id', caller.id)

    return json({ connected: true, ...state })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
