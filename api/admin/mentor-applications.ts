/**
 * The review desk: list pending applications, approve or reject one.
 *
 * Admin-only, and the check reads profiles.is_admin from the database — never a field from
 * the request, and never a role carried in client state. This is the route that grants the
 * ability to sell to children's families, so the identity check is the feature.
 *
 * Approving also flips profiles.role to 'mentor'. Rejecting does not, and a rejected
 * applicant may file again once — the partial unique index only blocks pending/approved.
 */

import { HttpError, adminClient, fail, json, readJson, requireAdmin, requireMethod } from '../_lib/server'

/** Identity documents are only ever handed over as a short-lived link, to a reviewer. */
const SIGNED_URL_TTL_SECONDS = 300

interface DecisionBody {
  id?: unknown
  decision?: unknown
  reason?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST')
    const admin = await requireAdmin(req)
    const db = adminClient()

    if (req.method === 'GET') {
      const status = new URL(req.url).searchParams.get('status') ?? 'pending'
      if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'invalid_input', 'Unknown status.')

      const { data, error } = await db
        .from('mentor_applications')
        .select('id, user_id, status, legal_name, bio, credential_doc_path, id_doc_path, submitted_at, reviewed_at, rejection_reason, profiles:user_id (name, city)')
        .eq('status', status)
        .order('submitted_at', { ascending: true })
        .limit(100)
      if (error) throw new HttpError(500, 'read_failed', error.message)

      // Documents are signed one review at a time and expire in minutes. Nothing here is
      // a durable link, so a copied URL stops working almost immediately.
      const applications = await Promise.all(
        (data ?? []).map(async (row) => {
          const sign = async (path: string | null) => {
            if (!path) return null
            const { data: signed } = await db.storage.from('mentor-docs').createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
            return signed?.signedUrl ?? null
          }
          const [credentialUrl, idUrl] = await Promise.all([sign(row.credential_doc_path), sign(row.id_doc_path)])
          // The paths themselves are of no use to the browser and are not returned.
          const { credential_doc_path: _c, id_doc_path: _i, ...rest } = row
          return { ...rest, credentialUrl, idUrl }
        }),
      )

      return json({ applications })
    }

    const body = await readJson<DecisionBody>(req)
    const id = typeof body.id === 'string' ? body.id : ''
    const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
    if (!id || !decision) throw new HttpError(400, 'invalid_input', 'Provide an application id and a decision.')

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
    // A rejection a person cannot understand is one they will simply refile unchanged.
    if (decision === 'rejected' && reason.length < 4) throw new HttpError(400, 'invalid_input', 'Give a reason for the rejection.')

    const { data: application, error: readError } = await db.from('mentor_applications').select('id, user_id, status').eq('id', id).single()
    if (readError || !application) throw new HttpError(404, 'not_found', 'No such application.')
    if (application.status !== 'pending') throw new HttpError(409, 'already_reviewed', 'That application has already been decided.')

    const { error: updateError } = await db
      .from('mentor_applications')
      .update({ status: decision, reviewed_at: new Date().toISOString(), reviewer_id: admin.id, rejection_reason: decision === 'rejected' ? reason : null })
      .eq('id', id)
      // Re-checking pending in the update makes two reviewers clicking at once resolve to
      // one decision rather than the later one quietly overwriting the earlier.
      .eq('status', 'pending')
    if (updateError) throw new HttpError(500, 'write_failed', updateError.message)

    if (decision === 'approved') {
      const { error: roleError } = await db.from('profiles').update({ role: 'mentor', title: 'mentor' }).eq('id', application.user_id)
      if (roleError) throw new HttpError(500, 'write_failed', roleError.message)
    }

    return json({ ok: true, id, decision })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
