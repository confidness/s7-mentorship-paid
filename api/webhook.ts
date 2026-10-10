/**
 * Stripe's webhook. The only thing in this codebase that funds, cancels or refunds a contract.
 *
 * Everything else may read whether a contract is paid for; nothing else may decide it. And
 * because the brand kit read rule keys on `funded`, this is also, at one remove, the only
 * thing that can open a client's kit to a freelancer.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *  1. Signature verification runs against the RAW body. Parsing the JSON first re-serializes
 *     it, the bytes no longer match what Stripe signed, and every event fails. Hence
 *     `req.text()` and never `req.json()`.
 *
 *  2. Redelivery is normal. Stripe retries until it gets a 2xx, and the same event will
 *     arrive more than once. Every write here is conditional on the status it expects, so the
 *     second delivery matches no row and changes nothing.
 *
 * Connected-account updates do not come here. Accounts v2 announces them as thin events on
 * their own destination, with their own secret — see api/connect/events.ts.
 */

import type Stripe from 'stripe'
import { adminClient, fail, json, requireEnv } from './_lib/server.js'
import { stripe } from './_lib/stripe.js'

async function handler(req: Request): Promise<Response> {
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
        await fund(event.data.object)
        break

      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await cancel(event.data.object)
        break

      case 'charge.refunded':
        await refund(event.data.object)
        break

      default:
        // Acknowledged, not retried: an error would make Stripe redeliver an event we will
        // never act on.
        break
    }
    return json({ received: true })
  } catch (error) {
    // A 500 asks Stripe to try again, which is what we want for a transient database fault:
    // the retry is safe precisely because these writes are conditional.
    return fail(error)
  }
}

const contractOf = (session: Stripe.Checkout.Session) => session.metadata?.contractId ?? session.client_reference_id ?? null

/**
 * The money arrived: the contract is funded, and the brand kit opens to the freelancer.
 *
 * Only when paid. `checkout.session.completed` also fires for a bank debit that has not
 * settled, with payment_status `unpaid`; funding on that would start work on money that may
 * never exist. `async_payment_succeeded` is the event that closes that case.
 */
async function fund(session: Stripe.Checkout.Session) {
  if (session.payment_status === 'unpaid') return
  const contractId = contractOf(session)
  if (!contractId) {
    console.error('checkout session without a contract:', session.id)
    return
  }
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)

  // `canceled` too: a contract retired by an expired or failed session, whose payment Stripe
  // then confirms after all, has money behind it and must be funded rather than stranded.
  const db = adminClient()
  const { data, error } = await db
    .from('bazaar_contracts')
    .update({ status: 'funded', funded_at: new Date().toISOString(), stripe_payment_intent_id: paymentIntent, stripe_checkout_session_id: session.id })
    .eq('id', contractId)
    .in('status', ['pending', 'canceled'])
    .select('id, total_amount_cents')
    .maybeSingle()
  if (error) throw error

  // No row is normally a redelivery of an event already applied. Anything else is money with
  // no contract to show for it, and is said out loud.
  if (!data) {
    const { data: current } = await db.from('bazaar_contracts').select('status').eq('id', contractId).maybeSingle()
    if (!current || !['funded', 'in_review', 'completed'].includes(current.status)) {
      console.error('paid session matched no fundable contract:', session.id, contractId, current?.status ?? 'missing')
    }
    return
  }

  // An amount that disagrees is never usual, and is worth a line in the logs before anybody's
  // books are reconciled.
  if (data && session.amount_total !== null && session.amount_total !== data.total_amount_cents) {
    console.error('funded amount differs from contract:', contractId, session.amount_total, data.total_amount_cents)
  }
}

/** Expired or failed before any money moved. A funded contract is never touched by this. */
async function cancel(session: Stripe.Checkout.Session) {
  const contractId = contractOf(session)
  if (!contractId) return
  const { error } = await adminClient().from('bazaar_contracts').update({ status: 'canceled' }).eq('id', contractId).eq('status', 'pending')
  if (error) throw error
}

/**
 * A full refund ends the contract, and with it the freelancer's access to the brand kit.
 *
 * Partial refunds leave the contract as it is — a discount for a late delivery is not the end
 * of the job. Note that with destination charges a refund comes out of Brandyzer's balance
 * unless it is made with "reverse transfer", which pulls the freelancer's share back too;
 * refunding from the Dashboard asks, and the answer is a business decision, not code.
 */
async function refund(charge: Stripe.Charge) {
  if (!charge.refunded) return
  const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntent) return
  const { error } = await adminClient()
    .from('bazaar_contracts')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', paymentIntent)
    .in('status', ['funded', 'in_review', 'completed'])
  if (error) throw error
}

/**
 * Runs on the Node runtime, which the Stripe and Supabase SDKs need. `constructEventAsync`
 * because verification goes through Web Crypto, which is async.
 */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
