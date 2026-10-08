/**
 * End-to-end check of the AI mentor path, with Anthropic stubbed out.
 *
 * The question this answers is narrow and was worth asking: does what the browser sends actually
 * arrive at Anthropic in the shape the API expects, and does the answer make it all the way back
 * without the offline fallback stepping on it. A key is never needed to prove that — only a stub
 * standing where the real endpoint does, recording exactly what it was handed.
 */

import handler, { parseReply, dailyLimitFromEnv, DEFAULT_AI_DAILY_LIMIT } from '../api/mentor.ts'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

interface Captured {
  url: string
  method?: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let captured: Captured | null = null

/** Records every call in order, for the cases where more than one goes out. */
let calls: Captured[] = []

/**
 * The route now refuses an anonymous POST, so every stub has to be able to answer Supabase too.
 *
 * `/api/mentor` spends an API key, and until it asked who was calling, anyone who found the
 * path could spend it. Identifying the caller means one round trip to Supabase before the
 * model is ever reached — which shows up here as a second fetch these stubs have to expect,
 * and as the reason the checks below send a bearer token at all.
 */
process.env.SUPABASE_URL = 'https://stub.supabase.test'
process.env.SUPABASE_ANON_KEY = 'anon-not-a-real-key'

const isAuthCall = (url: string) => url.includes('/auth/v1/user')

/** A real Response, because the Supabase SDK reads more of one than the stubs below fake. */
const authOk = () =>
  new Response(JSON.stringify({ id: 'stub-user-id', aud: 'authenticated', role: 'authenticated', email: 'student@example.test' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/**
 * The daily allowance is a second Supabase round trip, made through the caller's own client.
 *
 * It has to be answered by every stub below, or its body — `{"daily_limit":40}`, which parses as
 * JSON — would be recorded as a call to the model. `quotaMode` is what the database says:
 * a unit left, no unit left, a migration not yet applied (said in Postgres's words and in
 * PostgREST's), or a database that is simply broken.
 */
type QuotaMode = 'allow' | 'deny' | 'no-function-postgrest' | 'no-function-postgres' | 'broken'
let quotaMode: QuotaMode = 'allow'
let rpcCalls: { headers: Headers; body: Record<string, unknown> }[] = []

const isRpcCall = (url: string) => url.includes('/rest/v1/rpc/consume_ai_quota')

const rpcJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function rpcReply(init?: RequestInit): Response {
  rpcCalls.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
  switch (quotaMode) {
    case 'allow':
      return rpcJson(true)
    case 'deny':
      return rpcJson(false)
    case 'no-function-postgrest':
      return rpcJson({ code: 'PGRST202', details: 'Searched for the function public.consume_ai_quota', hint: null, message: 'Could not find the function public.consume_ai_quota(daily_limit) in the schema cache' }, 404)
    case 'no-function-postgres':
      return rpcJson({ code: '42883', details: null, hint: null, message: 'function public.consume_ai_quota(integer) does not exist' }, 404)
    case 'broken':
      return rpcJson({ code: 'XX000', details: null, hint: null, message: 'internal error' }, 500)
  }
}

/** Anything addressed to Supabase rather than to a model. Null means the call is not one of theirs. */
const supabaseReply = (url: string, init?: RequestInit): Response | null => (isAuthCall(url) ? authOk() : isRpcCall(url) ? rpcReply(init) : null)

/**
 * Replies differently to each successive call, which is how a model fallthrough becomes visible.
 * Each entry is one upstream attempt, in order; the last one repeats if the code asks again.
 */
function stubSequence(replies: { status?: number; text?: string; raw?: unknown }[]) {
  calls = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const supabase = supabaseReply(String(url), init)
    if (supabase) return supabase
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ url: String(url), method: init.method, headers: init.headers as Record<string, string>, body })
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.raw ?? { content: [{ type: 'text', text: reply.text ?? '' }] },
    }
  }) as unknown as typeof fetch
}

/** Stands in for api.anthropic.com and records the call verbatim. */
function stubAnthropic(reply: { status?: number; text?: string; raw?: unknown }) {
  captured = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const supabase = supabaseReply(String(url), init)
    if (supabase) return supabase
    captured = {
      url: String(url),
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    }
    const status = reply.status ?? 200
    const payload = reply.raw ?? { content: [{ type: 'text', text: reply.text ?? '' }] }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }
  }) as unknown as typeof fetch
}

