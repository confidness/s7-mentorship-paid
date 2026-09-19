/**
 * Starts a purchase: one lesson, one Checkout Session.
 *
 * The price comes out of the database, never out of the request. A client that could name
 * its own amount would buy a 40-dollar lesson for one cent, and this is the single most
 * common way a checkout endpoint is robbed. The body carries a lesson id and nothing else
 * that touches money.
 *
 * This route does not grant anything. It writes a pending order and hands back a URL;
 * entitlement is the webhook's job, after Stripe confirms the money actually arrived.
 */

import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser } from './_lib/server'
import { platformFeeBps, siteOrigin, stripe } from './_lib/stripe'
import { platformFee } from '../src/lib/money'

interface CheckoutBody {
  lessonId?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const { lessonId: raw } = await readJson<CheckoutBody>(req)
    const lessonId = typeof raw === 'string' ? raw : ''
    if (!lessonId) throw new HttpError(400, 'invalid_input', 'Which lesson?')

    const db = adminClient()

    const { data: lesson, error } = await db
      .from('custom_lessons')
      .select('id, title, summary, author_id, price_cents, currency, published')
      .eq('id', lessonId)
      .maybeSingle()
    if (error) throw new HttpError(500, 'read_failed', error.message)
    if (!lesson || !lesson.published) throw new HttpError(404, 'not_found', 'That lesson is not available.')
    if (lesson.price_cents <= 0) throw new HttpError(400, 'lesson_is_free', 'That lesson is free — no purchase needed.')
    if (lesson.author_id === caller.id) throw new HttpError(400, 'own_lesson', 'You wrote this lesson.')

    // Buying twice is a support ticket, not a sale.
    const { data: owned } = await db.from('entitlements').select('id').eq('student_id', caller.id).eq('lesson_id', lessonId).maybeSingle()
    if (owned) throw new HttpError(409, 'already_owned', 'You already own this lesson.')

    // The author must still be able to receive money. Checking at purchase time, not only at
    // publish time, catches an account that Stripe has since restricted.
    const { data: account } = await db.from('mentor_accounts').select('stripe_account_id, charges_enabled').eq('user_id', lesson.author_id).maybeSingle()
    if (!account?.stripe_account_id || !account.charges_enabled) {
      throw new HttpError(409, 'seller_unavailable', 'This lesson cannot be bought right now.')
    }

    const amount = lesson.price_cents
    const fee = platformFee(amount, platformFeeBps())
    const origin = siteOrigin(req)

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: caller.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: lesson.currency,
            unit_amount: amount,
            product_data: { name: lesson.title, description: lesson.summary.slice(0, 500) },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: fee,
        transfer_data: { destination: account.stripe_account_id },
      },
      // Read back by the webhook. Stripe returns these verbatim, and the webhook trusts them
      // only because Stripe's signature proves the event came from Stripe.
      metadata: { lessonId: lesson.id, studentId: caller.id, platformFeeCents: String(fee) },
      success_url: `${origin}/assigned/${lesson.id}?purchased=1`,
      cancel_url: `${origin}/assigned/${lesson.id}?canceled=1`,
    })

    // Pending until the webhook says otherwise. A session that is abandoned simply stays
    // pending and grants nothing.
    const { error: orderError } = await db.from('orders').insert({
      stripe_session_id: session.id,
      student_id: caller.id,
      lesson_id: lesson.id,
      amount_cents: amount,
      platform_fee_cents: fee,
      currency: lesson.currency,
      status: 'pending',
    })
    if (orderError) throw new HttpError(500, 'write_failed', orderError.message)

    return json({ url: session.url, sessionId: session.id })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
