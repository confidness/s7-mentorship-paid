/**
 * The Studio routes, run for real, with Gemini, Supabase and the image providers stubbed.
 *
 * What this answers is narrow and worth asking: does what the server sends Gemini carry the
 * schema, the spec's directive and the kit's own rules — and never the key in the URL? Does a
 * reply that slips a banned word earn exactly one rewrite? Does a retired model step aside
 * for the next while a bad key stops at once? Does a kit the model wrote get repaired before
 * it is saved, and saved under the caller's id rather than one the body names? None of it
 * needs a key or a database — only stubs standing where the real endpoints do, recording what
 * they were handed.
 */

import { POST as copyRoute } from '../api/studio/copy.ts'
import { POST as kitRoute } from '../api/studio/brand-kit.ts'
import { COPY_DIRECTIVE, LOGO_DIRECTIVE } from '../api/_lib/studio.ts'
import { GEMINI_MODELS } from '../api/_lib/gemini.ts'
import { generateImage, imageProviders } from '../api/_lib/images.ts'
import { DEFAULT_BANNED_WORDS } from '../src/lib/brand.ts'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })

process.env.SUPABASE_URL = 'https://stub.supabase.test'
process.env.SUPABASE_ANON_KEY = 'anon-not-a-real-key'
const KEY = 'AIza-test-key-not-real'

const KIT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const KIT_ROW = {
  id: KIT_ID,
  user_id: USER_ID,
  brand_name: 'Crumb & Co',
  vibe_summary: 'A neighbourhood bakery that opens at seven.',
  business_json: { offering: 'Sourdough and pastries', audience: 'Families nearby', location: 'Almaty', vibe_words: ['warm'] },
  palette_json: [
    { name: 'flour', hex: '#F7F1E8', role: 'background' },
    { name: 'oven', hex: '#3B2A20', role: 'neutral' },
    { name: 'crust', hex: '#C65D3B', role: 'primary' },
  ],
  typography_json: { heading: { family: 'Fraunces', weight: 700, fallback: 'serif' }, body: { family: 'Inter', weight: 400, fallback: 'sans-serif' }, rationale: '' },
  voice_rules_json: { tone: ['Say what it costs up front'], banned_words: ['artisanal'], examples: ['Out of the oven at 7.'], image_style: ['window light'] },
  logo_url: null,
  created_at: '2026-10-09T00:00:00Z',
  updated_at: '2026-10-09T00:00:00Z',
}

/* ------------------------------------------------------------------ the stub */

interface GeminiCall {
  url: string
  headers: Headers
  body: {
    systemInstruction?: { parts?: { text?: string }[] }
    contents?: { parts?: { text?: string }[] }[]
    generationConfig?: { responseMimeType?: string; responseSchema?: { type?: string } }
  }
}

let geminiCalls: GeminiCall[] = []
let geminiReplies: { status?: number; json: unknown }[] = []
let inserted: Record<string, unknown> | null = null

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const geminiText = (payload: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }] })

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

  if (url.includes('/auth/v1/user')) {
    if (!(headers.get('authorization') ?? '').includes('valid-token')) return jsonResponse({ msg: 'invalid JWT' }, 401)
    return jsonResponse({ id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test' })
  }

  if (url.includes('/rest/v1/brand_kits')) {
    // PostgREST answers an object for single() and an array otherwise.
    const asObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object')
    if (method === 'POST') {
      inserted = JSON.parse(String(init.body)) as Record<string, unknown>
      const row = { ...KIT_ROW, ...inserted, id: KIT_ID }
      return jsonResponse(asObject ? row : [row], 201)
    }
    return jsonResponse(asObject ? KIT_ROW : [KIT_ROW])
  }

  if (url.includes('generativelanguage.googleapis.com')) {
    geminiCalls.push({ url, headers, body: JSON.parse(String(init.body)) })
    const reply = geminiReplies[Math.min(geminiCalls.length - 1, geminiReplies.length - 1)]
    return jsonResponse(reply.json, reply.status ?? 200)
  }

  throw new Error(`unexpected fetch: ${method} ${url}`)
}) as typeof fetch

