/**
 * Moves a contract through review: deliver, request changes, accept.
 *
 * Contracts have no write policy for any browser, so every change a person makes goes
 * through here with the service role — having first identified the caller from their token
 * and asked `decideTransition` whether they, specifically, may make this move from this
 * status. Reading is not done here; both parties read their contracts directly under RLS.
 *
 * The update is conditional on the status it was decided against. Two tabs pressing
 * "accept" and "request changes" a second apart cannot both win: the second finds the row
 * already moved and is told so, rather than overwriting it.
 *
 * Money does not move here. A destination charge has already paid the freelancer by the
 * time a contract is funded; these states are the working agreement between two people, and
 * the Stripe webhook alone owns the ones that are about payment.
 */

import { decideTransition, type ContractAction, type ContractStatus } from '../../src/lib/bazaar.js'
import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser, str, uuidOrNull } from '../_lib/server.js'

interface Body {
  id?: unknown
  action?: unknown
  note?: unknown
  url?: unknown
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'PATCH')
    const caller = await requireUser(req)
    const body = await readJson<Body>(req)

    const id = uuidOrNull(body.id)
    if (!id) throw new HttpError(400, 'invalid_input', 'Which contract?')
    const action = String(body.action ?? '') as ContractAction

    const db = adminClient()
    const { data: contract, error } = await db.from('bazaar_contracts').select('id, status, client_id, freelancer_id').eq('id', id).maybeSingle()
    if (error) throw new HttpError(500, 'read_failed', error.message)
    if (!contract) throw new HttpError(404, 'not_found', 'Contract not found.')

    const verdict = decideTransition({ status: contract.status as ContractStatus, clientId: contract.client_id, freelancerId: contract.freelancer_id }, caller.id, action)
    if (!verdict.ok) throw new HttpError(verdict.status, verdict.code, verdict.message)

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { status: verdict.to }
    if (action === 'deliver') {
      const url = str(body.url, 1000)
      // The schema refuses anything but https too; saying so here gives a reason, not a 500.
      if (url && !/^https:\/\/\S+$/.test(url)) throw new HttpError(400, 'invalid_input', 'The delivery link must start with https://')
      patch.delivery_note = str(body.note, 4000) || null
      patch.delivery_url = url || null
      patch.delivered_at = now
    }
    if (action === 'accept') patch.completed_at = now

    const { data: moved, error: writeError } = await db
      .from('bazaar_contracts')
      .update(patch)
      .eq('id', id)
      .eq('status', contract.status)
      .select('id, status')
      .maybeSingle()
    if (writeError) throw new HttpError(500, 'write_failed', writeError.message)
    if (!moved) throw new HttpError(409, 'changed', 'This contract changed while you were looking at it. Reload and try again.')

    return json({ ok: true, status: moved.status })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
