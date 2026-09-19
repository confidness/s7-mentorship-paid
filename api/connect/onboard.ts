/**
 * Stripe Connect onboarding for an approved mentor.
 *
 * Express accounts, so Stripe collects the tax and identity details and carries the KYC
 * obligation. We never see a bank number; we hold an account id and whether Stripe is
 * willing to accept charges for it.
 *
 * POST returns a link to send the mentor to. Links are single-use and expire in minutes,
 * so this is called again each time rather than stored.
 */

import { HttpError, adminClient, fail, json, requireMethod, requireUser } from '../_lib/server'
import { siteOrigin, stripe } from '../_lib/stripe'

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const db = adminClient()

    // Approval first. Onboarding an unreviewed account would put a payout destination
    // behind someone no one has checked.
    const { data: application } = await db.from('mentor_applications').select('status').eq('user_id', caller.id).eq('status', 'approved').maybeSingle()
    if (!application) throw new HttpError(403, 'not_approved', 'Your mentor application has not been approved yet.')

    const { data: existing } = await db.from('mentor_accounts').select('stripe_account_id').eq('user_id', caller.id).maybeSingle()

    let accountId = existing?.stripe_account_id
    if (!accountId) {
      const account = await stripe().accounts.create({
        type: 'express',
        email: caller.email,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Robotics lessons on the S7 Robotics Platform' },
        metadata: { userId: caller.id },
      })
      accountId = account.id
      const { error } = await db.from('mentor_accounts').insert({ user_id: caller.id, stripe_account_id: accountId })
      if (error) throw new HttpError(500, 'write_failed', error.message)
    }

    const origin = siteOrigin(req)
    const link = await stripe().accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      // Stripe sends people back here when a link has gone stale; the page asks for a fresh one.
      refresh_url: `${origin}/m/payouts?refresh=1`,
      return_url: `${origin}/m/payouts?done=1`,
    })

    return json({ url: link.url })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