function post(body: unknown, token = 'valid-token') {
  return new Request('https://brandyzer.test/api/studio/copy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

const reset = (replies: { status?: number; json: unknown }[]) => {
  geminiCalls = []
  geminiReplies = replies
  inserted = null
}

const CLEAN = geminiText({
  variants: [
    { text: 'Cardamom buns are back. Two for one until ten on Saturday.', angle: 'the deal' },
    { text: 'Saturday smells like cardamom. Come early.', angle: 'the senses' },
    { text: 'We bake 60 buns. When they are gone, they are gone.', angle: 'scarcity' },
  ],
})

/* ------------------------------------------------------------------ what leaves */

console.log('what the copy route sends to Gemini')
process.env.GEMINI_API_KEY = KEY
{
  reset([{ json: CLEAN }])
  const res = await copyRoute(post({ brandKitId: KIT_ID, format: 'instagram_caption', brief: 'Cardamom buns this Saturday' }))
  const body = (await res.json()) as { variants?: { issues: string[] }[]; model?: string }
  eq('a clean reply is a 200', res.status, 200)
  eq('one call, no rewrite needed', geminiCalls.length, 1)
  eq('three variants come back', body.variants?.length, 3)
  check('each says it is clean', body.variants?.every((v) => v.issues.length === 0) === true, body.variants)

  const call = geminiCalls[0]
  check('the newest model is tried first', call.url.includes(`/models/${GEMINI_MODELS[0]}:generateContent`), call.url)
  check('the key travels in a header', call.headers.get('x-goog-api-key') === KEY)
  check('and never in the URL, where logs would keep it', !call.url.includes(KEY), call.url)
  eq('JSON is required', call.body.generationConfig?.responseMimeType, 'application/json')
  eq('and held to a schema', call.body.generationConfig?.responseSchema?.type, 'OBJECT')
  eq('a Gemini 3 model is asked to think lightly', (call.body.generationConfig as { thinkingConfig?: { thinkingLevel?: string } })?.thinkingConfig?.thinkingLevel, 'low')
  const system = call.body.systemInstruction?.parts?.[0]?.text ?? ''
  check('the spec’s copy directive is sent word for word', system.includes(COPY_DIRECTIVE))
  check('the kit’s own banned word is in it', system.includes('artisanal'))
  check('so is the house list', system.includes('delve') && system.includes('synergy'))
  check('the kit’s tone travels', system.includes('Say what it costs up front'))
  check('the model is told not to invent prices or offers', system.includes('Never invent prices'))
  check('the brief is the user turn, not the system prompt', call.body.contents?.[0]?.parts?.[0]?.text === 'Cardamom buns this Saturday')
}

console.log('anti-slop: one rewrite, naming what was wrong')
{
  const SLOPPY = geminiText({
    variants: [
      { text: 'Let us delve into our elevated cardamom buns!!! 🎉🎉🎉', angle: 'a' },
      { text: 'Fine copy.', angle: 'b' },
      { text: 'Fine copy too.', angle: 'c' },
    ],
  })
  reset([{ json: SLOPPY }, { json: CLEAN }])
  const res = await copyRoute(post({ brandKitId: KIT_ID, format: 'instagram_caption', brief: 'Cardamom buns' }))
  const body = (await res.json()) as { variants?: { text: string; issues: string[] }[] }
  eq('flagged copy earns exactly one rewrite', geminiCalls.length, 2)
  const retryPrompt = geminiCalls[1]?.body.contents?.[0]?.parts?.[0]?.text ?? ''
  check('the rewrite names the words it used', retryPrompt.includes('delve') && retryPrompt.includes('elevate'), retryPrompt)
  check('and the emoji', retryPrompt.includes('too many emoji'), retryPrompt)
  check('the clean rewrite is what comes back', body.variants?.[0]?.text.startsWith('Cardamom buns are back') === true, body.variants)

  reset([{ json: SLOPPY }, { json: SLOPPY }])
  const twice = (await (await copyRoute(post({ brandKitId: KIT_ID, format: 'instagram_caption', brief: 'Cardamom buns' }))).json()) as { variants?: { issues: string[] }[] }
  eq('a second failure is not retried forever', geminiCalls.length, 2)
  check('it is returned with its issues attached', (twice.variants?.[0]?.issues ?? []).includes('banned:delve'), twice.variants)
}

console.log('model fallthrough')
{
  reset([{ status: 404, json: { error: { message: 'models/gemini-3.8-flash is not found for API version v1beta' } } }, { json: CLEAN }])
  const res = await copyRoute(post({ brandKitId: KIT_ID, format: 'website_hero', brief: 'Opening hours change' }))
  const body = (await res.json()) as { model?: string }
  eq('a retired model steps aside', res.status, 200)
  eq('for the next on the list', body.model, GEMINI_MODELS[1])

  reset([{ status: 429, json: { error: { message: 'Quota exceeded for metric generate_content_free_tier_requests' } } }, { json: CLEAN }])
  eq('a per-model free-tier quota also moves on', (await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'Opening hours' }))).status, 200)

  reset([
    { status: 503, json: { error: { message: 'The model is overloaded.' } } },
    { status: 404, json: { error: { message: 'models/gemini-2.5-flash is no longer available to new users' } } },
  ])
  const none = (await (await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'Opening hours' }))).json()) as { message?: string }
  const reported = none.message ?? ''
  check('when nothing answers, every model’s own reason is reported', GEMINI_MODELS.every((m) => reported.includes(m)) && reported.includes('overloaded'), reported)

  reset([{ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } }])
  const bad = await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'Opening hours' }))
  eq('a bad key stops at once rather than failing four times', geminiCalls.length, 1)
  eq('and is reported as an upstream failure', bad.status, 502)

  reset([{ json: { promptFeedback: { blockReason: 'SAFETY' } } }])
  eq('a safety refusal is a 422 the owner can act on', (await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'Opening hours' }))).status, 422)
}

