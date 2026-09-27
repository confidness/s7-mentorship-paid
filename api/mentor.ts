/**
 * The course advisor, answered by a model instead of the local search engine.
 *
 * This runs on Vercel, not in the browser, for one reason: the API key. Anything the client
 * bundle can read, a student can read in devtools, so the key lives in the server's environment
 * and never leaves it. The browser sends a question and gets an answer — it never sees a key.
 *
 * If ANTHROPIC_API_KEY is not set, this returns 501 and the client quietly falls back to the
 * built-in knowledge base, so the mentor keeps working with no server at all.
 */

/* This file runs on the server, not in the browser, and the project has no Node types.
   Declaring just the one thing it reads keeps the dependency list unchanged. */
declare const process: { env: Record<string, string | undefined> }

import { fail, requireUser } from './_lib/server'

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Free models to try, in order, until one answers.
 *
 * A single hardcoded id is the wrong shape for this. OpenRouter's free tier is a moving target —
 * a model goes paid, another takes its place — and the failure is a 404 that no amount of
 * redeploying fixes, at the worst possible moment. Trying the next candidate costs one extra
 * round trip on a day when the first has retired, and nothing at all on every other day.
 *
 * OPENROUTER_MODEL still wins outright when set, because someone naming a model means it.
 */
const OPENROUTER_MODELS = [
  // A router, not a model: OpenRouter picks from whatever is free at the moment. The slug itself
  // does not rot, which is the whole problem with naming a model, so it goes first.
  'openrouter/free',
  // Concrete backups, checked against openrouter.ai/api/v1/models on 2026-09-19. These will go
  // stale eventually — the router above is what is meant to carry it when they do.
  'deepseek/deepseek-v4-flash-0731:free',
  'google/gemma-4-31b-it:free',
  'qwen/qwen3.8-27b:free',
  'z-ai/glm-5.2:free',
]

/** Reasons to try the next candidate rather than give up: this model, not this key or this quota. */
function modelUnavailable(status: number, detail: string) {
  return status === 404 || /unavailable for free|no endpoints|not a valid model|model not found|is not available/i.test(detail)
}

/** Long enough for an explanation and a short snippet, short enough to stay quick and cheap. */
const MAX_TOKENS = 700

const LANGUAGE = { kk: 'Kazakh', ru: 'Russian', en: 'English' } as const
type Locale = keyof typeof LANGUAGE

/**
 * Which service answers, decided by which key is present.
 *
 * OpenRouter wins when both are set, because it is the one someone adds deliberately after
 * Anthropic has refused them. Neither being set is a normal state, not an error: the client has
 * its own knowledge base and never shows a failure to a student.
 */
function pickProvider() {
  const openrouter = process.env.OPENROUTER_API_KEY?.trim()
  if (openrouter) {
    const pinned = process.env.OPENROUTER_MODEL?.trim()
    return { name: 'openrouter' as const, key: openrouter, models: pinned ? [pinned] : OPENROUTER_MODELS }
  }
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim()
  if (anthropic) return { name: 'anthropic' as const, key: anthropic, models: [ANTHROPIC_MODEL] }
  return null
}

/**
 * The teaching rule is enforced here rather than asked for politely in passing: this mentor
 * exists to get a student unstuck, and handing over the finished project would defeat the
 * lesson it is attached to.
 */
function systemPrompt(locale: Locale, lessonTitle?: string, courseTitle?: string, code?: string, catalogue?: string[]) {
  return [
    'You are the course advisor inside S7 Mentorship, an open marketplace where anyone can publish a course and mentors review the work students hand in.',
    `Answer entirely in ${LANGUAGE[locale]}. Keep course titles exactly as they are written — do not translate them.`,
    '',
    'WHAT YOU ARE FOR:',
    '- Helping someone work out what field to learn, and then which specific published course to start with.',
    '- Two questions, and the first one is usually the real one. Somebody who says "I want to earn more" has not chosen a field yet; recommending a course before that is answering a question they did not ask.',
    '- When the field is already clear, go straight to the courses.',
    '',
    'THE CATALOGUE IS THE ONLY THING THAT EXISTS:',
    '- Recommend ONLY from the list below. Never invent a course, a title, a price or a teacher, and never describe a course that "would be good" if it existed.',
    '- If nothing in the list fits, say so plainly and say what the catalogue does cover. An honest gap is useful; a fabricated match is not.',
    '- Put the ids of the courses you actually recommend in "recommendations", most suitable first, at most three. Ids only, copied exactly.',
    '- Weigh what they told you: a beginner needs the shorter one, somebody with no money needs the free one, somebody with an evening needs the one that fits an evening. Say which of those you weighed.',
    '',
    'STYLE:',
    '- Two or three short paragraphs at most. No headings, no bullet lists unless you are genuinely enumerating options.',
    '- Concrete and calm. No cheerleading, no "exciting journey". Name the trade-off between the options rather than praising all of them.',
    '- Use **bold** for the one thing that matters most. Nothing else is formatted.',
    '',
    'CONTEXT:',
    catalogue && catalogue.length
      ? `- Published courses, as "id | title | field | format | length | price | summary":\n${catalogue.map((line) => `  ${line}`).join('\n')}`
      : '- The catalogue is empty. Say so, and that anyone can publish here, including them.',
    lessonTitle ? `- They are currently looking at "${lessonTitle}"${courseTitle ? ` in "${courseTitle}"` : ''}.` : '',
    code && code.trim() ? `- They also shared this:\n\`\`\`\n${code.slice(0, 2000)}\n\`\`\`` : '',
    '',
    'OUTPUT — reply with JSON only, no prose around it, matching exactly:',
    '{"text": string, "question": string, "followUps": string[], "recommendations": string[], "code": null}',
    '- "text": the advice itself. Use \\n\\n between paragraphs.',
    '- "question": one question back that narrows the choice — budget, time, what they want to be able to do. Never empty.',
    '- "followUps": two or three things they might ask next, each under 45 characters.',
    '- "recommendations": ids from the catalogue above, at most three, most suitable first. Empty array when nothing fits.',
    '- "code": always null. This assistant recommends courses; it does not write code.',
  ]
    .filter(Boolean)
    .join('\n')
}

