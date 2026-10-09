/**
 * Rows as the browser reads them, named as the database names them.
 *
 * snake_case on purpose. These are the columns of the tables in supabase/migrations, read
 * straight through PostgREST under row level security; renaming every field on the way in
 * would be a second schema to keep in step with the first, for no reader's benefit.
 */

import type { ContractStatus, Role } from './bazaar'

export type { BrandKitRow } from './brand'

/** The columns of `profiles` a member may read. The Stripe ids are deliberately not among them. */
export interface Profile {
  id: string
  name: string
  avatar: string
  bio: string | null
  role: Role
  stripe_transfers_active: boolean
  created_at: string
}

/** The signed-in person: their profile plus the email Auth holds. */
export interface Me extends Profile {
  email: string
}

export type PersonRef = Pick<Profile, 'id' | 'name' | 'avatar'>

export interface ServiceRow {
  id: string
  freelancer_id: string
  title: string
  description: string
  price_usd_cents: number
  delivery_days: number
  portfolio_urls: string[]
  active: boolean
  created_at: string
  updated_at: string
  freelancer?: PersonRef & { stripe_transfers_active: boolean }
}

export interface ContractRow {
  id: string
  client_id: string
  freelancer_id: string
  service_id: string
  brand_kit_id: string | null
  service_title: string
  delivery_days: number
  brief: string
  currency: string
  total_amount_cents: number
  platform_fee_cents: number
  freelancer_payout_cents: number
  status: ContractStatus
  delivery_note: string | null
  delivery_url: string | null
  created_at: string
  funded_at: string | null
  delivered_at: string | null
  completed_at: string | null
  client?: PersonRef
  freelancer?: PersonRef
}