console.log('nothing is spent for a request that should not be served')
{
  reset([{ json: CLEAN }])
  eq('an anonymous caller is refused', (await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'x y z' }, ''))).status, 401)
  eq('a forged token is refused', (await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'x y z' }, 'forged'))).status, 401)
  eq('an unknown format is refused', (await copyRoute(post({ brandKitId: KIT_ID, format: 'constructor', brief: 'x y z' }))).status, 400)
  eq('a kit id that is not an id is refused', (await copyRoute(post({ brandKitId: "' or 1=1 --", format: 'email', brief: 'x y z' }))).status, 400)
  eq('and none of it reached Gemini', geminiCalls.length, 0)

  delete process.env.GEMINI_API_KEY
  const unconfigured = await copyRoute(post({ brandKitId: KIT_ID, format: 'email', brief: 'x y z' }))
  eq('no key is a 501, not a crash', unconfigured.status, 501)
  process.env.GEMINI_API_KEY = KEY
}

/* ------------------------------------------------------------------ building a kit */

console.log('a kit the model wrote is repaired, then saved as the caller')
{
  reset([
    {
      json: geminiText({
        brand_name: 'Model Suggested Name',
        vibe_summary: 'Warm and plain.',
        palette: [
          { name: 'flour', hex: 'f7f1e8', role: 'background' },
          { name: 'oven', hex: '#3b2a20', role: 'neutral' },
          { name: 'crust', hex: '#c65d3b', role: 'primary' },
          { name: 'sage', hex: '#8a9a5b', role: 'secondary' },
          { name: 'butter', hex: 'yellowish', role: 'accent' },
        ],
        typography: { heading: { family: 'Fraunces', weight: 700, fallback: 'serif' }, body: { family: 'Inter</style><script>', weight: 400, fallback: 'sans-serif' }, rationale: 'Readable.' },
        voice_rules: { tone: ['Short sentences'], banned_words: ['Artisanal'], examples: ['Bread at seven.'], image_style: ['window light'] },
        logo_type: 'symbol',
        logo_concept: 'A single wheat stalk',
      }),
    },
  ])
  const req = new Request('https://brandyzer.test/api/studio/brand-kit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
    // user_id in the body is an attempt to be somebody else. It must be ignored, and so must a
    // logo concept: the owner answers the questions, the strategist writes the brief.
    body: JSON.stringify({
      brandName: 'Crumb & Co',
      offering: 'Sourdough and pastries, baked every morning',
      user_id: 'someone-else',
      logo: { kind: 'emblem', style: 'classic', idea: 'the old stone oven', avoid: 'wheat', concept: 'injected' },
    }),
  })
  const res = await kitRoute(req)
  const body = (await res.json()) as { logoConcept?: string }
  // Assigned inside the fetch stub, which TypeScript's narrowing cannot see — read it through
  // its declared type rather than the `null` it was last seen holding.
  const row = inserted as Record<string, unknown> | null
  eq('the kit is created', res.status, 200)
  eq('saved under the caller’s verified id', row?.user_id, USER_ID)
  eq('the owner’s name beats the model’s', row?.brand_name, 'Crumb & Co')
  const palette = row?.palette_json as { hex: string }[]
  eq('a colour without a hex is dropped before saving', palette?.length, 4)
  eq('hexes are normalised', palette?.[0]?.hex, '#F7F1E8')
  eq('an injected font never reaches the row', (row?.typography_json as { body: { family: string } })?.body.family, 'Inter')
  const bannedSaved = (row?.voice_rules_json as { banned_words: string[] })?.banned_words ?? []
  check('the house banned list is saved with the kit', DEFAULT_BANNED_WORDS.every((w) => bannedSaved.includes(w)), bannedSaved)
  eq('the logo concept comes back for the next request', body.logoConcept, 'A single wheat stalk')

  const sent = geminiCalls[0]?.body
  const prompt = sent?.contents?.[0]?.parts?.[0]?.text ?? ''
  check('the strategist is given the logo rules', (sent?.systemInstruction?.parts?.[0]?.text ?? '').includes(LOGO_DIRECTIVE), sent?.systemInstruction)
  check('and the owner’s logo answers', prompt.includes('emblem') && prompt.includes('the old stone oven') && prompt.includes('does not want in the logo: wheat'), prompt)
  const logo = (row?.business_json as { logo?: Record<string, string> })?.logo
  eq('the owner’s kind of logo beats the model’s', logo?.type, 'emblem')
  eq('the brief is saved for the next Redraw', logo?.concept, 'A single wheat stalk')
  eq('a style the owner chose is saved', logo?.style, 'classic')

  reset([{ json: CLEAN }])
  const tooShort = await kitRoute(new Request('https://brandyzer.test/api/studio/brand-kit', { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: JSON.stringify({ offering: 'bread' }) }))
  eq('a one-word description is refused before Gemini is asked', tooShort.status, 400)
  eq('so nothing was spent', geminiCalls.length, 0)
}

