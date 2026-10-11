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

import { adminClient, fail, json, requireEnv, uuidOrNull } from '../_lib/server.js'
import { proUntilFor, validSignature } from '../_lib/billing.js'

interface LemonEvent {
  meta?: { event_name?: unknown; custom_data?: { user_id?: unknown } }
  data?: { id?: unknown; attributes?: { status?: unknown; renews_at?: unknown; ends_at?: unknown } }
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const raw = await req.text()
    if (!(await validSignature(raw, req.headers.get('x-signature') ?? '', requireEnv('LEMONSQUEEZY_WEBHOOK_SECRET')))) {
      return json({ error: 'invalid_signature' }, 400)
    }

    const event = JSON.parse(raw) as LemonEvent
    const name = String(event.meta?.event_name ?? '')
    // Orders, refunds and the rest are Lemon Squeezy's business; access follows the subscription.
    if (!name.startsWith('subscription_')) return json({ ok: true, ignored: name })

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
    const userId = uuidOrNull(event.meta?.custom_data?.user_id)
    const { error } = userId
      ? await db.from('memberships').upsert({ user_id: userId, ...row }, { onConflict: 'user_id' })
      : await db.from('memberships').update(row).eq('ls_subscription_id', row.ls_subscription_id)
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
