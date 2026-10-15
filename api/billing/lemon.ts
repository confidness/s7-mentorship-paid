/**
 * Lemon Squeezy's webhook. The only thing in this codebase that makes somebody Pro.
 *
 * Every subscription_* event carries the subscription's current status and dates, so each one
 * is handled the same way: work out until when its owner is Pro, and write that. Redelivery
 * writes the same row again, which changes nothing.
 *
 * Who the subscription belongs to is the user id the checkout link carried in
 * checkout[custom][user_id]; Lemon Squeezy returns it in meta.custom_data on every event. An
 * event without one is matched by the subscription id it was first recorded under.
 *
 * The signature is checked against the RAW body, before anything is read out of it. An
 * unsigned body is an anonymous POST, not a payment.
 */

declare const process: { env: Record<string, string | undefined> }

import { adminClient, fail, json, requireEnv, requireUser, uuidOrNull } from '../_lib/server.js'
import { checkoutToken, proUntilFor, validCheckoutToken, validSignature } from '../_lib/billing.js'

interface LemonEvent {
  meta?: { event_name?: unknown; custom_data?: { user_id?: unknown; token?: unknown } }
  data?: { type?: unknown; id?: unknown; attributes?: { status?: unknown; renews_at?: unknown; ends_at?: unknown } }
}

/**
 * GET: the Pro checkout link for the signed-in caller, with their id signed into it.
 *
 * Served from this function rather than a route of its own because the project is at Vercel
 * Hobby's twelve-function limit, and it shares the one secret that matters with the webhook.
 */
async function checkoutLink(req: Request): Promise<Response> {
  try {
    const caller = await requireUser(req)
    const base = process.env.VITE_LEMONSQUEEZY_CHECKOUT_URL?.trim()
    if (!base) return json({ url: null })
    const url = new URL(base)
    url.searchParams.set('checkout[custom][user_id]', caller.id)
    url.searchParams.set('checkout[custom][token]', await checkoutToken(caller.id, requireEnv('LEMONSQUEEZY_WEBHOOK_SECRET')))
    if (caller.email) url.searchParams.set('checkout[email]', caller.email)
    return json({ url: url.toString() })
  } catch (error) {
    return fail(error)
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return checkoutLink(req)
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const raw = await req.text()
    if (!(await validSignature(raw, req.headers.get('x-signature') ?? '', requireEnv('LEMONSQUEEZY_WEBHOOK_SECRET')))) {
      return json({ error: 'invalid_signature' }, 400)
    }

    const event = JSON.parse(raw) as LemonEvent
    const name = String(event.meta?.event_name ?? '')
    // Access follows the subscription object alone. Orders are Lemon Squeezy's business, and the
    // subscription_payment_* events carry an invoice, whose "paid" would read as no Pro at all.
    if (event.data?.type !== 'subscriptions') return json({ ok: true, ignored: name })

    const attributes = event.data?.attributes ?? {}
    const status = String(attributes.status ?? '')
    const row = {
      status,
      pro_until: proUntilFor(status, attributes.renews_at, attributes.ends_at),
      ls_subscription_id: String(event.data?.id ?? ''),
      updated_at: new Date().toISOString(),
    }

    // ponytail: last delivery wins. Lemon Squeezy sends these in order in practice; if two ever
    // cross, the next subscription_updated puts the row right.
    const db = adminClient()
    // The id is trusted only with the signature this server put beside it (see checkoutToken).
    // Without one the event can still move the row it already owns, by subscription id, but it
    // cannot claim anybody's membership.
    const claimed = uuidOrNull(event.meta?.custom_data?.user_id)
    const signed = claimed !== null && (await validCheckoutToken(claimed, String(event.meta?.custom_data?.token ?? ''), requireEnv('LEMONSQUEEZY_WEBHOOK_SECRET')))
    if (claimed && !signed) console.warn('[lemon] unsigned user_id ignored for subscription', row.ls_subscription_id)
    const { error } = signed
      ? await db.from('memberships').upsert({ user_id: claimed, ...row }, { onConflict: 'user_id' })
      : await db.from('memberships').update(row).eq('ls_subscription_id', row.ls_subscription_id)
    // A subscription id already held by another row will never write, however often it is
    // retried. Acknowledged and logged, so Lemon Squeezy stops redelivering it.
    if (error?.code === '23505') {
      console.error('[lemon] subscription conflicts with another membership:', row.ls_subscription_id, claimed)
      return json({ ok: true, conflict: true })
    }
    if (error) throw error

    return json({ ok: true })
  } catch (error) {
    // A 500 makes Lemon Squeezy retry, which is what a failed write needs.
    return fail(error)
  }
}

/** Node runtime: Supabase writes go through the SDK. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
