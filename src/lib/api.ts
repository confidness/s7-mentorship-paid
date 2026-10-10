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
import type { ContractAction, Role, Split } from './bazaar'
import type { ContractRow, Me, ServiceRow } from './types'
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

/* ---------------------------------------------------------------- bazaar */

const SERVICE_COLUMNS = 'id, freelancer_id, title, description, price_usd_cents, delivery_days, portfolio_urls, active, created_at, updated_at'
const SERVICE_WITH_FREELANCER = `${SERVICE_COLUMNS}, freelancer:profiles!freelancer_id(id, name, avatar, stripe_transfers_active)`

export async function listServices(): Promise<ServiceRow[]> {
  return check(await supabase().from('bazaar_services').select(SERVICE_WITH_FREELANCER).eq('active', true).order('created_at', { ascending: false }).limit(200)) as unknown as ServiceRow[]
}

export async function getService(serviceId: string): Promise<ServiceRow | null> {
  return check(await supabase().from('bazaar_services').select(SERVICE_WITH_FREELANCER).eq('id', serviceId).maybeSingle()) as unknown as ServiceRow | null
}

export async function myServices(): Promise<ServiceRow[]> {
  const id = await myId()
  return check(await supabase().from('bazaar_services').select(SERVICE_COLUMNS).eq('freelancer_id', id).order('created_at', { ascending: false })) as ServiceRow[]
}

export interface ServiceDraft {
  title: string
  description: string
  price_usd_cents: number
  delivery_days: number
  portfolio_urls: string[]
  active: boolean
}

/** Written directly: the policy and the column grants are the whole of what may be written. */
export async function saveService(draft: ServiceDraft, serviceId?: string): Promise<string> {
  if (serviceId) {
    check(await supabase().from('bazaar_services').update(draft).eq('id', serviceId).select('id').single())
    return serviceId
  }
  const freelancer_id = await myId()
  const row = check(await supabase().from('bazaar_services').insert({ ...draft, freelancer_id }).select('id').single()) as { id: string }
  return row.id
}

/** One column, so pausing cannot write back a price or title edited in another tab. */
export async function setServiceActive(serviceId: string, active: boolean) {
  check(await supabase().from('bazaar_services').update({ active }).eq('id', serviceId).select('id').single())
}

/** Refused by the database once anybody has hired it — pause it instead. */
export async function deleteService(serviceId: string) {
  check(await supabase().from('bazaar_services').delete().eq('id', serviceId))
}

export const hire = (input: { serviceId: string; brandKitId?: string | null; brief?: string }) =>
  call<{ url: string; contractId: string; split: Split }>('/api/bazaar/hire', { method: 'POST', body: JSON.stringify(input) })

const CONTRACT_COLUMNS =
  'id, client_id, freelancer_id, service_id, brand_kit_id, service_title, delivery_days, brief, currency, total_amount_cents, platform_fee_cents, freelancer_payout_cents, status, delivery_note, delivery_url, created_at, funded_at, delivered_at, completed_at'
const CONTRACT_WITH_PEOPLE = `${CONTRACT_COLUMNS}, client:profiles!client_id(id, name, avatar), freelancer:profiles!freelancer_id(id, name, avatar)`

/** Both sides at once: row level security returns exactly the contracts this person is party to. */
export async function listContracts(): Promise<ContractRow[]> {
  return check(await supabase().from('bazaar_contracts').select(CONTRACT_WITH_PEOPLE).order('created_at', { ascending: false }).limit(200)) as unknown as ContractRow[]
}

export async function getContract(contractId: string): Promise<ContractRow | null> {
  return check(await supabase().from('bazaar_contracts').select(CONTRACT_WITH_PEOPLE).eq('id', contractId).maybeSingle()) as unknown as ContractRow | null
}

export const actOnContract = (id: string, action: ContractAction, extra: { note?: string; url?: string } = {}) =>
  call<{ ok: true; status: string }>('/api/bazaar/contracts', { method: 'PATCH', body: JSON.stringify({ id, action, ...extra }) })

/* ---------------------------------------------------------------- payouts */

export interface PayoutStatus {
  connected: boolean
  transfersActive: boolean
  status: string
  requirements: string[]
}

export const startOnboarding = () => call<{ url: string }>('/api/connect/onboard', { method: 'POST' })
export const payoutStatus = () => call<PayoutStatus>('/api/connect/status')

/* ---------------------------------------------------------------- health */

export interface Health {
  ok: boolean
  text: { configured: boolean; models: string[] }
  images: { providers: string[] }
  payments: { configured: boolean; checkout: boolean; webhook: boolean; connectEvents: boolean }
}

export const getHealth = () => call<Health>('/api/health')