const post = (body: unknown) =>
  handler(
    new Request('https://example.test/api/mentor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer stub-token' },
      body: JSON.stringify(body),
    }),
  )

/** The same call with nobody behind it. */
const postAnonymous = (body: unknown) =>
  handler(new Request('https://example.test/api/mentor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

const ASK = {
  question: 'I want to change career, where do I start',
  locale: 'ru',
  lessonTitle: 'Ultrasonic distance',
  courseTitle: 'Arduino',
  code: 'int t = 9;',
  catalogue: ['abc-1 | Figma from zero | design | practice | ~40 min | free | Build a first screen.', 'abc-2 | Python basics | programming | coding | ~90 min | 12.00 USD | Loops and functions.'],
}

const GOOD = JSON.stringify({
  text: `Сначала проверь питание.${NL}${NL}Потом TRIG.`,
  question: 'Какое напряжение на VCC?',
  followUps: ['Как читать echo', 'Что такое pulseIn'],
  code: { language: 'cpp', source: 'pinMode(9, OUTPUT);', caption: 'Пин на выход' },
})

async function run() {
  console.log('AI mentor delivery')

  // --- nobody signed in, nobody's key spent -------------------------------------------------
  // The failure this guards is a bill rather than a leak: the key stays on the server either
  // way, but an endpoint that spends it for any caller on the internet is the same money.
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  stubAnthropic({ text: GOOD })
  const refused = await postAnonymous(ASK)
  check('an anonymous question is refused', refused.status === 401, refused.status)
  check('and never reaches the model', captured === null)

  // --- the request actually leaves, addressed correctly -------------------------------------
  stubAnthropic({ text: GOOD })
  let res = await post(ASK)
  let out = (await res.json()) as Record<string, unknown>
  const c = captured as Captured | null

  check('upstream was called at all', c !== null)
  check('endpoint is the Messages API', c?.url === 'https://api.anthropic.com/v1/messages', c?.url)
  check('method is POST', c?.method === 'POST')
  check('key travels in x-api-key', c?.headers['x-api-key'] === 'test-key-not-a-real-one', c?.headers)
  check('api version pinned', c?.headers['anthropic-version'] === '2023-06-01')
  check('no workspace header when none is configured', c?.headers['anthropic-workspace-id'] === undefined, c?.headers)
  check('model is Haiku 4.5', c?.body.model === 'claude-haiku-4-5-20251001', c?.body.model)
  check('max_tokens is set', typeof c?.body.max_tokens === 'number')

  const messages = c?.body.messages as { role: string; content: string }[]
  check('the student question is the user turn', messages?.[0]?.role === 'user' && messages[0].content === ASK.question, messages?.[0])

  const system = String(c?.body.system ?? '')
  check('locale reaches the prompt', system.includes('Russian'), system.slice(0, 120))
  check('lesson reaches the prompt', system.includes('Ultrasonic distance'))
  check('course reaches the prompt', system.includes('Arduino'))
  check('editor code reaches the prompt', system.includes('int t = 9;'))
  check('the no-invention rule is in the prompt', system.includes('Never invent a course'))
  check('the catalogue reaches the prompt', system.includes('abc-1 | Figma from zero'), system.slice(-400))
  check('and its prices come with it', system.includes('12.00 USD'))

  // --- and the answer arrives back intact ----------------------------------------------------
  check('status is 200', res.status === 200, res.status)
  check('text survives the round trip', out.text === `Сначала проверь питание.${NL}${NL}Потом TRIG.`, out.text)
  check('question survives', out.question === 'Какое напряжение на VCC?', out.question)
  check('followUps survive', Array.isArray(out.followUps) && out.followUps.length === 2, out.followUps)
  check('code survives', (out.code as { source?: string })?.source === 'pinMode(9, OUTPUT);', out.code)

  // An organisation-level key is refused until a workspace is named, so the header must go out.
  process.env.ANTHROPIC_WORKSPACE_ID = '  wrkspc_test123' + NL
  stubAnthropic({ text: GOOD })
  await post(ASK)
  check('workspace header is sent when configured', (captured as Captured | null)?.headers['anthropic-workspace-id'] === 'wrkspc_test123', (captured as Captured | null)?.headers)

  // A key pasted into a dashboard field arrives with whitespace; a header holding it is rejected.
  process.env.ANTHROPIC_API_KEY = ' test-key-not-a-real-one' + NL
  stubAnthropic({ text: GOOD })
  await post(ASK)
  check('pasted whitespace is trimmed off the key', (captured as Captured | null)?.headers['x-api-key'] === 'test-key-not-a-real-one', (captured as Captured | null)?.headers)
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  delete process.env.ANTHROPIC_WORKSPACE_ID

  // --- shapes the model really produces ------------------------------------------------------
  stubAnthropic({ text: '```json' + NL + GOOD + NL + '```' })
  out = (await (await post(ASK)).json()) as Record<string, unknown>
  check('fenced JSON still parses', typeof out.text === 'string' && String(out.text).includes('питание'), out)

  stubAnthropic({ text: 'Вот ответ:' + NL + GOOD })
  out = (await (await post(ASK)).json()) as Record<string, unknown>
  check('prefaced JSON still parses', typeof out.text === 'string' && String(out.text).includes('питание'), out)

  // A prefilled '{' comes back as a continuation, without the brace the model was handed.
  stubAnthropic({ text: GOOD.slice(1) })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('continuation of a prefilled brace parses', res.status === 200 && String(out.text).includes('питание'), out)

  // Plain prose is still a real answer and must not be thrown away.
  stubAnthropic({ text: 'Проверь питание датчика, затем пин TRIG.' })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('prose answer is kept, not discarded', res.status === 200 && String(out.text).includes('Проверь питание'), { status: res.status, out })

  // --- failures must be quiet, and must not be mistaken for success ---------------------------
  stubAnthropic({ status: 401 })
  res = await post(ASK)
  check('bad key is 502, not 200', res.status === 502, res.status)

  // A bare status cannot separate an empty wallet from a malformed request; the message can.
  stubAnthropic({ status: 400, raw: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('upstream status is reported', out.status === 400, out)
  check('upstream reason is carried through', String(out.detail).includes('credit balance'), out)
  check('the reason never carries the key', !JSON.stringify(out).includes('test-key-not-a-real-one'), out)

  stubAnthropic({ status: 429 })
  check('rate limit is 502', (await post(ASK)).status === 502)

  stubAnthropic({ raw: { content: [] } })
  check('empty content is 502', (await post(ASK)).status === 502)

  // The model is unreachable; Supabase still is, or the reply would be 401 and this would be
  // checking the wrong thing.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const supabase = supabaseReply(String(url), init)
    if (supabase) return supabase
    throw new Error('network down')
  }) as unknown as typeof fetch
  check('network failure is 502', (await post(ASK)).status === 502)

  // --- the unconfigured deployment, which is the state that matters right now ------------------
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENROUTER_API_KEY
  captured = null
  stubAnthropic({ text: GOOD })
  res = await post(ASK)
  check('no key is 501', res.status === 501, res.status)
  check('no key spends no upstream call', captured === null)

  const health = await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))
  const hb = (await health.json()) as Record<string, unknown>
  check('health reports missing key', hb.configured === false, hb)
  check('health never returns a key', !JSON.stringify(hb).includes('test-key'), hb)

  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  const health2 = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('health reports a configured key', health2.configured === true, health2)
  check('health reports no workspace id when unset', health2.workspace === false, health2)

  process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test123'
  const health3 = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('health reports a configured workspace id', health3.workspace === true, health3)
  check('health never returns the workspace id itself', !JSON.stringify(health3).includes('wrkspc_test123'), health3)
  delete process.env.ANTHROPIC_WORKSPACE_ID
  check('health still never returns the key', !JSON.stringify(health2).includes('test-key-not-a-real-one'), health2)

  // --- OpenRouter, which is what runs when there is no money for an Anthropic balance ----------
  delete process.env.ANTHROPIC_API_KEY
  process.env.OPENROUTER_API_KEY = ' or-test-key' + NL
  const orReply = { choices: [{ message: { content: GOOD } }] }
  stubAnthropic({ raw: orReply })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  const o = captured as Captured | null

  check('openrouter endpoint is used', o?.url === 'https://openrouter.ai/api/v1/chat/completions', o?.url)
  check('key travels as a bearer token', o?.headers.authorization === 'Bearer or-test-key', o?.headers)
  check('no anthropic headers leak across', o?.headers['x-api-key'] === undefined && o?.headers['anthropic-version'] === undefined, o?.headers)
  const isFree = (m: unknown) => String(m).endsWith(':free') || String(m) === 'openrouter/free'
  check('a free model is the default', isFree(o?.body.model), o?.body.model)

  const orMessages = o?.body.messages as { role: string; content: string }[]
  check('the prompt is a system turn', orMessages?.[0]?.role === 'system' && orMessages[0].content.includes('Never invent a course'), orMessages?.[0]?.role)
  check('the question is the user turn', orMessages?.[1]?.role === 'user' && orMessages[1].content === ASK.question, orMessages?.[1])
  check('no assistant prefill is sent to openrouter', orMessages?.length === 2, orMessages?.length)
  check('the answer comes back through choices', out.text === `Сначала проверь питание.${NL}${NL}Потом TRIG.`, out.text)

  process.env.OPENROUTER_MODEL = ' openai/gpt-oss-20b:free' + NL
  stubAnthropic({ raw: orReply })
  await post(ASK)
  check('the model id can be overridden', (captured as Captured | null)?.body.model === 'openai/gpt-oss-20b:free', (captured as Captured | null)?.body.model)
  delete process.env.OPENROUTER_MODEL

  // A free id going paid is what actually happened in production, and it must not end the attempt.
  const WENT_PAID = { status: 404, raw: { error: { message: 'This model is unavailable for free. The paid version is available now.' } } }
  stubSequence([WENT_PAID, WENT_PAID, { raw: { choices: [{ message: { content: GOOD } }] } }])
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('a retired free model falls through to the next', res.status === 200, { status: res.status, out })
  check('it took exactly three attempts', calls.length === 3, calls.length)
  check('each attempt asked for a different model', new Set(calls.map((x) => x.body.model)).size === 3, calls.map((x) => x.body.model))
  check('the answering model is named', isFree(out.model), out.model)

  // Every candidate gone: the last reason is what the mentor reports.
  stubSequence([WENT_PAID])
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('all candidates exhausted is a 502', res.status === 502, res.status)
  check('the reason survives the whole loop', String(out.detail).includes('unavailable for free'), out)
  check('every candidate was tried', calls.length >= 5, calls.length)
  // Which ids were attempted settles whether a deployment runs the list you think it does.
  check('the attempted models are reported', Array.isArray(out.tried) && (out.tried as string[]).length === calls.length, out.tried)
  check('every reported id is a free one', (out.tried as string[]).every(isFree), out.tried)

  // A bad key would fail identically on all of them, so it must stop at the first.
  stubSequence([{ status: 401, raw: { error: { message: 'No auth credentials found' } } }])
  res = await post(ASK)
  check('an auth failure stops after one attempt', calls.length === 1, calls.length)
  check('an auth failure is still a 502', res.status === 502, res.status)

  // So would an exhausted daily quota.
  stubSequence([{ status: 429, raw: { error: { message: 'Rate limit exceeded: free-models-per-day' } } }])
  await post(ASK)
  check('a rate limit stops after one attempt', calls.length === 1, calls.length)

  // A pinned model is a deliberate choice and must not be silently replaced.
  process.env.OPENROUTER_MODEL = 'some/pinned-model:free'
  stubSequence([WENT_PAID])
  res = await post(ASK)
  check('a pinned model is tried once and not substituted', calls.length === 1 && calls[0].body.model === 'some/pinned-model:free', calls.map((x) => x.body.model))
  check('a pinned model that is gone reports why', res.status === 502)
  delete process.env.OPENROUTER_MODEL

  // OpenRouter can answer 200 and put the failure in the body instead.
  stubAnthropic({ raw: { error: { message: 'Rate limit exceeded: free-models-per-day' } } })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('an error inside a 200 is still a failure', res.status === 502 && String(out.detail).includes('Rate limit'), out)

  // Prose, which a free model produces far more often than Haiku does.
  stubAnthropic({ raw: { choices: [{ message: { content: 'Проверь питание датчика.' } }] } })
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('prose from a free model is kept', res.status === 200 && String(out.text).includes('Проверь питание'), out)

  const orHealth = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('health names the provider', orHealth.provider === 'openrouter', orHealth)
  check('health says the model list is automatic', orHealth.model === 'auto (5)', orHealth)

  process.env.OPENROUTER_MODEL = 'some/pinned-model:free'
  const pinnedHealth = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('health names a pinned model exactly', pinnedHealth.model === 'some/pinned-model:free', pinnedHealth)
  delete process.env.OPENROUTER_MODEL
  check('health never returns the openrouter key', !JSON.stringify(orHealth).includes('or-test-key'), orHealth)

  // Both keys set: the one added deliberately after the other failed is the one that should win.
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  stubAnthropic({ raw: orReply })
  await post(ASK)
  check('openrouter wins when both keys are set', Boolean((captured as Captured | null)?.url.includes('openrouter')), (captured as Captured | null)?.url)

  delete process.env.OPENROUTER_API_KEY
  stubAnthropic({ text: GOOD })
  await post(ASK)
  check('anthropic is used again once openrouter is removed', Boolean((captured as Captured | null)?.url.includes('anthropic')), (captured as Captured | null)?.url)

  // --- parseReply guards -----------------------------------------------------------------------
  check('empty text is rejected', parseReply('{"text":"   "}') === null)
  check('missing text is rejected', parseReply('{"question":"x"}') === null)
  check('junk is rejected', parseReply('not json at all') === null)

  console.log(failures === 0 ? '✓ request and reply travel end to end; no key, no upstream call' : `${failures} failed`)
}

