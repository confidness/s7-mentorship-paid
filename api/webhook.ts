/**
 * Stripe's webhook. The only thing in this codebase that grants an entitlement.
 *
 * Everything else may read whether a student owns a lesson; nothing else may decide it.
 * That is why the RLS policies carry no insert rule for entitlements at all: this route
 * uses the service role, and a leaked anon key still cannot mint access to paid content.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *  1. Signature verification runs against the RAW body. Parsing the JSON first — which most
 *     frameworks do by default — re-serializes it, the bytes no longer match what Stripe
 *     signed, and every event fails. Hence `req.text()` and never `req.json()`.
 *
 *  2. Redelivery is normal. Stripe retries until it gets a 2xx, and the same event will
 *     arrive more than once. Every write here is idempotent, keyed on the session id, so
 *     the second delivery changes nothing rather than granting a duplicate entitlement or
 *     double-counting the day's revenue.
 */

import type Stripe from 'stripe'
import { adminClient, fail, json, requireEnv } from './_lib/server'
import { stripe } from './_lib/stripe'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const signature = req.headers.get('stripe-signature')
  if (!signature) return json({ error: 'missing_signature' }, 400)

  let event: Stripe.Event
  try {
    const raw = await req.text()
    event = await stripe().webhooks.constructEventAsync(raw, signature, requireEnv('STRIPE_WEBHOOK_SECRET'))
  } catch (error) {
    // An unverified body is not a payment notice, it is an anonymous POST. Nothing is read
    // out of it and nothing is written.
    console.error('stripe signature verification failed:', error instanceof Error ? error.message : error)
    return json({ error: 'invalid_signature' }, 400)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await grantFromSession(event.data.object)
        break

      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await markFailed(event.data.object)
        break

      case 'charge.refunded':
        await markRefunded(event.data.object)
        break

      case 'account.updated':
        await syncAccount(event.data.object)
        break

      default:
        // Unhandled types are acknowledged, not retried: returning an error would make
        // Stripe redeliver an event we will never act on.
        break
    }
    return json({ received: true })
  } catch (error) {
    // A 500 asks Stripe to try again, which is what we want for a transient database fault:
    // the retry is safe precisely because these writes are idempotent.
    return fail(error)
  }
}

/**
 * Records payment and grants access.
 *
 * Only on a paid session. `checkout.session.completed` also fires for asynchronous methods
 * that have not settled yet, and granting on those would hand over content before the money
 * exists — the async_payment_succeeded event is what closes that case.
 */
async function grantFromSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return

  const db = adminClient()
  const lessonId = session.metadata?.lessonId
  const studentId = session.metadata?.studentId
  if (!lessonId || !studentId) {
    console.error('checkout session without metadata:', session.id)
    return
  }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)

  // Keyed on the session id, which is unique in our schema. A redelivery updates the same
  // row to the same values instead of inserting a second order.
  const { data: order, error: orderError } = await db
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent: paymentIntent })
    .eq('stripe_session_id', session.id)
    .select('id, student_id, lesson_id')
    .maybeSingle()
  if (orderError) throw orderError

  // The order row is normally written at checkout. If it is missing — a session created
  // outside the usual path, or a lost write — the payment still happened, so reconstruct it
  // rather than dropping a paid customer on the floor.
  let orderId = order?.id ?? null
  if (!orderId) {
    const { data: rebuilt, error: rebuildError } = await db
      .from('orders')
      .insert({
        stripe_session_id: session.id,
        stripe_payment_intent: paymentIntent,
        student_id: studentId,
        lesson_id: lessonId,
        amount_cents: session.amount_total ?? 0,
        platform_fee_cents: Number(session.metadata?.platformFeeCents ?? 0),
        currency: session.currency ?? 'usd',
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (rebuildError) throw rebuildError
    orderId = rebuilt.id
  }

  // The grant itself. onConflict makes the second delivery a no-op rather than an error.
  const { error: grantError } = await db
    .from('entitlements')
    .upsert({ student_id: order?.student_id ?? studentId, lesson_id: order?.lesson_id ?? lessonId, order_id: orderId }, { onConflict: 'student_id,lesson_id', ignoreDuplicates: true })
  if (grantError) throw grantError
}

async function markFailed(session: Stripe.Checkout.Session) {
  const db = adminClient()
  // Only a pending order moves to failed: an expired-session event arriving after a
  // successful payment must not undo a sale.
  const { error } = await db.from('orders').update({ status: 'failed' }).eq('stripe_session_id', session.id).eq('status', 'pending')
  if (error) throw error
}

/**
 * A refund marks the order and withdraws access.
 *
 * Leaving the entitlement in place would mean paid content stays unlocked after the money
 * has gone back, which is the refund-abuse path.
 */
async function markRefunded(charge: Stripe.Charge) {
  const db = adminClient()
  const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntent) return

  const { data: order, error } = await db
    .from('orders')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent', paymentIntent)
    .select('id, student_id, lesson_id')
    .maybeSingle()
  if (error) throw error
  if (!order) return

  const { error: revokeError } = await db.from('entitlements').delete().eq('student_id', order.student_id).eq('lesson_id', order.lesson_id)
  if (revokeError) throw revokeError
}

/** Keeps the cached charges_enabled honest without waiting for the mentor to reload a page. */
async function syncAccount(account: Stripe.Account) {
  const db = adminClient()
  const { error } = await db
    .from('mentor_accounts')
    .update({ charges_enabled: Boolean(account.charges_enabled), payouts_enabled: Boolean(account.payouts_enabled), updated_at: new Date().toISOString() })
    .eq('stripe_account_id', account.id)
  if (error) throw error
}

/**
 * Runs on the Node runtime, which the Stripe and Supabase SDKs need.
 *
 * The handler takes a Web `Request` and calls `req.text()`, so it receives the exact bytes
 * Stripe signed and never a re-serialised copy — which is the usual cause of "every webhook
 * fails in production". `constructEventAsync` is used rather than `constructEvent` because
 * verification goes through Web Crypto, which is async.
 */
export const config = { runtime: 'nodejs' }
