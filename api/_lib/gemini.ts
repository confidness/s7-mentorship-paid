/**
 * Google Gemini, asked for JSON and held to a schema.
 *
 * Direct REST rather than an SDK: one endpoint, one header, and nothing new in the dependency
 * list. The key travels in `x-goog-api-key`, never in the URL — a query string ends up in
 * access logs and error reports, a header does not.
 *
 * Free-tier Flash models are a moving target. Gemini 1.5 Flash, the model this was first
 * specified against, has been retired; 2.5 Flash is closed to new projects. A single
 * hardcoded id fails with a 404 that no redeploy fixes, so — the same shape the old course
 * advisor used for OpenRouter — candidates are tried in order and the first that answers
 * wins. GEMINI_MODEL pins one and is never substituted.
 */

declare const process: { env: Record<string, string | undefined> }

import { HttpError } from './server.js'

/** Checked against ai.google.dev/gemini-api/docs/models on 2026-10-09. Newest first. */
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash']

const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

/**
 * Per attempt, and the default for all of them together. Routes run under a 150 second
 * ceiling (vercel.json) and may make two calls, so a route passes its own `deadline` and
 * every attempt is cut to fit what is left of it — a request Vercel kills mid-flight is
 * quota spent for a 504.
 *
 * A minute per attempt, not less. In production gemini-3.8-flash took longer than 25 seconds
 * over a brand kit's schema while the next model answered 503 "high demand"; a shorter limit
 * gave up on a model that would have answered and fell through to ones that could not.
 */
const ATTEMPT_MS = 60_000
const BUDGET_MS = 140_000
/** Not worth starting an attempt with less than this left. */
const MIN_ATTEMPT_MS = 4_000

export const geminiKey = () => process.env.GEMINI_API_KEY?.trim() || ''

export function geminiModels(): string[] {
  const pinned = process.env.GEMINI_MODEL?.trim()
  return pinned ? [pinned] : GEMINI_MODELS
}

/** The OpenAPI subset Gemini's `responseSchema` accepts, with its upper-case type names. */
export interface GeminiSchema {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN'
  description?: string
  properties?: Record<string, GeminiSchema>
  required?: string[]
  items?: GeminiSchema
  enum?: string[]
  minItems?: number
  maxItems?: number
}

/**
 * Worth trying the next model for: this one is gone, busy, or out of free quota. Free-tier
 * limits are per model, so a 429 on one says nothing about the next.
 *
 * A bad key is not on this list. Google answers it with a 400 "API key not valid", and every
 * remaining candidate would fail the same way, only slower.
 */
function tryNext(status: number, detail: string) {
  // "thinking": a model refusing the thinking level it was sent. The next may take it, or
  // be an older one that is not sent one at all.
  return status === 404 || status === 429 || status === 503 || /not found|not supported|is not available|overloaded|quota|thinking/i.test(detail)
}

/**
 * Gemini 3 models think before answering, at "medium" by default — enough, on a brand kit's
 * schema, to run past an attempt's time limit. "low" is what Google recommends for latency.
 * Only the 3.x ids get it: older models know a different field and refuse this one.
 */
function thinkingFor(model: string): { thinkingConfig?: { thinkingLevel: 'low' } } {
  return /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    return typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : ''
  } catch {
    return ''
  }
}

interface GeminiReply {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

export interface JsonResult<T> {
  data: T
  model: string
}

/**
 * One structured request. Returns the parsed object and the model that wrote it.
 *
 * Throws an HttpError the route can pass straight through: 501 with no key, 422 when the
 * request was refused on safety grounds (rephrasing helps; retrying does not), 502 when no
 * candidate produced anything usable — carrying what was tried, which is the first question
 * anybody debugging this will ask.
 */
export async function generateJson<T = unknown>(input: { system: string; prompt: string; schema: GeminiSchema; temperature?: number; deadline?: number }): Promise<JsonResult<T>> {
  const key = geminiKey()
  if (!key) throw new HttpError(501, 'not_configured', 'GEMINI_API_KEY is not set.')

  const deadline = input.deadline ?? Date.now() + BUDGET_MS
  // Every attempt and why it failed. The last failure alone hides the one that mattered: a
  // retired fallback answering 404 says nothing about why the model before it did not answer.
  const failures: string[] = []
  const fail = (model: string, status: number, detail: string) => failures.push(`${model} ${status}${detail ? `: ${detail.slice(0, 160)}` : ''}`)

  for (const model of geminiModels()) {
    const left = deadline - Date.now()
    if (left < MIN_ATTEMPT_MS) break
    const started = Date.now()

    let res: Response
    try {
      res = await fetch(endpoint(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, left)),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: input.schema,
            temperature: input.temperature ?? 0.9,
            // Generous on purpose: newer Flash models think before they answer, and the
            // thinking is billed against this same ceiling. Too low, and the JSON is cut off
            // mid-object with finishReason MAX_TOKENS.
            maxOutputTokens: 8192,
            ...thinkingFor(model),
          },
        }),
      })
    } catch {
      // A timeout or a dropped connection says nothing about the next model.
      fail(model, 504, `timeout after ${Math.round((Date.now() - started) / 1000)}s`)
      continue
    }

    if (!res.ok) {
      const detail = await errorDetail(res)
      fail(model, res.status, detail)
      if (tryNext(res.status, detail)) continue
      break
    }

    const reply = (await res.json().catch(() => ({}))) as GeminiReply
    const candidate = reply.candidates?.[0]
    if (reply.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
      throw new HttpError(422, 'blocked', 'The request was refused by the model’s safety filter. Try wording it differently.')
    }

    const raw = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('')
    let data: T
    try {
      data = JSON.parse(raw) as T
    } catch {
      fail(model, 502, candidate?.finishReason === 'MAX_TOKENS' ? 'truncated' : 'unparseable')
      continue
    }
    // An answer that came only after others failed came slowly, and the logs should say why.
    if (failures.length) console.warn(`[gemini] ${model} answered after: ${failures.join(' | ')}`)
    return { data, model }
  }

  console.warn(`[gemini] no model answered: ${failures.join(' | ') || 'no attempt'}`)
  throw new HttpError(502, 'upstream', `No model answered. ${failures.join('; ') || 'Nothing was tried.'}`)
}
