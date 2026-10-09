/**
 * Thin events from Accounts v2: a freelancer's ability to be paid changed.
 *
 * v2 account changes are not delivered to the ordinary webhook. They arrive as *thin* events
 * on a separate event destination with its own signing secret — a notification carrying an
 * id and a type, not a snapshot of the object. So this does not trust the event for the
 * state either: it reads the account back from Stripe and writes what Stripe says now. Two
 * notifications arriving out of order therefore both end on the current truth.
 *
 * Set up in the Dashboard: Developers → Event destinations → an Accounts v2 destination
 * pointed here, subscribed to the recipient capability and requirements events below.
 */

import { adminClient, fail, json, requireEnv } from '../_lib/server.js'
import { retrieveRecipient, stripe } from '../_lib/stripe.js'

const WATCHED = new Set<string>([
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
  'v2.core.account[requirements].updated',
])

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const signature = req.headers.get('stripe-signature')
  if (!signature) return json({ error: 'missing_signature' }, 400)

  let accountId: string | null = null
  try {
    const raw = await req.text()
    const notification = await stripe().parseEventNotificationAsync(raw, signature, requireEnv('STRIPE_CONNECT_WEBHOOK_SECRET'))
    if (WATCHED.has(notification.type) && 'related_object' in notification && notification.related_object) {
      accountId = notification.related_object.id
    }
  } catch (error) {
    console.error('stripe thin-event verification failed:', error instanceof Error ? error.message : error)
    return json({ error: 'invalid_signature' }, 400)
  }

  if (!accountId) return json({ received: true })

  try {
    const state = await retrieveRecipient(accountId)
    const { error } = await adminClient().from('profiles').update({ stripe_transfers_active: state.transfersActive }).eq('stripe_connect_id', accountId)
    if (error) throw error
    return json({ received: true })
  } catch (error) {
    // A 500 makes Stripe retry, and the retry re-reads the account, so it is always safe.
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
