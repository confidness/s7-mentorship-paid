/**
 * The browser's Supabase client.
 *
 * Only the anon key is here, and that is correct: it is designed to be public, and row
 * level security is what actually decides what it can reach. The service-role key must
 * never appear in this file or any other under src/ — anything the bundle imports is
 * readable in devtools.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * `import.meta.env` is Vite's, and this module is also pulled into the node test bundle by
 * whatever imports it. There it is undefined, and reading a property off it at module scope
 * throws before a single check has run.
 */
const env: Record<string, string | undefined> = import.meta.env ?? {}
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY

/** False in a checkout with no environment. The app then shows how to configure itself. */
export const backendConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!client) {
    if (!backendConfigured) throw new Error('Supabase is not configured')
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}

/** The caller's access token, or null when signed out or unconfigured. */
export async function accessToken(): Promise<string | null> {
  if (!backendConfigured) return null
  const { data } = await supabase().auth.getSession()
  return data.session?.access_token ?? null
}