/**
 * The daily allowance, which is what stands between an open registration form and the provider's bill.
 *
 * The handler is the real one; Supabase and the provider are stubs. What is being checked is the
 * order of things — the count is spent before the model is reached, an account over the line never
 * reaches it, and a deployment that has not run the migration yet keeps working.
 */
async function dailyLimit() {
  console.log('AI mentor daily limit')
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  delete process.env.OPENROUTER_API_KEY
  delete process.env.AI_DAILY_LIMIT

  // --- the pure half: what the environment may say ---------------------------------------------
  check('the default is forty', DEFAULT_AI_DAILY_LIMIT === 40, DEFAULT_AI_DAILY_LIMIT)
  check('unset falls back to the default', dailyLimitFromEnv(undefined) === DEFAULT_AI_DAILY_LIMIT)
  check('blank falls back to the default', dailyLimitFromEnv('') === DEFAULT_AI_DAILY_LIMIT && dailyLimitFromEnv('   ') === DEFAULT_AI_DAILY_LIMIT)
  check('a whole number is taken as written', dailyLimitFromEnv('25') === 25 && dailyLimitFromEnv(' 7' + NL) === 7)
  for (const bad of ['nonsense', '2.5', '0', '-3', '1e999', 'NaN', '100001', '999999999999']) {
    check(`a bad AI_DAILY_LIMIT falls back: ${JSON.stringify(bad)}`, dailyLimitFromEnv(bad) === DEFAULT_AI_DAILY_LIMIT, dailyLimitFromEnv(bad))
  }

  // --- under the limit: the model is called, and the count was spent first ------------------------
  quotaMode = 'allow'
  rpcCalls = []
  stubAnthropic({ text: GOOD })
  let res = await post(ASK)
  let out = (await res.json()) as Record<string, unknown>
  check('under the limit the provider is called', captured !== null)
  check('and the answer arrives', res.status === 200 && String(out.text).includes('питание'), { status: res.status, out })
  check('and it is not flagged as limited', out.limited === undefined, out)
  check('exactly one unit is spent per question', rpcCalls.length === 1, rpcCalls.length)
  check('the default limit is what the database is asked to enforce', rpcCalls[0]?.body.daily_limit === 40, rpcCalls[0]?.body)
  // The whole point of running it as the caller: auth.uid() inside the function is this token's
  // owner, so the request has to carry the student's own bearer token and not a service key.
  check('the count is spent as the caller, not as the server', rpcCalls[0]?.headers.get('authorization') === 'Bearer stub-token', rpcCalls[0]?.headers.get('authorization'))
  check('no user id is sent for the function to trust', !JSON.stringify(rpcCalls[0]?.body).includes('stub-user-id'), rpcCalls[0]?.body)

  // --- over the limit: the model is never reached ---------------------------------------------------
  quotaMode = 'deny'
  rpcCalls = []
  stubSequence([{ text: GOOD }])
  res = await post(ASK)
  out = (await res.json()) as Record<string, unknown>
  check('over the limit is a 429', res.status === 429, res.status)
  check('over the limit the provider is NOT called', calls.length === 0, calls.length)
  check('the reply is flagged for the client', out.limited === true && out.error === 'daily_limit', out)
  check('the reply says what the limit was', out.limit === 40, out)
  check('the reply carries no model text to mistake for an answer', out.text === undefined, out)

  // The same through OpenRouter, which is a different branch with its own loop of candidates.
  process.env.OPENROUTER_API_KEY = 'or-test-key'
  stubSequence([{ raw: { choices: [{ message: { content: GOOD } }] } }])
  res = await post(ASK)
  check('over the limit on openrouter calls nothing either', res.status === 429 && calls.length === 0, { status: res.status, calls: calls.length })
  delete process.env.OPENROUTER_API_KEY

  // --- the limit that is configured is the limit that is enforced --------------------------------------
  quotaMode = 'allow'
  process.env.AI_DAILY_LIMIT = ' 5' + NL
  rpcCalls = []
  stubAnthropic({ text: GOOD })
  await post(ASK)
  check('AI_DAILY_LIMIT reaches the database', rpcCalls[0]?.body.daily_limit === 5, rpcCalls[0]?.body)

  for (const bad of ['lots', '0', '-1', '12.5']) {
    process.env.AI_DAILY_LIMIT = bad
    rpcCalls = []
    stubAnthropic({ text: GOOD })
    res = await post(ASK)
    check(`an invalid AI_DAILY_LIMIT (${bad}) is the default, not a lockout`, rpcCalls[0]?.body.daily_limit === 40 && res.status === 200, { sent: rpcCalls[0]?.body, status: res.status })
  }
  delete process.env.AI_DAILY_LIMIT

  // --- a request that was going to be refused anyway costs nothing ---------------------------------------
  rpcCalls = []
  stubAnthropic({ text: GOOD })
  await postAnonymous(ASK)
  check('an anonymous request spends no unit', rpcCalls.length === 0, rpcCalls.length)
  await post({ question: '   ' })
  check('an empty question spends no unit', rpcCalls.length === 0, rpcCalls.length)
  await post({ question: 'x'.repeat(2001) })
  check('an oversized question spends no unit', rpcCalls.length === 0, rpcCalls.length)
  delete process.env.ANTHROPIC_API_KEY
  res = await post(ASK)
  check('no key is still 501', res.status === 501, res.status)
  check('and an unconfigured mentor spends no unit', rpcCalls.length === 0, rpcCalls.length)
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one'
  const hb = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('the health check spends no unit', rpcCalls.length === 0, rpcCalls.length)
  check('the health check reports the limit in force', hb.dailyLimit === 40, hb)
  process.env.AI_DAILY_LIMIT = 'nonsense'
  const hb2 = (await (await handler(new Request('https://example.test/api/mentor', { method: 'GET' }))).json()) as Record<string, unknown>
  check('and shows the default when the variable is unusable', hb2.dailyLimit === 40, hb2)
  delete process.env.AI_DAILY_LIMIT

  // --- the migration has not been applied yet: fail open, say so once ---------------------------------------
  // Deploying the code before the SQL must not take the mentor down. PostgREST says PGRST202 while
  // its schema cache has no such function; Postgres itself says 42883.
  const warned: unknown[][] = []
  const realWarn = console.warn
  console.warn = (...args: unknown[]) => void warned.push(args)
  try {
    for (const mode of ['no-function-postgrest', 'no-function-postgres', 'no-function-postgrest'] as const) {
      quotaMode = mode
      stubSequence([{ text: GOOD }])
      res = await post(ASK)
      out = (await res.json()) as Record<string, unknown>
      check(`a missing quota function (${mode}) fails open`, res.status === 200 && calls.length === 1 && String(out.text).includes('питание'), { status: res.status, calls: calls.length })
      check(`and is not flagged as limited (${mode})`, out.limited === undefined, out)
    }
  } finally {
    console.warn = realWarn
  }
  check('the missing migration is logged once, not per question', warned.length === 1, warned.length)
  check('and the log says what to apply', String(warned[0]?.[0]).includes('0012_ai_usage'), warned[0])

  // --- any other database failure does not lift the cap ------------------------------------------------------------
  // Fail-open is for one known gap, not for every error: a broken database must not turn the limit
  // off for whoever notices. The client treats the 503 like any failure and uses the knowledge base.
  const realError = console.error
  const errored: unknown[][] = []
  console.error = (...args: unknown[]) => void errored.push(args)
  try {
    quotaMode = 'broken'
    stubSequence([{ text: GOOD }])
    res = await post(ASK)
    out = (await res.json()) as Record<string, unknown>
    check('an unexpected database error is a 503', res.status === 503, res.status)
    check('and the provider is not called', calls.length === 0, calls.length)
    check('and it is not mistaken for the daily limit', out.limited === undefined, out)
    check('and it is logged', errored.length === 1, errored.length)

    // The Supabase call itself throwing — a dropped connection, say — is the same.
    quotaMode = 'allow'
    calls = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (isAuthCall(String(url))) return authOk()
      if (isRpcCall(String(url))) throw new Error('connection reset')
      calls.push({ url: String(url), headers: {}, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: GOOD }] }) }
    }) as unknown as typeof fetch
    res = await post(ASK)
    check('a quota call that throws is a 503 and reaches no provider', res.status === 503 && calls.length === 0, { status: res.status, calls: calls.length })
  } finally {
    console.error = realError
  }

  quotaMode = 'allow'
  console.log(failures === 0 ? '✓ the allowance is spent before the model, and a spent account never reaches it' : `${failures} failed`)
}