interface Body {
  question?: string
  locale?: string
  lessonTitle?: string
  courseTitle?: string
  code?: string
  /** Pre-ranked catalogue lines from src/lib/discovery.ts. The model chooses among these. */
  catalogue?: string[]
}

export default async function handler(req: Request): Promise<Response> {
  // A GET is a health check: it says whether a key is configured without spending one.
  // Anything other than JSON coming back here means the function itself is not deployed.
  if (req.method === 'GET') {
    const health = pickProvider()
    return json(
      {
        ok: true,
        configured: Boolean(health),
        provider: health?.name ?? null,
        // Not a secret, and the thing most likely to be wrong on OpenRouter, whose free ids retire
        // without notice. 'auto' means the built-in candidate list rather than a pinned choice.
        model: health ? (health.models.length > 1 ? `auto (${health.models.length})` : health.models[0]) : null,
        // Whether one is set, never what it is. It separates "the variable never arrived" from
        // "it arrived and Anthropic still refuses it", which need different things done to them.
        workspace: Boolean(process.env.ANTHROPIC_WORKSPACE_ID?.trim()),
      },
      200,
    )
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  /**
   * Signed in, or no answer.
   *
   * This was the one route in api/ that asked nobody who they were. The header above is
   * careful that the key never reaches the browser, and that is still true — but a POST here
   * spends it, and an endpoint that spends a key for any caller on the internet is the same
   * bill by a slower route. A scraper finding this path could run an account to zero
   * overnight, and OpenRouter's free tier only caps the damage until the model is paid.
   *
   * The failure is deliberately the same 401 every other route gives, and the client already
   * treats any failure here as a reason to fall back to the local knowledge base.
   */
  try {
    await requireUser(req)
  } catch (error) {
    return fail(error)
  }

  // Keys are trimmed inside pickProvider: a value pasted into a dashboard field routinely carries
  // a trailing newline, and a header holding one is rejected before the request is ever sent.
  const provider = pickProvider()
  // No key configured is a normal state, not a failure — the client has a local fallback.
  if (!provider) return json({ error: 'not_configured' }, 501)

  // Optional, and only an organisation-level Anthropic key needs it.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return json({ error: 'bad_request' }, 400)
  if (question.length > 2000) return json({ error: 'too_long' }, 413)

  const locale: Locale = body.locale === 'kk' || body.locale === 'ru' ? body.locale : 'en'

  // Capped, because the prompt is paid for by the token and the client already ranked them.
  const catalogue = Array.isArray(body.catalogue) ? body.catalogue.filter((line) => typeof line === 'string').slice(0, 20).map((line) => line.slice(0, 300)) : undefined
  // Untrusted JSON: a non-string `code` would throw on .slice, and every character is paid for.
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined)
  const system = systemPrompt(locale, text(body.lessonTitle, 200), text(body.courseTitle, 200), text(body.code, 2000), catalogue)
  const openrouter = provider.name === 'openrouter'

  let status = 0
  let detail = ''
  // Naming what was actually attempted settles a question a status code cannot: whether the
  // deployment is running the model list you think it is.
  const tried: string[] = []

  try {
    // One candidate on Anthropic, and on OpenRouter as many as it takes to find one still free.
    for (const model of provider.models) {
      tried.push(model)
      const upstream = await fetch(openrouter ? OPENROUTER_ENDPOINT : ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: openrouter
          ? {
              'content-type': 'application/json',
              authorization: `Bearer ${provider.key}`,
              // Optional on OpenRouter and used only for its public rankings. The deployment's own
              // origin is the honest value, and there is nothing private in it.
              'HTTP-Referer': req.headers.get('origin') ?? 'https://s7-mentorship.vercel.app',
              'X-Title': 'S7 Mentorship',
            }
          : {
              'content-type': 'application/json',
              'x-api-key': provider.key,
              'anthropic-version': '2023-06-01',
              // An organisation-level key belongs to no workspace, and Anthropic refuses it with a
              // 400 until one is named. A key created inside a workspace carries that itself and
              // needs no header, so this is set only when there is something to set.
              ...(workspace ? { 'anthropic-workspace-id': workspace } : {}),
            },
        body: JSON.stringify(
          openrouter
            ? {
                model,
                max_tokens: MAX_TOKENS,
                // No assistant prefill here. It is an Anthropic guarantee, and OpenRouter routes
                // to whichever provider is cheapest today — not all of them honour a partial turn.
                // parseReply and asProse cover a model that answers in prose instead.
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: question },
                ],
              }
            : {
                model,
                max_tokens: MAX_TOKENS,
                system,
                // The opening brace is put in the model's mouth: it continues the JSON instead of
                // deciding whether to write any. Asking nicely in the prompt is not a guarantee.
                messages: [
                  { role: 'user', content: question },
                  { role: 'assistant', content: '{' },
                ],
              },
        ),
      })

      if (!upstream.ok) {
        // Rate limit, bad key, upstream outage — all the same to the student: use the local base.
        // The reason is carried anyway, because the alternative is guessing at a status code from
        // the outside. It is an API error string and never contains the key.
        status = upstream.status
        detail = await errorMessage(upstream)
        // A retired free model is worth stepping past. A bad key or an exhausted quota is not:
        // every remaining candidate would fail the same way, slowly.
        if (openrouter && modelUnavailable(status, detail)) continue
        break
      }

      const data = (await upstream.json()) as {
        content?: { type: string; text?: string }[]
        choices?: { message?: { content?: string } }[]
        error?: { message?: string; code?: number }
      }
      // OpenRouter can answer 200 with the failure in the body instead of the status.
      if (openrouter && data.error?.message) {
        status = data.error.code ?? 200
        detail = data.error.message.slice(0, 300)
        if (modelUnavailable(status, detail)) continue
        break
      }

      const raw = openrouter ? (data.choices?.[0]?.message?.content ?? '') : (data.content?.find((c) => c.type === 'text')?.text ?? '')
      // The reply is a continuation of '{', so the brace has to be put back before parsing. Trying
      // the raw text first costs nothing and covers a model that repeated the brace anyway.
      const parsed = parseReply(raw) ?? (openrouter ? null : parseReply('{' + raw)) ?? asProse(raw)
      if (!parsed) {
        status = 502
        detail = 'unparseable'
        continue
      }

      // Which model actually answered, so the diagnostic can name it. Not a secret.
      return json({ ...parsed, model }, 200)
    }

    return json({ error: 'upstream', status, detail, tried }, 502)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

