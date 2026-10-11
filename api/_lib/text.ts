/**
 * Text generation on OpenRouter's free models, asked for JSON and held to a schema.
 *
 * OpenRouter speaks OpenAI's chat-completions shape, so this is one POST with a `json_schema`
 * response format, routed only to providers that honour it. The key travels in the
 * Authorization header, never the URL.
 *
 * Candidates are tried in order and the first that answers wins — a busy or retired model
 * should cost a fallback, not a failed kit.
 *
 * ponytail: free models cap the whole account at 50 requests a day and 20 a minute (1,000 a
 * day once $10 of credits has ever been bought). Enough for a demo, not for a launch: add
 * credits, or a paid model at the head of TEXT_MODELS, when real traffic comes.
 */

declare const process: { env: Record<string, string | undefined> }

import { HttpError } from './server.js'

/** From openrouter.ai/api/v1/models on 2026-10-11: the free models that take a JSON schema. Strongest first. */
export const TEXT_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'dots-studio/dots-3-note-preview:free', 'apodex/apodex-1.1-mini:free']

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Per attempt, and the default for all of them together. Routes run under a 150 second
 * ceiling (vercel.json) and may make two calls, so a route passes its own `deadline` and
 * every attempt is cut to fit what is left of it — a request Vercel kills mid-flight is
 * a request spent for a 504.
 */
const ATTEMPT_MS = 60_000
const BUDGET_MS = 140_000
/** Not worth starting an attempt with less than this left. */
const MIN_ATTEMPT_MS = 4_000

export const textKey = () => process.env.OPENROUTER_API_KEY?.trim() || ''

export const textModels = () => TEXT_MODELS

/**
 * The schema shape the Studio's schemas are written in: an OpenAPI subset with upper-case
 * type names. `toJsonSchema` lowers it to the JSON Schema the chat endpoint takes.
 */
export interface TextSchema {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN'
  description?: string
  properties?: Record<string, TextSchema>
  required?: string[]
  items?: TextSchema
  enum?: string[]
  minItems?: number
  maxItems?: number
}

export function toJsonSchema(schema: TextSchema): Record<string, unknown> {
  const { type, properties, items, ...rest } = schema
  return {
    ...rest,
    type: type.toLowerCase(),
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toJsonSchema(v)])) } : {}),
    ...(items ? { items: toJsonSchema(items) } : {}),
  }
}

/**
 * Not worth trying the next model for: a bad key (401/403) or a negative balance (402). Every
 * candidate shares the key and the account, so each would fail the same way, only slower.
 */
const sharedFailure = (status: number) => status === 401 || status === 402 || status === 403

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } | string; message?: unknown }
    const message = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message)
    return typeof message === 'string' ? message.slice(0, 300) : ''
  } catch {
    return ''
  }
}

interface ChatReply {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
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
export async function generateJson<T = unknown>(input: { system: string; prompt: string; schema: TextSchema; deadline?: number }): Promise<JsonResult<T>> {
  const key = textKey()
  if (!key) throw new HttpError(501, 'not_configured', 'OPENROUTER_API_KEY is not set.')

  const deadline = input.deadline ?? Date.now() + BUDGET_MS
  // Every attempt and why it failed. The last failure alone hides the one that mattered.
  const failures: string[] = []
  const fail = (model: string, status: number, detail: string) => failures.push(`${model} ${status}${detail ? `: ${detail.slice(0, 160)}` : ''}`)

  for (const model of textModels()) {
    const left = deadline - Date.now()
    if (left < MIN_ATTEMPT_MS) break
    const started = Date.now()

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, left)),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: toJsonSchema(input.schema) } },
          // Only to a provider that honours the schema, rather than one that ignores it.
          provider: { require_parameters: true },
          // All three reason before answering; "low" keeps a brand kit inside an attempt's time.
          reasoning: { effort: 'low' },
          // Generous on purpose: the reasoning counts against this same ceiling. Too low, and
          // the JSON is cut off mid-object with finish_reason "length".
          max_tokens: 8192,
        }),
      })
    } catch {
      // A timeout or a dropped connection says nothing about the next model.
      fail(model, 504, `timeout after ${Math.round((Date.now() - started) / 1000)}s`)
      continue
    }

    if (!res.ok) {
      fail(model, res.status, await errorDetail(res))
      if (sharedFailure(res.status)) break
      continue
    }

    const reply = (await res.json().catch(() => ({}))) as ChatReply
    const choice = reply.choices?.[0]
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      throw new HttpError(422, 'blocked', 'The request was refused by the model’s safety filter. Try wording it differently.')
    }

    let data: T
    try {
      data = JSON.parse(choice?.message?.content ?? '') as T
    } catch {
      fail(model, 502, choice?.finish_reason === 'length' ? 'truncated' : 'unparseable')
      continue
    }
    // An answer that came only after others failed came slowly, and the logs should say why.
    if (failures.length) console.warn(`[text] ${model} answered after: ${failures.join(' | ')}`)
    return { data, model }
  }

  console.warn(`[text] no model answered: ${failures.join(' | ') || 'no attempt'}`)
  throw new HttpError(502, 'upstream', `No model answered. ${failures.join('; ') || 'Nothing was tried.'}`)
}
