/**
 * Stripe's webhook. The only thing in this codebase that grants an entitlement.
 *
 * Everything else may read whether a student owns a lesson; nothing else may decide it.
 * That is why the RLS policies carry no insert rule for entitlements at all: this route
 * uses the service role, and a leaked anon key still cannot mint access to paid content.
 *
 * Three details are load-bearing and easy to get wrong:
 *
 *  1. Signature verification runs against the RAW body. Parsing the JSON first — which most
 *     frameworks do by default — re-serializes it, the bytes no longer match what Stripe
 *     signed, and every event fails. Hence `req.text()` and never `req.json()`.
 *
 *  2. Redelivery is normal. Stripe retries until it gets a 2xx, and the same event will
 *     arrive more than once. Every event is decided by `settle` against the order's current
 *     status, and written only if that status still holds, so the second delivery changes
 *     nothing rather than granting a duplicate entitlement, double-counting the day's
 *     revenue, or taking a lesson back twice.
 *
 *  3. Order is not guaranteed either. A refund can arrive before the payment notice it
 *     refunds, and a retried payment notice can arrive after the refund. So a payment notice
 *     never reopens an order whose money has gone back, and a refund or dispute that finds
 *     no order yet is sent back to Stripe to try again, rather than acknowledged and lost.
 */

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, adminClient, fail, json, requireEnv } from './_lib/server.js'
import { stripe } from './_lib/stripe.js'

/** `order_status` in Postgres: four values from 0001, and the dispute pair from 0011. */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed' | 'charged_back'

/** A Stripe event, reduced to the part that decides anything about an order. */
export type PaymentNotice =
  | { kind: 'paid' }
  | { kind: 'refunded'; full: boolean }
  | { kind: 'dispute_opened' }
  | { kind: 'dispute_closed'; outcome: Stripe.Dispute.Status }

/** What to do to the order, and to the entitlement that hangs off it. */
export type Step =
  | { act: 'nothing' }
  | { act: 'retry' }
  | { act: 'record' }
  | { act: 'move'; to: OrderStatus; access: 'grant' | 'withdraw' | 'keep' }

/**
 * How long Stripe keeps retrying a delivery in live mode.
 *
 * A refund or a dispute is always created after the payment it is about, so once this long
 * has passed since one was created, the payment notice for the same sale has either been
 * delivered or been given up on by Stripe. Retrying past that point cannot make it arrive.
 */
export const STRIPE_RETRY_SECONDS = 3 * 24 * 60 * 60

/**
 * The orders whose money has gone back to the buyer, or is being fought over. A payment
 * notice opens none of them: whatever it says, the money it describes is no longer simply ours.
 */
const MONEY_BACK: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['refunded', 'disputed', 'charged_back'])

const NOTHING: Step = { act: 'nothing' }

/**
 * Moves to a status that holds no access. `paid` is the only status that holds an
 * entitlement, so only an order leaving `paid` has one to withdraw — and withdrawing from any
 * other would take the row a later, separate purchase of the same lesson wrote.
 */
const leave = (current: OrderStatus, to: OrderStatus): Step => ({ act: 'move', to, access: current === 'paid' ? 'withdraw' : 'keep' })

/**
 * What one Stripe event does to one order, alone and with no I/O.
 *
 * Pulled out of the handlers for the same reason `decideAccess` is pulled out of
 * lesson-content.ts: this is where a student gains or loses a paid lesson, Stripe delivers
 * these in any order and any number of times, and that is far easier to check exhaustively as
 * a table than through a database. `current` is null when no order matched; `ageSeconds` is
 * how long ago Stripe created the event, which a redelivery does not reset.
 */
