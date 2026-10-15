/**
 * Everything the interface asks the backend, in one file.
 *
 * Two kinds of call, and the split follows the security model. Reads, and the writes a
 * person may make to their own rows, go straight to Postgres through the Supabase client —
 * row level security and column grants are the boundary, so a route in between would add a
 * round trip and nothing else. Anything that spends a key or moves money goes through a
 * route under api/, which re-identifies the caller and decides for itself.
 *
 * Nothing here is a permission check. If a function in here appears to decide something,
 * the decision is really the server's and this is the cached copy.
 */

import { normalizeKitRow, type BrandKitRow, type CopyFormat, type ImagePurpose, type ImageShape, type LogoBrief } from './brand'
import { USAGE_KINDS, type Plan, type UsageKind } from './plans'
import type { Role } from './bazaar'
import type { Me } from './types'
import { accessToken, backendConfigured, supabase } from './supabase'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!backendConfigured) throw new ApiError(501, 'not_configured', 'The server is not configured.')

  const token = await accessToken()
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.body) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()

  /**
   * A reply that is not JSON is not a reply from this API — a platform error page, a proxy,
   * or a static preview where /api/* is simply not running. Saying so beats letting
   * JSON.parse surface "Unexpected token '<'" somewhere in the interface.
   */
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new ApiError(res.status === 200 ? 502 : res.status, 'api_unavailable', text.slice(0, 200))
    }
  }
  if (res.status === 404 && !body.error) throw new ApiError(404, 'api_unavailable', res.statusText)
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'error'), String(body.message ?? body.error ?? res.statusText))
  return body as T
}

/** A PostgREST failure, as the same error type the routes throw. */
function check<T>(result: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new ApiError(result.error.code === '42501' ? 403 : 500, result.error.code ?? 'db_error', result.error.message)
  return result.data as T
}

async function myId(): Promise<string> {
  const { data } = await supabase().auth.getUser()
  if (!data.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')
  return data.user.id
}

/* ---------------------------------------------------------------- profile */

/** Named columns, never `*`: the Stripe ids are not granted to a browser and `*` would fail. */
const PROFILE_COLUMNS = 'id, name, avatar, bio, role, stripe_transfers_active, created_at'

export async function getMe(): Promise<Me | null> {
  const { data } = await supabase().auth.getUser()
  if (!data.user) return null
  const row = check(await supabase().from('profiles').select(PROFILE_COLUMNS).eq('id', data.user.id).maybeSingle())
  if (!row) return null
  return { ...(row as Omit<Me, 'email'>), email: data.user.email ?? '' }
}

export interface PlanState {
  plan: Plan
  proUntil: string | null
  /** This calendar month's (UTC) use, by kind. */
  used: Record<UsageKind, number>
}

/** The caller's plan and this month's use. Row level security shows each person only their own rows. */
export async function getPlan(userId: string): Promise<PlanState> {
  const month = `${new Date().toISOString().slice(0, 7)}-01`
  const [membership, usage] = await Promise.all([
    supabase().from('memberships').select('pro_until').eq('user_id', userId).maybeSingle(),
    supabase().from('usage_monthly').select('kind, used').eq('user_id', userId).eq('month', month),
  ])
  const proUntil = (check(membership) as { pro_until: string | null } | null)?.pro_until ?? null
  const used: Record<UsageKind, number> = { kit: 0, copy: 0, image: 0 }
  for (const row of (check(usage) as { kind: string; used: number }[] | null) ?? []) {
    if ((USAGE_KINDS as string[]).includes(row.kind)) used[row.kind as UsageKind] = row.used
  }
  return { plan: proUntil && Date.parse(proUntil) > Date.now() ? 'pro' : 'free', proUntil, used }
}

/**
 * The Lemon Squeezy checkout for Pro, carrying who is buying — built by the server, which
 * signs the user id into it so the webhook can tell it was not typed in. Null until
 * VITE_LEMONSQUEEZY_CHECKOUT_URL is set.
 */
export async function proCheckoutUrl(): Promise<string | null> {
  if (!import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL) return null
  return (await call<{ url: string | null }>('/api/billing/lemon')).url
}

/** Deletes the caller's account and everything in it. See api/account/delete.ts for what refuses it. */
export const deleteAccount = () => call<{ ok: true }>('/api/account/delete', { method: 'POST' })

export async function updateMe(patch: { name?: string; bio?: string | null; role?: Role }) {
  const id = await myId()
  check(await supabase().from('profiles').update(patch).eq('id', id).select('id').single())
}

/* ---------------------------------------------------------------- studio */

const KIT_COLUMNS = 'id, user_id, brand_name, vibe_summary, business_json, palette_json, typography_json, voice_rules_json, logo_url, created_at, updated_at'

/** The caller's own kits. Kits shared through a contract are reached from that contract. */
export async function listKits(): Promise<BrandKitRow[]> {
  const id = await myId()
  const rows = check(await supabase().from('brand_kits').select(KIT_COLUMNS).eq('user_id', id).order('created_at', { ascending: false })) as BrandKitRow[]
  return rows.map(normalizeKitRow)
}

/** Any kit the caller may read — their own, or one shared with them on an active contract. */
export async function getKit(kitId: string): Promise<BrandKitRow | null> {
  const row = check(await supabase().from('brand_kits').select(KIT_COLUMNS).eq('id', kitId).maybeSingle()) as BrandKitRow | null
  return row && normalizeKitRow(row)
}

export async function deleteKit(kitId: string) {
  check(await supabase().from('brand_kits').delete().eq('id', kitId))
}

export interface KitRequest {
  brandName?: string
  offering: string
  audience?: string
  location?: string
  vibeWords?: string[]
  logo?: Pick<LogoBrief, 'kind' | 'style' | 'idea' | 'avoid'>
}

export const createKit = (input: KitRequest) =>
  call<{ kit: BrandKitRow; logoConcept: string; model: string }>('/api/studio/brand-kit', { method: 'POST', body: JSON.stringify(input) }).then((r) => ({ ...r, kit: normalizeKitRow(r.kit) }))

export interface CopyVariant {
  text: string
  angle: string
  /** From slopCheck on the server: `banned:delve`, `emoji:4`… Empty when clean. */
  issues: string[]
}

export const writeCopy = (input: { brandKitId: string; format: CopyFormat; brief: string; language: 'en' | 'ru' | 'kk' }) =>
  call<{ variants: CopyVariant[]; model: string }>('/api/studio/copy', { method: 'POST', body: JSON.stringify(input) })

export const drawImage = (input: { brandKitId: string; purpose: ImagePurpose; subject?: string; shape?: ImageShape }) =>
  call<{ url: string; prompt: string; provider: string }>('/api/studio/image', { method: 'POST', body: JSON.stringify(input) })

/* ---------------------------------------------------------------- health */

export interface Health {
  ok: boolean
  text: { configured: boolean; models: string[] }
  images: { providers: string[] }
  payments: { configured: boolean }
}

export const getHealth = () => call<Health>('/api/health')
