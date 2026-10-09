/**
 * Stripe Connect onboarding for a freelancer who wants to be paid.
 *
 * An Accounts v2 recipient with the Express dashboard, so Stripe collects the identity, tax
 * and bank details and carries the KYC obligation. We never see a bank number; we hold an
 * account id and whether Stripe will transfer money to it.
 *
 * POST returns a link to send the freelancer to. Account links are single-use and expire in
 * minutes, so this is called again each time rather than stored.
 */

import { sells } from '../../src/lib/bazaar.js'
import { HttpError, adminClient, fail, json, requireMethod, requireUser } from '../_lib/server.js'
import { createRecipientAccount, siteOrigin, stripe } from '../_lib/stripe.js'

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const db = adminClient()

    const { data: profile } = await db.from('profiles').select('name, role, stripe_connect_id').eq('id', caller.id).single()
    // A client has nothing to be paid for. Switching role is one click in settings, and
    // asking for it first keeps the directory and the payout accounts telling one story.
    if (!sells(profile?.role)) throw new HttpError(403, 'not_a_freelancer', 'Switch your account to freelancer in Settings first.')

    let accountId: string | null = profile?.stripe_connect_id ?? null
    if (!accountId) {
      const account = await createRecipientAccount({ email: caller.email, name: profile?.name ?? 'Freelancer', userId: caller.id })
      // Written only if still empty: two tabs onboarding at once must not leave the profile
      // pointing at the account that loses. The loser is re-read rather than trusted.
      const { data: claimed } = await db.from('profiles').update({ stripe_connect_id: account.id }).eq('id', caller.id).is('stripe_connect_id', null).select('stripe_connect_id').maybeSingle()
      if (claimed) accountId = account.id
      else {
        const { data: again } = await db.from('profiles').select('stripe_connect_id').eq('id', caller.id).single()
        accountId = again?.stripe_connect_id ?? null
      }
      if (!accountId) throw new HttpError(500, 'write_failed', 'Could not record the payout account.')
    }

    const origin = siteOrigin(req)
    const link = await stripe().v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          // Stripe sends people back here when a link has gone stale; the page asks for a fresh one.
          refresh_url: `${origin}/sell/payouts?refresh=1`,
          return_url: `${origin}/sell/payouts?done=1`,
        },
      },
    })

    return json({ url: link.url })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
