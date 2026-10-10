/**
 * Builds a brand kit from a description of the business, and saves it.
 *
 * The model proposes; `normalizeBrandKit` decides what is kept. A colour that is not a hex
 * code, a font name that would break a stylesheet, a banned list missing the house words —
 * all repaired or dropped before anything is written.
 *
 * Saved as the caller, through row level security, not with the service role. A kit is the
 * owner's own row and the owner may write it directly anyway; there is nothing here that
 * needs to act outside what they are allowed.
 *
 * The logo is a second request (`/api/studio/image` with purpose "logo"), not part of this
 * one. Text comes back in seconds and a picture can take thirty, and a kit that is already
 * saved when the drawing fails is worth more than one that is lost with it.
 */

import { normalizeBrandKit, normalizeBusiness, type LogoBrief } from '../../src/lib/brand.js'
import { HttpError, fail, json, readJson, requireMethod, requireUser, str } from '../_lib/server.js'
import { generateJson } from '../_lib/gemini.js'
import { BRAND_KIT_SCHEMA, KIT_COLUMNS, STRATEGIST_DIRECTIVE } from '../_lib/studio.js'

interface Body {
  brandName?: unknown
  offering?: unknown
  audience?: unknown
  location?: unknown
  vibeWords?: unknown
  /** The owner's answers to the logo questions: kind, style, idea, avoid. All optional. */
  logo?: unknown
}

/** The owner's logo answers, as lines of the prompt. "Let us decide" is said, not skipped. */
function logoAnswers(logo: LogoBrief): string[] {
  return [
    logo.kind === 'auto' ? 'Logo kind: the owner left it to you.' : `Logo kind the owner chose: ${logo.kind}.`,
    logo.style === 'auto' ? '' : `Logo style the owner wants: ${logo.style}.`,
    logo.idea && `The owner would like the logo to show: ${logo.idea}`,
    logo.avoid && `The owner does not want in the logo: ${logo.avoid}`,
  ]
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const body = await readJson<Body>(req)

    const brandName = str(body.brandName, 120)
    const answers = (body.logo && typeof body.logo === 'object' ? body.logo : {}) as Record<string, unknown>
    // Only the owner's half of the brief is read from the request; type and concept are ours to write.
    const business = normalizeBusiness({
      offering: body.offering,
      audience: body.audience,
      location: body.location,
      vibe_words: body.vibeWords,
      logo: { kind: answers.kind, style: answers.style, idea: answers.idea, avoid: answers.avoid },
    })
    if (business.offering.length < 10) throw new HttpError(400, 'invalid_input', 'Say what the business sells in a sentence or two.')

    const prompt = [
      brandName ? `Business name: ${brandName} (keep it exactly as written).` : 'The business has no name yet. Suggest one that is short, plain and easy to say.',
      `What it sells: ${business.offering}`,
      business.audience && `Who buys: ${business.audience}`,
      business.location && `Where: ${business.location}`,
      business.vibe_words.length ? `How the owner describes the feel: ${business.vibe_words.join(', ')}` : '',
      ...logoAnswers(business.logo),
    ]
      .filter(Boolean)
      .join('\n')

    const { data, model } = await generateJson({ system: STRATEGIST_DIRECTIVE, prompt, schema: BRAND_KIT_SCHEMA, temperature: 1, deadline: Date.now() + 50_000 })
    const draft = normalizeBrandKit(data, brandName)
    if (!draft) throw new HttpError(502, 'unusable', 'The model’s answer could not be turned into a brand kit. Try again.')

    // Saved with the kit, so a Redraw draws the same kind of logo from the same idea.
    // The owner's own pick of kind wins over the model's, as their name does.
    business.logo = { ...business.logo, type: business.logo.kind === 'auto' ? draft.logo_type : business.logo.kind, concept: draft.logo_concept }

    const { data: kit, error } = await caller.db
      .from('brand_kits')
      .insert({
        user_id: caller.id,
        // The owner's own name wins over the model's. It is their business.
        brand_name: brandName || draft.brand_name,
        vibe_summary: draft.vibe_summary,
        business_json: business,
        palette_json: draft.palette_json,
        typography_json: draft.typography_json,
        voice_rules_json: draft.voice_rules_json,
      })
      .select(KIT_COLUMNS)
      .single()
    if (error) throw new HttpError(500, 'write_failed', error.message)

    return json({ kit, logoConcept: draft.logo_concept, model })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase SDK is not edge-compatible. Duration is set in vercel.json. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
