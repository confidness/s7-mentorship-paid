/**
 * Writes marketing copy in a brand's voice, three ways, and checks it before handing it over.
 *
 * Anti-slop is two halves. The directive asks the model nicely, with the kit's own tone,
 * examples and banned words — which mostly works. `slopCheck` reads every variant back
 * against the same list and catches the rest. Anything flagged earns exactly one rewrite with
 * the offending words named; whatever is still flagged after that is returned with its
 * issues attached, so the interface can say so rather than pretend.
 *
 * Copy that slipped through twice is shown, marked. Hiding it would leave the owner with
 * nothing and no idea why.
 */

import { COPY_FORMATS, COPY_GUIDANCE, slopCheck, type BrandKitRow, type CopyFormat } from '../../src/lib/brand.js'
import { HttpError, fail, json, readJson, requireMethod, requireUser, str, uuidOrNull } from '../_lib/server.js'
import { generateJson } from '../_lib/gemini.js'
import { COPY_DIRECTIVE, COPY_SCHEMA, loadKit } from '../_lib/studio.js'

/** A Map, not an object literal: `LANGUAGES["constructor"]` on a plain object is not undefined. */
const LANGUAGES = new Map([
  ['en', 'English'],
  ['ru', 'Russian'],
  ['kk', 'Kazakh'],
])

interface Body {
  brandKitId?: unknown
  format?: unknown
  brief?: unknown
  language?: unknown
}

interface Variant {
  text: string
  angle: string
}

/** The kit, turned into instructions. Separate so the test can read exactly what is sent. */
export function voiceInstructions(kit: BrandKitRow, format: CopyFormat, language: string): string {
  const voice = kit.voice_rules_json
  const business = kit.business_json
  return [
    COPY_DIRECTIVE,
    '',
    `You are writing for ${kit.brand_name}. ${kit.vibe_summary}`,
    business?.offering ? `They sell: ${business.offering}` : '',
    business?.audience ? `Their customers: ${business.audience}` : '',
    business?.location ? `They are in: ${business.location}` : '',
    '',
    'HOW THIS BRAND TALKS:',
    ...(voice?.tone ?? []).map((line) => `- ${line}`),
    voice?.examples?.length ? 'Lines already in the voice, for the feel, not to copy:' : '',
    ...(voice?.examples ?? []).map((line) => `  "${line}"`),
    '',
    `NEVER USE these words or phrases, or any form of them: ${(voice?.banned_words ?? []).join(', ')}.`,
    'No em dashes. At most two emoji in total. At most one exclamation mark.',
    '',
    `FORMAT: ${COPY_GUIDANCE[format]}`,
    `Write in ${language}.`,
    'Write three variants that take genuinely different angles — not the same sentence reworded.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

const asVariants = (data: unknown): Variant[] => {
  const list = (data as { variants?: unknown })?.variants
  if (!Array.isArray(list)) return []
  return list
    .map((v) => ({ text: str((v as Variant)?.text, 3000), angle: str((v as Variant)?.angle, 120) }))
    .filter((v) => v.text)
    .slice(0, 3)
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const body = await readJson<Body>(req)

    const kitId = uuidOrNull(body.brandKitId)
    if (!kitId) throw new HttpError(400, 'invalid_input', 'Which brand kit?')
    const format = (COPY_FORMATS as readonly string[]).includes(String(body.format)) ? (body.format as CopyFormat) : null
    if (!format) throw new HttpError(400, 'invalid_input', 'Pick what to write.')
    const brief = str(body.brief, 1000)
    if (brief.length < 3) throw new HttpError(400, 'invalid_input', 'Say what this is about.')
    const language = LANGUAGES.get(String(body.language)) ?? 'English'

    const kit = await loadKit(caller, kitId)
    const system = voiceInstructions(kit, format, language)
    const banned = kit.voice_rules_json?.banned_words ?? []

    // Both calls share one clock, ending well inside the route's 150 seconds.
    const deadline = Date.now() + 140_000
    const first = await generateJson({ system, prompt: brief, schema: COPY_SCHEMA, deadline })
    let variants = asVariants(first.data)
    let model = first.model
    if (!variants.length) throw new HttpError(502, 'unusable', 'The model returned no copy. Try again.')

    const flagged = [...new Set(variants.flatMap((v) => slopCheck(v.text, banned).issues))]
    if (flagged.length) {
      // One rewrite, naming exactly what was wrong. A second failure is shown, not retried
      // forever: each attempt spends free-tier quota the owner will want later.
      const words = flagged.filter((i) => i.startsWith('banned:')).map((i) => i.slice(7))
      const retry = await generateJson({
        system,
        prompt: [
          brief,
          '',
          'Your last attempt broke the rules:',
          words.length ? `- it used: ${words.join(', ')}` : '',
          flagged.some((i) => i.startsWith('emoji:')) ? '- too many emoji' : '',
          flagged.some((i) => i.startsWith('exclamation:')) ? '- too many exclamation marks' : '',
          flagged.some((i) => i.startsWith('em_dash:')) ? '- em dashes' : '',
          'Write all three again without any of that.',
        ]
          .filter(Boolean)
          .join('\n'),
        schema: COPY_SCHEMA,
        deadline,
      }).catch(() => null)
      const second = retry ? asVariants(retry.data) : []
      if (second.length) {
        variants = second
        model = retry!.model
      }
    }

    return json({
      variants: variants.map((v) => ({ ...v, issues: slopCheck(v.text, banned).issues })),
      model,
    })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase SDK is not edge-compatible. Duration is set in vercel.json. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
