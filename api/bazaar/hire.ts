/**
 * Hires a freelancer: one service, one contract, one Stripe Checkout Session.
 *
 * The money moves as a destination charge. Brandyzer is the merchant of record and runs the
 * checkout; Stripe transfers the payment to the freelancer's connected account the moment it
 * succeeds, minus `application_fee_amount`, which is Brandyzer's 5%. That is the PaymentIntent
 * the spec describes — Checkout creates it from `payment_intent_data` — with Stripe's hosted
 * page doing card entry, wallets, 3-D Secure and receipts, none of which this codebase then
 * has to build or keep compliant.
 *
 * Three rules this route will not bend:
 *
 *   The price is read from the database. The body names a service; it never names an amount.
 *   A client who could post their own price would hire a 500-dollar logo for a dollar.
 *
 *   Stripe is asked, now, whether the freelancer can receive money. The cached flag on their
 *   profile is for the directory; a verification that lapsed this morning is Stripe's news.
 *
 *   Nothing is granted here. The contract is written as pending; the webhook funds it after
 *   Stripe confirms the money arrived, and only then does the brand kit open to the freelancer.
 */

import { decideHire, sells, splitPayment } from '../../src/lib/bazaar.js'
import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser, str, uuidOrNull, type Caller } from '../_lib/server.js'
import { HIRE_INTEGRATION_ID, retrieveRecipient, siteOrigin, stripe } from '../_lib/stripe.js'

interface Body {
  serviceId?: unknown
  brandKitId?: unknown
  brief?: unknown
}

/**
 * The client's Stripe customer, created on their first hire and reused after.
 *
 * The `is null` guard means the profile keeps whichever id it was given first, and the loser
 * of a race is re-read rather than used. No idempotency key: it would bind the name too, and
 * a retry after a rename would be refused for a day. Two simultaneous first hires costing one
 * spare, unused customer is the cheaper failure.
 */