export function settle(current: OrderStatus | null, notice: PaymentNotice, ageSeconds: number): Step {
  // A partial refund leaves the lesson and the order alone. Stripe sends `charge.refunded` for
  // any refund, and only `charge.refunded === true` — the whole amount back — undoes the sale.
  if (notice.kind === 'refunded' && !notice.full) return NOTHING

  if (current === null) {
    // A paid session with no order row is a payment we failed to write down, not one to drop.
    if (notice.kind === 'paid') return { act: 'record' }
    // Money going back on an order we cannot find. A refund or dispute finds its order by
    // payment intent, which only the payment notice writes, so this is usually a refund that
    // overtook its own sale. Acknowledging it would lose the refund for good and let the late
    // payment notice grant the lesson anyway, so Stripe is asked to send it again. Once no
    // payment notice can still be coming, retrying is pointless: the charge was never a sale
    // made here, or its sale was never recorded and there is no lesson to take back.
    return ageSeconds < STRIPE_RETRY_SECONDS ? { act: 'retry' } : NOTHING
  }

  switch (notice.kind) {
    case 'paid':
      // A redelivered or late payment notice must not reopen a lesson whose money has gone
      // back. `failed` may still become paid: if Stripe says the session is paid, it is.
      return MONEY_BACK.has(current) ? NOTHING : { act: 'move', to: 'paid', access: 'grant' }

    case 'refunded':
      // Already undone, by us or by the buyer's bank.
      if (current === 'refunded' || current === 'charged_back') return NOTHING
      return leave(current, 'refunded')

    case 'dispute_opened':
      // Withdrawn as soon as the bank is involved, inquiries (`warning_*`) included: the buyer
      // has asked for this money back, and the lesson waits until the bank has answered. An
      // order already refunded or charged back has nothing left to withdraw, and must not be
      // marked disputed — winning the dispute would then hand back a lesson that was refunded.
      if (MONEY_BACK.has(current)) return NOTHING
      return leave(current, 'disputed')

    case 'dispute_closed':
      // How it ended decides it:
      //   won             the bank sided with the sale and the money came back. Open it again.
      //   warning_closed  an inquiry closed without becoming a chargeback, so the money never
      //                   left. The lesson was shut only while the question was open.
      //   lost            the money has gone back for good. The lesson stays shut, and the order
      //                   says why. If the opening was never seen, the order is still paid, and
      //                   this is where access is withdrawn.
      //   prevented, and any status Stripe adds after this was written: the order stays as it
      //                   is. A prevented dispute is usually headed off by refunding the
      //                   payment, and if money went back `charge.refunded` says so. A lesson
      //                   the opening shut stays shut, which is the safe side to be wrong on: a
      //                   student who should have access can ask for it, while a lesson handed
      //                   back for free is never asked back.
      // A win reopens only an order the dispute shut, or one already paid — where granting
      // again is a no-op, unless the write that restored it failed halfway and this is the
      // retry. A refund issued during an inquiry has already moved the order to `refunded`, and
      // closing the inquiry does not undo that.
      if (notice.outcome === 'lost') return current === 'refunded' || current === 'charged_back' ? NOTHING : leave(current, 'charged_back')
      if (notice.outcome === 'won' || notice.outcome === 'warning_closed') return current === 'disputed' || current === 'paid' ? { act: 'move', to: 'paid', access: 'grant' } : NOTHING
      return NOTHING
  }
}

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

  // A redelivery carries the original event's timestamp, so this is how long Stripe has been
  // trying to deliver it — what decides whether an unmatched refund is worth waiting for.
  const ageSeconds = Math.floor(Date.now() / 1000) - event.created

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
        await markRefunded(event.data.object, ageSeconds)
        break

      case 'charge.dispute.created':
        await settleDispute(event.data.object, { kind: 'dispute_opened' }, ageSeconds, event.type)
        break

      case 'charge.dispute.closed':
        await settleDispute(event.data.object, { kind: 'dispute_closed', outcome: event.data.object.status }, ageSeconds, event.type)
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
    // A non-2xx asks Stripe to try again, which is what we want for a transient database fault
    // or an order that has not been recorded yet: the retry is safe precisely because these
    // writes are idempotent.
    return fail(error)
  }
}

interface OrderRow {
  id: string
  status: OrderStatus
  student_id: string
  lesson_id: string
  paid_at: string | null
}

const ORDER_COLUMNS = 'id, status, student_id, lesson_id, paid_at'

const idOf = (ref: string | { id: string } | null | undefined): string | null => (typeof ref === 'string' ? ref : (ref?.id ?? null))

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

  const paymentIntent = idOf(session.payment_intent)

  // Found by the session id, which is unique in our schema and written at checkout — unlike
  // the payment intent, which this is the first event to know.
  const { data, error } = await db.from('orders').select(ORDER_COLUMNS).eq('stripe_session_id', session.id).maybeSingle()
  if (error) throw error
  const order = data as OrderRow | null

  const step = settle(order?.status ?? null, { kind: 'paid' }, 0)

  // The order row is normally written at checkout. If it is missing — a session created
  // outside the usual path, or a lost write — the payment still happened, so reconstruct it
  // rather than dropping a paid customer on the floor.
  if (step.act === 'record') {
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
      .select(ORDER_COLUMNS)
      .single()
    if (rebuildError) throw rebuildError
    await grant(db, rebuilt as OrderRow)
    return
  }

  // The first payment time is kept, so a redelivery writes the same values it found.
  await carryOut(db, order, step, `checkout session ${session.id}`, { stripe_payment_intent: paymentIntent, paid_at: order?.paid_at ?? new Date().toISOString() })
}

async function markFailed(session: Stripe.Checkout.Session) {
  const db = adminClient()
  // Only a pending order moves to failed: an expired-session event arriving after a
  // successful payment must not undo a sale.
  const { error } = await db.from('orders').update({ status: 'failed' }).eq('stripe_session_id', session.id).eq('status', 'pending')
  if (error) throw error
}

/**
 * A full refund marks the order and withdraws access.
 *
 * Leaving the entitlement in place would mean paid content stays unlocked after the money
 * has gone back, which is the refund-abuse path. A partial refund changes neither — see
 * `settle`.
 *
 * Refunds are issued by a person in the Stripe dashboard, not by this code, so whether the
 * mentor's transfer is reversed and the platform's fee returned is chosen there, per refund.
 */
