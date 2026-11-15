/**
 * Pro: searches the web for businesses like this one — in its area, and anywhere using its
 * brand name — so the owner sees who is already there before they print the sign.
 *
 * Tavily (TAVILY_API_KEY, free tier 1,000 searches a month): two basic searches per request.
 * Each request also spends one copy request from the month's allowance, so the free search
 * credits cannot be drained by one account.
 */

declare const process: { env: Record<string, string | undefined> }

import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser, uuidOrNull } from '../_lib/server.js'
import { loadKit, takeQuota } from '../_lib/studio.js'

interface Hit {
  title: string
  url: string
  snippet: string
}

async function search(query: string, key: string): Promise<Hit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, max_results: 6, search_depth: 'basic' }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new HttpError(502, 'search_failed', `Web search answered ${res.status}.`)
  const body = (await res.json().catch(() => ({}))) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] }
  return (body.results ?? [])
    .map((r) => ({ title: String(r.title ?? '').slice(0, 160), url: String(r.url ?? ''), snippet: String(r.content ?? '').slice(0, 240) }))
    .filter((r) => r.url.startsWith('https://') || r.url.startsWith('http://'))
}

async function handler(req: Request): Promise<Response> {
  let giveBack: (() => Promise<void>) | undefined
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const key = process.env.TAVILY_API_KEY?.trim()
    if (!key) throw new HttpError(501, 'not_configured', 'TAVILY_API_KEY is not set.')
    const { brandKitId } = await readJson<{ brandKitId?: unknown }>(req)
    const kitId = uuidOrNull(brandKitId)
    if (!kitId) throw new HttpError(400, 'invalid_input', 'Which brand kit?')

    const { data: membership } = await adminClient().from('memberships').select('pro_until').eq('user_id', caller.id).maybeSingle()
    const proUntil = (membership as { pro_until?: string | null } | null)?.pro_until
    if (!proUntil || Date.parse(proUntil) <= Date.now()) throw new HttpError(403, 'pro_only', 'Searching for similar businesses is a Pro feature.')

    const kit = await loadKit(caller, kitId)
    if (kit.user_id !== caller.id) throw new HttpError(403, 'forbidden', 'Only the owner can search for this brand.')
    giveBack = (await takeQuota(caller.id, 'copy')).giveBack

    const offering = kit.business_json?.offering?.slice(0, 160) || kit.vibe_summary.slice(0, 160)
    const place = kit.business_json?.location?.slice(0, 80) ?? ''
    const [similar, sameName] = await Promise.all([search(`${offering} ${place}`.trim(), key), search(`"${kit.brand_name.slice(0, 80)}" ${place}`.trim(), key)])
    return json({ similar, sameName })
  } catch (error) {
    await giveBack?.().catch(() => {})
    return fail(error)
  }
}

export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime drops a default export's returned Response; named methods get the Web `Request`. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
