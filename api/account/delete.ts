/**
 * Deletes the caller's account: their images in Storage, then the auth user, which cascades
 * to the profile, kits, services, plan and usage rows.
 *
 * Two things refuse it, both because deleting would leave money behind:
 * - a subscription Lemon Squeezy would go on billing: cancel it first, then delete;
 * - Bazaar contracts, which are payment records (`on delete restrict`): those go by email.
 */

import { HttpError, adminClient, fail, json, requireMethod, requireUser } from '../_lib/server.js'

const BUCKET = 'brand-assets'
/** Lemon Squeezy statuses that will charge again. cancelled, expired and unpaid will not. */
export const STILL_BILLING = ['active', 'on_trial', 'past_due', 'paused']

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const db = adminClient()

    const [membership, contracts] = await Promise.all([
      db.from('memberships').select('status').eq('user_id', caller.id).maybeSingle(),
      db.from('bazaar_contracts').select('id', { count: 'exact', head: true }).or(`client_id.eq.${caller.id},freelancer_id.eq.${caller.id}`),
    ])
    if (membership.error) throw membership.error
    if (contracts.error) throw contracts.error
    if (STILL_BILLING.includes(String(membership.data?.status ?? ''))) {
      throw new HttpError(409, 'pro_still_billing', 'Cancel your Pro subscription first, under Manage subscription.')
    }
    if (contracts.count) throw new HttpError(409, 'has_contracts', 'You have Bazaar contracts. Email brandyzerapp@gmail.com to close your account.')

    // Images live under `<user id>/`. Storage lists a page at a time; remove until it is empty.
    for (;;) {
      const { data: files, error } = await db.storage.from(BUCKET).list(caller.id, { limit: 100 })
      if (error) throw error
      if (!files?.length) break
      const { error: removeError } = await db.storage.from(BUCKET).remove(files.map((f) => `${caller.id}/${f.name}`))
      if (removeError) throw removeError
    }

    const { error } = await db.auth.admin.deleteUser(caller.id)
    if (error) throw error
    return json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: Supabase admin calls go through the SDK. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime drops a default export's returned Response; named methods get the Web `Request`. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
