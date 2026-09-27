/**
 * Stripe Connect onboarding for a mentor who wants to be paid.
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

    /**
     * No approval check. There is nothing left to approve.
     *
     * This required an approved `mentor_applications` row, which made sense while a reviewer
     * decided who could teach. Migration 0006 removed the application desk and nothing
     * writes such a row any more, so the check could never pass: no application, no Connect
     * account, `charges_enabled` never true, and `requireSellingMentor` therefore refused
     * every paid publish. The gate outlived the thing it was gating and quietly closed the
     * whole marketplace.
     *
     * Identity is still checked, just not by us: an Express account cannot take money until
     * Stripe has completed its own KYC on the person behind it.
     */
    const { data: existing } = await db.from('mentor_accounts').select('stripe_account_id').eq('user_id', caller.id).maybeSingle()

    let accountId = existing?.stripe_account_id
    if (!accountId) {
      const account = await stripe().accounts.create({
        type: 'express',
        email: caller.email,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Mentorship and lessons on S7 Mentorship' },
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
