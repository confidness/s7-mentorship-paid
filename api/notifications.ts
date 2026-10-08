/**
 * The inbox.
 *
 * GET    everything addressed to you.
 * PATCH  mark some of it read.
 *
 * Nothing here creates a notification. They are written where the thing they announce
 * happens — `api/projects.ts` when a mentor decides, `api/requests.ts` when a course
 * request is answered — because a notification that can be written on its own
 * is a notification that can be written about an event that never occurred.
 */

import { HttpError, fail, json, readJson, requireMethod, requireUser, type Caller } from './_lib/server.js'

const SELECT = 'id, user_id, title, body, vars, kind, href, created_at, read_at'

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'PATCH')
    const caller = await requireUser(req)
    return req.method === 'GET' ? await list(caller) : await markRead(req, caller)
  } catch (error) {
    return fail(error)
  }
}

async function list(caller: Caller): Promise<Response> {
  // No `eq('user_id', …)`: the policy is already that filter, and a second copy of it here
  // is a second thing to get wrong. The limit is what keeps a long-lived account cheap.
  const { data, error } = await caller.db.from('notifications').select(SELECT).order('created_at', { ascending: false }).limit(200)
  if (error) throw new HttpError(500, 'read_failed', error.message)

  return json({
    notifications: (data ?? []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      title: n.title,
      body: n.body,
      vars: n.vars ?? undefined,
      kind: n.kind,
      href: n.href ?? undefined,
      createdAt: n.created_at,
      read: Boolean(n.read_at),
    })),
  })
}

/**
 * Marks read. One column, and the route is what holds that line.
 *
 * The policy can only say the row is yours; it cannot say which fields you may touch. So the
 * update is written out here rather than taken from the body — without this, marking a
 * notification read would be an opening to rewrite what it says.
 *
 * An empty `ids` means the whole inbox, which is what opening the panel does.
 */
async function markRead(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<{ ids?: unknown }>(req)
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []

  let q = caller.db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (ids.length) q = q.in('id', ids)

  const { error } = await q
  if (error) throw new HttpError(500, 'write_failed', error.message)
  return json({ ok: true })
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