async function ensureCustomer(caller: Caller): Promise<string> {
  const db = adminClient()
  const { data: me } = await db.from('profiles').select('name, stripe_customer_id').eq('id', caller.id).single()
  if (me?.stripe_customer_id) return me.stripe_customer_id

  const customer = await stripe().customers.create({ email: caller.email, name: me?.name ?? undefined, metadata: { userId: caller.id } })
  const { data: claimed } = await db.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', caller.id).is('stripe_customer_id', null).select('stripe_customer_id').maybeSingle()
  if (claimed) return customer.id
  const { data: again } = await db.from('profiles').select('stripe_customer_id').eq('id', caller.id).single()
  return again?.stripe_customer_id ?? customer.id
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const body = await readJson<Body>(req)

    const serviceId = uuidOrNull(body.serviceId)
    if (!serviceId) throw new HttpError(400, 'invalid_input', 'Which service?')
    const namedKit = body.brandKitId !== undefined && body.brandKitId !== null && body.brandKitId !== ''
    const kitId = namedKit ? uuidOrNull(body.brandKitId) : null
    if (namedKit && !kitId) throw new HttpError(400, 'invalid_input', 'That is not a brand kit id.')
    const brief = str(body.brief, 4000)

    const db = adminClient()
    const { data: service, error: serviceError } = await db
      .from('bazaar_services')
      .select('id, freelancer_id, title, description, price_usd_cents, delivery_days, active')
      .eq('id', serviceId)
      .maybeSingle()
    if (serviceError) throw new HttpError(500, 'read_failed', serviceError.message)

    let kitOwnerId: string | null | undefined
    if (kitId) {
      const { data: kit } = await db.from('brand_kits').select('user_id').eq('id', kitId).maybeSingle()
      kitOwnerId = kit?.user_id ?? null
    }

    const { data: freelancer } = service ? await db.from('profiles').select('stripe_connect_id, role').eq('id', service.freelancer_id).single() : { data: null }
    const facts = {
      callerId: caller.id,
      service: service ? { active: service.active, freelancerId: service.freelancer_id } : null,
      kitOwnerId,
      freelancerSells: sells(freelancer?.role),
    }
    // Everything that can be refused without asking Stripe is refused first.
    const early = decideHire({ ...facts, freelancerCanReceive: true })
    if (!early.ok) throw new HttpError(early.status, early.code, early.message)

    let canReceive = false
    if (freelancer?.stripe_connect_id) {
      const state = await retrieveRecipient(freelancer.stripe_connect_id)
      canReceive = state.transfersActive
      // Keep the directory's copy honest while we are holding the answer.
      await db.from('profiles').update({ stripe_transfers_active: canReceive }).eq('id', service!.freelancer_id)
    }
    const verdict = decideHire({ ...facts, freelancerCanReceive: canReceive })
    if (!verdict.ok) throw new HttpError(verdict.status, verdict.code, verdict.message)

    const svc = service!
    const split = splitPayment(svc.price_usd_cents)

    /**
     * One open checkout per client per service. A second tab, or the back button and a second
     * click, gets the checkout already open rather than a new one — two open sessions for one
     * job can both be paid. A session Stripe has closed unpaid is retired so a fresh one can
     * start; one already paid is waiting on the webhook and must not be sold again.
     */
    const { data: open } = await db.from('bazaar_contracts').select('id, stripe_checkout_session_id').eq('client_id', caller.id).eq('service_id', svc.id).eq('status', 'pending').maybeSingle()
    if (open) {
      const existing = open.stripe_checkout_session_id ? await stripe().checkout.sessions.retrieve(open.stripe_checkout_session_id).catch(() => null) : null
      if (existing?.status === 'open' && existing.url) return json({ url: existing.url, contractId: open.id, split, resumed: true })
      if (existing?.status === 'complete') throw new HttpError(409, 'payment_confirming', 'Your payment for this service is being confirmed. Check your contracts in a minute.')
      await db.from('bazaar_contracts').update({ status: 'canceled' }).eq('id', open.id).eq('status', 'pending')
    }

    const customer = await ensureCustomer(caller)

    // The contract first, so its id can name everything Stripe creates for it.
    const { data: contract, error: contractError } = await db
      .from('bazaar_contracts')
      .insert({
        client_id: caller.id,
        freelancer_id: svc.freelancer_id,
        service_id: svc.id,
        brand_kit_id: kitId,
        service_title: svc.title,
        delivery_days: svc.delivery_days,
        brief,
        total_amount_cents: split.totalCents,
        platform_fee_cents: split.feeCents,
        freelancer_payout_cents: split.payoutCents,
        status: 'pending',
      })
      .select('id')
      .single()
    // The partial unique index lets only one pending contract per client and service exist;
    // losing that race means another request is opening this same checkout right now.
    if (contractError?.code === '23505') throw new HttpError(409, 'checkout_in_progress', 'A checkout for this service is already open. Try again in a moment.')
    if (contractError) throw new HttpError(500, 'write_failed', contractError.message)

    const origin = siteOrigin(req)
    let session
    try {
      session = await stripe().checkout.sessions.create(
        {
          mode: 'payment',
          customer,
          client_reference_id: contract.id,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: split.totalCents,
                product_data: {
                  name: svc.title,
                  // Stripe refuses an empty description, so a service without one gets its terms.
                  description: (svc.description || `Delivered in ${svc.delivery_days} days`).slice(0, 500),
                },
              },
            },
          ],
          payment_intent_data: {
            // The 5%. Same integer that is in the contract row — computed once, in money.ts.
            application_fee_amount: split.feeCents,
            transfer_data: { destination: freelancer!.stripe_connect_id },
            description: `Brandyzer Bazaar: ${svc.title}`.slice(0, 1000),
            metadata: { contractId: contract.id },
          },
          // Read back by the webhook. Trusted there only because Stripe's signature proves the
          // event came from Stripe, and these values came from us.
          metadata: { contractId: contract.id, clientId: caller.id, freelancerId: svc.freelancer_id },
          integration_identifier: HIRE_INTEGRATION_ID,
          success_url: `${origin}/contracts/${contract.id}?funded=1`,
          cancel_url: `${origin}/bazaar/${svc.id}?canceled=1`,
        },
        { idempotencyKey: `hire-${contract.id}` },
      )
    } catch (error) {
      // Nothing was paid and nothing will be: the pending row would only clutter the list.
      await db.from('bazaar_contracts').delete().eq('id', contract.id).eq('status', 'pending')
      console.error('checkout session failed:', error instanceof Error ? error.message : error)
      throw new HttpError(502, 'stripe_error', 'Stripe could not start this checkout. Try again in a minute.')
    }

    const { error: linkError } = await db.from('bazaar_contracts').update({ stripe_checkout_session_id: session.id }).eq('id', contract.id)
    if (linkError) console.error('could not record session on contract:', contract.id, linkError.message)

    return json({ url: session.url, contractId: contract.id, split })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