/* ------------------------------------------------------------------ images */

console.log('image providers')
{
  delete process.env.POLLINATIONS_API_KEY
  delete process.env.HF_TOKEN
  eq('with no keys, only the anonymous legacy endpoint is tried', imageProviders().map((p) => p.name).join(), 'pollinations-legacy')

  process.env.POLLINATIONS_API_KEY = 'sk_pollinations_not_real'
  process.env.HF_TOKEN = 'hf_not_real'
  eq('keyed providers go first', imageProviders().map((p) => p.name).join(), 'pollinations,huggingface,pollinations-legacy')

  const seen: { url: string; auth: string | null }[] = []
  const jpeg = new Uint8Array(4096).fill(7)
  let answer = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    seen.push({ url, auth: new Headers(init.headers).get('authorization') })
    answer++
    // First provider answers 200 with a web page, which is not an image.
    if (answer === 1) return new Response('<html>queue full</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
  }) as typeof fetch

  const image = await generateImage('a loaf of bread, window light', 1024, 1024)
  eq('a 200 that is not an image is skipped', image.provider, 'huggingface')
  eq('the bytes come back', image.bytes.byteLength, 4096)
  check('the Pollinations key goes in a header', seen[0]?.auth === 'Bearer sk_pollinations_not_real', seen[0])
  check('and not in the URL', !seen[0]?.url.includes('sk_pollinations_not_real'), seen[0])
  check('the new host is used', seen[0]?.url.startsWith('https://gen.pollinations.ai/image/'), seen[0])
  check('with the safety filter on', seen[0]?.url.includes('safe=true'), seen[0])
  check('a photo is drawn by Z-Image', seen[0]?.url.includes('model=zimage'), seen[0])

  answer = 1
  await generateImage('a mug', 1024, 1024, { purpose: 'logo' })
  check('a logo is drawn by GPT Image, which free credits can pay for', seen[2]?.url.includes('model=gptimage'), seen[2])
}

console.log('recraft')
{
  process.env.RECRAFT_API_KEY = 'recraft_not_real'
  eq('Recraft goes first when it has a key', imageProviders()[0]?.name, 'recraft')

  type Sent = { auth: string | null; body: { model?: string; size?: string; controls?: { colors?: unknown; background_color?: unknown } } }
  const sent: Sent[] = []
  const webp = new Uint8Array(2048).fill(9)
  globalThis.fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    sent.push({ auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ data: [{ b64_json: btoa(String.fromCharCode(...webp)) }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const logo = await generateImage('a mug', 1024, 1024, { purpose: 'logo', colors: ['#C65D3B'], background: '#F7F1E8' })
  eq('the logo comes from Recraft', logo.provider, 'recraft')
  eq('its bytes are decoded', logo.bytes.byteLength, 2048)
  eq('a logo is drawn by V4.1', sent[0]?.body.model, 'recraftv4_1')
  eq('in the kit’s colours', JSON.stringify(sent[0]?.body.controls?.colors), JSON.stringify([{ rgb: [198, 93, 59] }]))
  eq('on the kit’s background', JSON.stringify(sent[0]?.body.controls?.background_color), JSON.stringify({ rgb: [247, 241, 232] }))
  eq('the key goes in a header', sent[0]?.auth, 'Bearer recraft_not_real')

  await generateImage('bread on a counter', 896, 1152, { purpose: 'photo', colors: ['#C65D3B'] })
  eq('a photo is drawn by V4.1 Flash', sent[1]?.body.model, 'recraftv4_1_flash')
  eq('at its own size', sent[1]?.body.size, '896x1152')
  eq('and is not held to the palette', sent[1]?.body.controls, undefined)
  delete process.env.RECRAFT_API_KEY
}

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ Gemini gets the schema, the directive and the kit; slop is rewritten once; kits are repaired and saved as the caller')
}