/**
 * The client half of the same question: when the model answers, nothing may replace it.
 *
 * The two brains produce the same shape on purpose, so a mix-up would be invisible in the UI.
 * `fromModel` is the only thing separating them, and it is what the panel prints under the reply.
 */
async function clientSide() {
  const g = globalThis as unknown as { localStorage?: unknown }
  if (!g.localStorage) {
    const mem = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  }
  const { askMentor } = (await import('../src/lib/ai.ts')) as typeof import('../src/lib/ai.ts')

  const modelReply = { text: 'Ответ от модели', question: 'И что дальше?', followUps: ['раз', 'два'] }
  let seen: { url: string; body: Record<string, unknown> } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> }
    return { ok: true, status: 200, json: async () => modelReply }
  }) as unknown as typeof fetch

  let r = await askMentor('почему датчик врёт', { lessonTitle: 'Ultrasonic distance', code: 'int t=9;' })
  const sent = seen as { url: string; body: Record<string, unknown> } | null
  check('client posts to /api/mentor', sent?.url === '/api/mentor', sent?.url)
  check('client sends the question', sent?.body.question === 'почему датчик врёт', sent?.body)
  check('client sends lesson context', sent?.body.lessonTitle === 'Ultrasonic distance')
  check('client sends the editor code', sent?.body.code === 'int t=9;')
  check('model text is what the UI gets', r.text === 'Ответ от модели', r.text)
  check('reply is flagged as the model', r.fromModel === true, r)
  check('offline text did not leak in', !r.text.includes('narrow it down') && !r.text.includes('Hardware'), r.text)

  // A question the local base has a canned answer for must still come back from the model.
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('model wins over a local keyword match', r.text === 'Ответ от модели' && r.fromModel === true, r)

  // Only when the model produces nothing does the local base speak — and it says so.
  globalThis.fetch = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('fallback answers when the model fails', r.text.length > 0)
  check('fallback is not mislabelled as the model', r.fromModel !== true, r)

  // An empty model reply is not an answer, so the fallback takes over rather than showing blank.
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ text: '' }) })) as unknown as typeof fetch
  r = await askMentor('anything', {})
  check('empty model text falls back instead of showing blank', r.text.length > 0 && r.fromModel !== true, r)

  // The failure that is told apart from the rest: the day's allowance. The knowledge base still
  // answers, and the reply says why it was not the model.
  globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({ error: 'daily_limit', limited: true, limit: 40 }) })) as unknown as typeof fetch
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('over the limit, the knowledge base answers', r.text.length > 0, r)
  check('and the reply is flagged as limited', r.limited === true, r)
  check('and it is not mislabelled as the model', r.fromModel !== true, r)

  // A 429 from anywhere but this route's own flag is an ordinary failure, not a spent allowance.
  globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('a bare 429 still falls back', r.text.length > 0 && r.fromModel !== true, r)
  check('but it is not blamed on the daily limit', r.limited !== true, r)
  globalThis.fetch = (async () => ({
    ok: false,
    status: 429,
    json: async () => {
      throw new Error('not json')
    },
  })) as unknown as typeof fetch
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('a 429 with no body falls back without a flag', r.text.length > 0 && r.limited !== true, r)

  // Neither of the other fallbacks is a limit.
  globalThis.fetch = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch
  r = await askMentor('explain how the ultrasonic sensor works', {})
  check('an outage is not flagged as the daily limit', r.limited !== true, r)

  // The line the panel prints has to exist in all three languages, or one of them reads a bare key.
  const { UI } = (await import('../src/i18n/ui.ts')) as typeof import('../src/i18n/ui.ts')
  const line = UI['ai_daily_limit_reached']
  check('the daily limit line exists in en, ru and kk', Boolean(line?.en && line?.ru && line?.kk), line)
  check('and each language says something different', new Set([line?.en, line?.ru, line?.kk]).size === 3, line)

  await knowledgeBase()

  console.log(failures === 0 ? '✓ the model always wins; the offline base only fills a silence' : `${failures} failed`)
  if (failures) process.exitCode = 1
}

