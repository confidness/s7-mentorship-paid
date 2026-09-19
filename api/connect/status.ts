/**
 * Refreshes what Stripe says about a mentor's connected account.
 *
 * charges_enabled is asked of Stripe rather than remembered, because it changes without
 * telling us: a document expires, a verification stalls, and an account that could take
 * money on Monday cannot on Tuesday. The cached copy in mentor_accounts exists so the
 * checkout path has something fast to read; this route is what keeps it honest.
 */

import { adminClient, fail, json, requireMethod, requireUser } from '../_lib/server'
import { stripe } from '../_lib/stripe'

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST')
    const caller = await requireUser(req)
    const db = adminClient()

    const { data: account } = await db.from('mentor_accounts').select('stripe_account_id').eq('user_id', caller.id).maybeSingle()
    if (!account?.stripe_account_id) return json({ connected: false, chargesEnabled: false, payoutsEnabled: false })

    const live = await stripe().accounts.retrieve(account.stripe_account_id)
    const chargesEnabled = Boolean(live.charges_enabled)
    const payoutsEnabled = Boolean(live.payouts_enabled)

    await db
      .from('mentor_accounts')
      .update({ charges_enabled: chargesEnabled, payouts_enabled: payoutsEnabled, updated_at: new Date().toISOString() })
      .eq('user_id', caller.id)

    return json({
      connected: true,
      chargesEnabled,
      payoutsEnabled,
      // What Stripe is still waiting for, so the mentor sees a reason rather than a red light.
      requirements: live.requirements?.currently_due ?? [],
    })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
