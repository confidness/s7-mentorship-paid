/**
 * The browser's Supabase client.
 *
 * Only the anon key is here, and that is correct: it is designed to be public, and row
 * level security is what actually decides what it can reach. The service-role key must
 * never appear in this file or any other under src/ — anything the bundle imports is
 * readable in devtools, which is the same reasoning the old build applied to the mentor PIN.
 *
 * Payments are optional. A checkout without Supabase configured is a prototype run, so
 * every helper here degrades to "not signed in" instead of throwing on import.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** False in a local checkout with no environment at all, exactly as the AI mentor degrades. */
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

/**
 * Uploads a file to a private bucket under the signed-in user's own id prefix.
 *
 * The prefix is not decoration: the Storage policies key on it, so a file written anywhere
 * else is rejected, and one written here cannot be claimed by another account. Returns the
 * path, never a URL — reading it back requires a signed URL the server issues.
 */
export async function uploadPrivate(bucket: 'lesson-materials' | 'mentor-docs', file: File): Promise<string> {
  const db = supabase()
  const { data: auth } = await db.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Sign in to upload.')

  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `${userId}/${Date.now()}-${safeName}`

  const { error } = await db.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error(error.message)
  return path
}