async function markRefunded(charge: Stripe.Charge, ageSeconds: number) {
  const paymentIntent = idOf(charge.payment_intent)
  if (!paymentIntent) return

  const db = adminClient()
  const order = await orderForPayment(db, paymentIntent)
  await carryOut(db, order, settle(order?.status ?? null, { kind: 'refunded', full: charge.refunded }, ageSeconds), `charge.refunded for ${paymentIntent}`)
}

/**
 * A chargeback: the buyer's bank taking the money back without asking us.
 *
 * Without this, a dispute was the refund-abuse path through a different door — the bank
 * returns the money and the student keeps the lesson. Opening one withdraws access exactly
 * as a refund does; closing it decides whether access comes back. The rules are in `settle`.
 *
 * What this does not touch is the mentor's money. With destination charges the platform is
 * the merchant of record: Stripe debits the disputed amount and its dispute fee from the
 * platform's balance, and the transfer that paid the mentor stays where it is. A lost
 * dispute therefore costs the platform the whole sale — its own fee and the mentor's share —
 * plus the dispute fee. Recovering the mentor's share means reversing that transfer, and
 * paying it out again if the dispute is won, with a connected balance that may not cover it
 * and an idempotency of its own to get right. Who carries a chargeback is a policy before it
 * is code, so until there is one, an operator reverses the transfer from the dashboard.
 */
async function settleDispute(dispute: Stripe.Dispute, notice: PaymentNotice, ageSeconds: number, type: string) {
  const paymentIntent = idOf(dispute.payment_intent)
  if (!paymentIntent) return

  const db = adminClient()
  const order = await orderForPayment(db, paymentIntent)
  await carryOut(db, order, settle(order?.status ?? null, notice, ageSeconds), `${type} ${dispute.id} for ${paymentIntent}`)
}

/** Finds an order the way a charge or a dispute can: by payment intent, the only id they share with it. */
async function orderForPayment(db: SupabaseClient, paymentIntent: string): Promise<OrderRow | null> {
  const { data, error } = await db.from('orders').select(ORDER_COLUMNS).eq('stripe_payment_intent', paymentIntent).maybeSingle()
  if (error) throw error
  return data as OrderRow | null
}

/**
 * Carries out a step.
 *
 * The status write is conditional on the status the step was decided from. If another
 * delivery moved the order in the meantime, nothing matches, and the throw hands this event
 * back to Stripe to be decided again against the order as it now stands — rather than, say, a
 * refund and a late payment notice each applying their half on top of the other.
 */
async function carryOut(db: SupabaseClient, order: OrderRow | null, step: Step, about: string, patch: Record<string, unknown> = {}) {
  if (step.act === 'nothing') {
    if (!order) console.warn(`${about}: no order matches it; acknowledged without changes`)
    return
  }
  if (step.act === 'retry') {
    console.warn(`${about}: no order is recorded for this payment yet; asking Stripe to deliver it again`)
    throw new HttpError(409, 'order_not_recorded', 'No order is recorded for this payment yet.')
  }
  if (step.act === 'record' || !order) throw new Error(`${about}: no order to apply this to`)

  // Access is taken away before the status records it, and given after. Either way round, a
  // write that fails halfway leaves the event with work still to do when Stripe sends it again:
  // a withdrawal whose status had already been written would read as done and leave the student
  // the lesson, while a grant is simply redone, because `settle` re-grants any order it leaves
  // paid. A withdrawal is only ever decided from `paid`, and every move out of `paid` takes
  // access away, so deleting first cannot remove access the order should still have.
  if (step.access === 'withdraw') await withdraw(db, order)

  const { data: moved, error } = await db.from('orders').update({ ...patch, status: step.to }).eq('id', order.id).eq('status', order.status).select('id').maybeSingle()
  if (error) throw error
  if (!moved) throw new Error(`${about}: order ${order.id} changed while this event was being applied`)

  if (step.access === 'grant') await grant(db, order)
}

/** The grant itself. onConflict makes the second delivery a no-op rather than an error. */
async function grant(db: SupabaseClient, order: OrderRow) {
  const { error } = await db
    .from('entitlements')
    .upsert({ student_id: order.student_id, lesson_id: order.lesson_id, order_id: order.id }, { onConflict: 'student_id,lesson_id', ignoreDuplicates: true })
  if (error) throw error
}

/**
 * Takes access away by deleting the entitlement, not by flagging it.
 *
 * Every reader asks only whether the row exists: `api/lesson-content.ts`, `api/lessons.ts`,
 * checkout's already-owned check, `has_entitlement()` behind the submission policy, and the
 * `buyers` count in `lesson_stats`. A flag would have to be taught to each of them, and the
 * one that was missed would be the hole. Nothing is lost by deleting: the order still says
 * who bought what, and a won dispute writes the row again from it.
 */
async function withdraw(db: SupabaseClient, order: OrderRow) {
  const { error } = await db.from('entitlements').delete().eq('student_id', order.student_id).eq('lesson_id', order.lesson_id)
  if (error) throw error
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

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
