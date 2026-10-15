/**
 * Writes a website's text from the brand kit: tagline, about, and the things the business
 * sells. One copy request from the monthly allowance, in the kit's voice and under its FACTS
 * rule, so it names what the owner described and never invents a price, an address or hours.
 */

import { HttpError, fail, json, readJson, requireMethod, requireUser, str, uuidOrNull } from '../_lib/server.js'
import { generateJson, type TextSchema } from '../_lib/text.js'
import { loadKit, takeQuota } from '../_lib/studio.js'
import { voiceInstructions } from './copy.js'

const LANGUAGES = new Map([
  ['en', 'English'],
  ['ru', 'Russian'],
  ['kk', 'Kazakh'],
])

const SITE_SCHEMA: TextSchema = {
  type: 'OBJECT',
  properties: {
    tagline: { type: 'STRING', description: 'One sentence under the brand name.' },
    about: { type: 'STRING', description: 'Two to four sentences about the business.' },
    items: {
      type: 'ARRAY',
      maxItems: 8,
      items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, note: { type: 'STRING' } }, required: ['name', 'note'] },
    },
  },
  required: ['tagline', 'about', 'items'],
}

const SITE_DIRECTIVE =
  'Now write the text of a one-page website for this business: a tagline (one sentence), an about section (two to four sentences), and up to eight things it sells or offers, each with a short note. Name only what the owner described or plainly implied. Never invent prices, opening hours, addresses or phone numbers.'

async function handler(req: Request): Promise<Response> {
  let giveBack: (() => Promise<void>) | undefined
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const body = await readJson<{ brandKitId?: unknown; language?: unknown }>(req)
    const kitId = uuidOrNull(body.brandKitId)
    if (!kitId) throw new HttpError(400, 'invalid_input', 'Which brand kit?')
    const language = LANGUAGES.get(String(body.language)) ?? 'English'

    const kit = await loadKit(caller, kitId)
    giveBack = (await takeQuota(caller.id, 'copy')).giveBack
    const b = kit.business_json
    const prompt = [`Business: ${b?.offering ?? kit.vibe_summary}`, b?.audience && `Customers: ${b.audience}`, b?.location && `Where: ${b.location}`].filter(Boolean).join('\n')
    const { data, model } = await generateJson<{ tagline?: unknown; about?: unknown; items?: { name?: unknown; note?: unknown }[] }>({
      system: `${voiceInstructions(kit, 'website_hero', language)}\n\n${SITE_DIRECTIVE}`,
      prompt,
      schema: SITE_SCHEMA,
      deadline: Date.now() + 140_000,
    })
    const items = (Array.isArray(data.items) ? data.items : [])
      .slice(0, 8)
      .map((i) => ({ name: str(i?.name, 80), price: '', note: str(i?.note, 160) }))
      .filter((i) => i.name)
    return json({ tagline: str(data.tagline, 240), about: str(data.about, 1200), items, model })
  } catch (error) {
    await giveBack?.().catch(() => {})
    return fail(error)
  }
}

export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime drops a default export's returned Response; named methods get the Web `Request`. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
