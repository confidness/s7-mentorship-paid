/**
 * Rows as the browser reads them, named as the database names them.
 *
 * snake_case on purpose. These are the columns of the tables in supabase/migrations, read
 * straight through PostgREST under row level security; renaming every field on the way in
 * would be a second schema to keep in step with the first, for no reader's benefit.
 */

import type { Role } from './bazaar'

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