/**
 * The offline base is what answers whenever the model cannot, so it is not a decoration.
 *
 * Two things rot quietly here. A new entry added above an older one can swallow its questions,
 * because the first matching pattern wins and nothing complains. And an entry added to the English
 * canonical without its Russian and Kazakh wording falls back to English silently — which on a
 * trilingual platform is exactly the kind of bug a judge finds before anyone else does.
 */
async function knowledgeBase() {
  const { KB } = (await import('../src/lib/ai.ts')) as unknown as { KB: { id: string; match: RegExp }[] }
  const { AI_RU } = (await import('../src/i18n/ai.ru.ts')) as typeof import('../src/i18n/ai.ru.ts')
  const { AI_KK } = (await import('../src/i18n/ai.kk.ts')) as typeof import('../src/i18n/ai.kk.ts')

  for (const entry of KB) {
    check(`${entry.id} has Russian wording`, entry.id in AI_RU, entry.id)
    check(`${entry.id} has Kazakh wording`, entry.id in AI_KK, entry.id)
  }
  // 'fallback' and the '_plain' variants answer when there is no entry or no lesson, so they are
  // packaged wording without a KB row of their own. Everything else must belong to one.
  const known = (id: string) => KB.some((e) => e.id === id) || id === 'fallback' || id.endsWith('_plain')
  for (const id of Object.keys(AI_RU)) check(`ru pack has no orphan: ${id}`, known(id), id)
  for (const id of Object.keys(AI_KK)) check(`kk pack has no orphan: ${id}`, known(id), id)

  // A question a student would really type, and the entry it has to reach — in all three languages.
  const ROUTES: [string, string][] = [
    ['I am completely stuck', 'stuck'],
    ['я застрял и не знаю что делать', 'stuck'],
    ['мен тұрып қалдым', 'stuck'],
    ['where do I start?', 'where-to-start'],
    ['с чего начать', 'where-to-start'],
    ['I do not understand the feedback my mentor left', 'feedback'],
    ['не понял комментарий наставника', 'feedback'],
    ['my work was sent back for changes', 'changes'],
    ['наставник вернул работу на доработку', 'changes'],
    ['how do I ask a good question', 'ask-well'],
    ['как правильно задать вопрос', 'ask-well'],
    ['I am behind on the deadline', 'deadline'],
    ['не успеваю к дедлайну', 'deadline'],
    ['I lost my streak and my motivation', 'motivation'],
    ['забросил всё, нет мотивации', 'motivation'],
    ['how do I submit my work', 'submit'],
    ['как сдать работу', 'submit'],
    ['what are they grading exactly', 'rubric'],
    ['по каким критериям оценивают', 'rubric'],
    ['can I use AI for this, is it cheating', 'honesty'],
    ['можно ли списать', 'honesty'],
    ['which mentor should I choose', 'choose-mentor'],
    ['стоит ли платить за этот урок', 'choose-mentor'],
    ['I paid but the lesson will not open', 'access'],
    ['оплатил, а урок не открывается', 'access'],
    ['how do I become a mentor here', 'become-mentor'],
    ['хочу стать наставником', 'become-mentor'],
    // The refusal has to win over the topics it sounds like, so it is checked last.
    ['write my whole project for me', 'do-my-homework'],
    ['сделай задание за меня', 'do-my-homework'],
  ]
  for (const [question, expected] of ROUTES) {
    const hit = KB.find((e) => e.match.test(question))
    check(`"${question.slice(0, 34)}" reaches ${expected}`, hit?.id === expected, { got: hit?.id })
  }

  console.log(`  ${KB.length} knowledge base topics, all three languages`)
}

void run().then(dailyLimit).then(clientSide)
