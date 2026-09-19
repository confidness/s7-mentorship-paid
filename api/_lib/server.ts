/**
 * Shared server plumbing: environment, Supabase access, caller identity, JSON replies.
 *
 * Two clients, and the difference is the whole security model:
 *
 *   userClient(token)  acts as the signed-in person. Row level security applies, so a bug
 *                      here leaks nothing the caller could not already read.
 *   adminClient()      uses the service role and bypasses RLS entirely. Reserved for the
 *                      Stripe webhook and for admin review, where the server must write
 *                      rows no user is allowed to write — entitlements above all.
 *
 * Reach for userClient by default. adminClient is for when the whole point is to act
 * outside what the caller may do, and every use of it should be obvious on sight.
 */

declare const process: { env: Record<string, string | undefined> }

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const env = (name: string): string | undefined => process.env[name]

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new HttpError(500, 'not_configured', `${name} is not set`)
  return value
}

/** An error carrying the status and machine-readable code the client should see. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Turns a thrown error into a reply.
 *
 * Only HttpError detail crosses the wire. Anything else becomes a bare 500: an unexpected
 * exception can carry a connection string or a key in its message, and the client has no
 * use for it either way.
 */
export function fail(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status)
  console.error('unhandled server error:', error)
  return json({ error: 'server_error' }, 500)
}

export function userClient(token: string): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface Caller {
  id: string
  email?: string
  token: string
  db: SupabaseClient
}

/**
 * Identifies the caller from the Authorization header.
 *
 * The id comes from Supabase verifying the JWT's signature — never from the request body.
 * A caller-supplied user id is not identification, it is a request to be someone else.
 */
export async function requireUser(req: Request): Promise<Caller> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')

  const db = userClient(token)
  const { data, error } = await db.auth.getUser()
  if (error || !data?.user) throw new HttpError(401, 'unauthenticated', 'Your session has expired.')

  return { id: data.user.id, email: data.user.email ?? undefined, token, db }
}

/** Confirms the caller is an admin, reading the flag from the database rather than the request. */
export async function requireAdmin(req: Request): Promise<Caller> {
  const caller = await requireUser(req)
  const { data } = await adminClient().from('profiles').select('is_admin').eq('id', caller.id).single()
  if (!data?.is_admin) throw new HttpError(403, 'forbidden', 'Admins only.')
  return caller
}

/**
 * Confirms the caller may sell: application approved and Stripe willing to accept charges.
 *
 * Both halves matter. Approval without a connected account means money with nowhere to go;
 * a connected account without approval means an unreviewed adult publishing to children.
 */
export async function requireSellingMentor(caller: Caller): Promise<{ stripeAccountId: string }> {
  const db = adminClient()
  const [{ data: application }, { data: account }] = await Promise.all([
    db.from('mentor_applications').select('status').eq('user_id', caller.id).eq('status', 'approved').maybeSingle(),
    db.from('mentor_accounts').select('stripe_account_id, charges_enabled').eq('user_id', caller.id).maybeSingle(),
  ])
  if (!application) throw new HttpError(403, 'not_approved', 'Your mentor application has not been approved yet.')
  if (!account?.stripe_account_id || !account.charges_enabled) {
    throw new HttpError(409, 'payouts_not_ready', 'Connect a payout account before selling lessons.')
  }
  return { stripeAccountId: account.stripe_account_id }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'bad_request', 'Expected a JSON body.')
  }
}

/** Rejects anything but the methods a route serves, so a stray GET cannot trip a write path. */
export function requireMethod(req: Request, ...allowed: string[]) {
  if (!allowed.includes(req.method)) throw new HttpError(405, 'method_not_allowed')
}
