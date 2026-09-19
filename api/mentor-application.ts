/**
 * Applying to teach — what replaced the shared mentor PIN.
 *
 * The PIN answered "does this person know a number that has been passed around the academy
 * for a year". This answers "has a named adult, with documents, been approved by a specific
 * reviewer, on a date, revocably". That is a different question, and it is the one that
 * matters when the person will be handling children's work and taking their money.
 *
 * GET  — the caller's own application status, for the UI to show where they stand.
 * POST — files or refiles an application.
 *
 * Note what this route cannot do: set status. Approval lives in api/admin/mentor-applications.ts
 * behind an admin check, and the RLS policy on the table refuses status changes from anyone else
 * even if this file were wrong.
 */

import { HttpError, fail, json, readJson, requireMethod, requireUser } from './_lib/server'

interface ApplicationBody {
  legalName?: unknown
  bio?: unknown
  credentialDocPath?: unknown
  idDocPath?: unknown
}

const asText = (value: unknown, field: string, min: number, max: number): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < min) throw new HttpError(400, 'invalid_input', `${field} must be at least ${min} characters.`)
  return text.slice(0, max)
}

/**
 * A storage path, not a URL and not a file.
 *
 * It must sit under the caller's own user-id prefix. The Storage policy enforces the same
 * rule on upload, but a path is also written to a row here, and accepting "someone-else-id/..."
 * would let an applicant point their application at another person's documents.
 */
function asOwnPath(value: unknown, userId: string, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const path = String(value)
  if (path.includes('..') || !path.startsWith(`${userId}/`)) {
    throw new HttpError(400, 'invalid_input', `${field} must be a file you uploaded.`)
  }
  return path
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST')
    const caller = await requireUser(req)

    if (req.method === 'GET') {
      const { data, error } = await caller.db
        .from('mentor_applications')
        .select('id, status, legal_name, submitted_at, reviewed_at, rejection_reason')
        .eq('user_id', caller.id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new HttpError(500, 'read_failed', error.message)

      // Whether they can actually sell is a second question — approval alone is not enough.
      const { data: account } = await caller.db
        .from('mentor_accounts')
        .select('charges_enabled, payouts_enabled')
        .eq('user_id', caller.id)
        .maybeSingle()

      return json({
        application: data ?? null,
        status: data?.status ?? 'none',
        chargesEnabled: Boolean(account?.charges_enabled),
        payoutsEnabled: Boolean(account?.payouts_enabled),
      })
    }

    const body = await readJson<ApplicationBody>(req)
    const legalName = asText(body.legalName, 'Legal name', 2, 120)
    const bio = asText(body.bio, 'Bio', 40, 2000)
    const credentialDocPath = asOwnPath(body.credentialDocPath, caller.id, 'Credential document')
    const idDocPath = asOwnPath(body.idDocPath, caller.id, 'Identity document')

    if (!credentialDocPath && !idDocPath) {
      throw new HttpError(400, 'invalid_input', 'Attach at least one document for review.')
    }

    // A pending or approved application blocks a new one. The partial unique index enforces
    // this too; checking first turns a constraint violation into a sentence someone can read.
    const { data: live } = await caller.db
      .from('mentor_applications')
      .select('status')
      .eq('user_id', caller.id)
      .in('status', ['pending', 'approved'])
      .maybeSingle()
    if (live) {
      throw new HttpError(409, live.status === 'approved' ? 'already_approved' : 'already_pending', live.status === 'approved' ? 'You are already approved to teach.' : 'Your application is already being reviewed.')
    }

    const { data, error } = await caller.db
      .from('mentor_applications')
      .insert({ user_id: caller.id, legal_name: legalName, bio, credential_doc_path: credentialDocPath, id_doc_path: idDocPath, status: 'pending' })
      .select('id, status, submitted_at')
      .single()
    if (error) throw new HttpError(500, 'write_failed', error.message)

    return json({ ok: true, application: data }, 201)
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