/**
 * Pulls Anthropic's own explanation out of a failed response.
 *
 * A bare status is not enough to act on: 400 alone covers a malformed request and an account with
 * no credit left, and those need opposite fixes. Reading the body costs nothing at this point,
 * since the response is being discarded either way.
 */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    const msg = body?.error?.message
    return typeof msg === 'string' ? msg.slice(0, 300) : ''
  } catch {
    return ''
  }
}

/**
 * Last resort: a model that answered in prose still answered.
 *
 * Discarding that over a formatting rule is how a correctly configured deployment ends up looking
 * broken — the student sees the offline fallback and concludes the AI is down. Half-written JSON
 * is different; it would read as gibberish, so that is still refused.
 */
function asProse(raw: string) {
  const text = raw.trim()
  if (!text || text.startsWith('{') || text.startsWith('"')) return null
  return { text, question: '', followUps: [] as string[] }
}

/** The model is asked for bare JSON, but a stray fence or preamble should not cost us the answer. */
export function parseReply(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      text?: unknown
      question?: unknown
      followUps?: unknown
      recommendations?: unknown
      code?: { language?: unknown; source?: unknown; caption?: unknown } | null
    }
    if (typeof obj.text !== 'string' || !obj.text.trim()) return null
    return {
      text: obj.text,
      question: typeof obj.question === 'string' ? obj.question : '',
      followUps: Array.isArray(obj.followUps) ? obj.followUps.filter((f): f is string => typeof f === 'string').slice(0, 3) : [],
      // Ids only, and the client checks them against its own catalogue before rendering any
      // of them — an id this parser passes through is not yet a course that exists.
      recommendations: Array.isArray(obj.recommendations) ? obj.recommendations.filter((id): id is string => typeof id === 'string').slice(0, 3) : [],
      code:
        obj.code && typeof obj.code.source === 'string' && obj.code.source.trim()
          ? {
              language: typeof obj.code.language === 'string' ? obj.code.language : 'text',
              source: obj.code.source,
              caption: typeof obj.code.caption === 'string' ? obj.code.caption : '',
            }
          : undefined,
    }
  } catch {
    return null
  }
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const config = { runtime: 'edge' }
