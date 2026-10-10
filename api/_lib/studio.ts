/**
 * What the three Studio routes share: the prompts, the schemas, loading a kit, storing an image.
 *
 * The prompts live here rather than in each route so the rules of the voice are written
 * once. A brand kit says how a business talks; the copy route and the strategist both have to
 * hold the model to it, and two copies of the rules would drift.
 */

import { LOGO_KINDS, normalizeKitRow, type BrandKitRow } from '../../src/lib/brand.js'
import { HttpError, adminClient, type Caller } from './server.js'
import type { GeminiSchema } from './gemini.js'
import { extensionFor, type GeneratedImage } from './images.js'

/* ------------------------------------------------------------------ prompts */

/** Verbatim from the product spec. Everything after it is how this codebase enforces it. */
export const COPY_DIRECTIVE =
  "You are the Brandyzer Copy Engine. Strip robotic transitions, corporate buzzwords ('delve', 'tapestry', 'synergy'), and excessive emojis. Output conversational, grounded, small-business marketing text."

/**
 * The logo half of the strategist's instructions. The owner's answers to the logo questions
 * arrive in the prompt; this says how to turn them into a kind of logo and a brief an image
 * model can draw from. The image prompt adds its own fixed rules (LOGO_RULES) on top.
 */
export const LOGO_DIRECTIVE = [
  'LOGO:',
  '- The owner may have answered questions about their logo: the kind, the style, what it should show and what to avoid. Their answers outrank your taste. Never put in what they asked to avoid.',
  '- logo_type is one of: symbol (a pictorial mark, no lettering), wordmark (the name in custom lettering), combination (a symbol beside the name), monogram (the initials as one mark), emblem (a badge or stamp holding a symbol and the name).',
  '- If the owner chose a kind, use exactly that kind. If they left it to you, choose for the business: a symbol for most shops and makers; a wordmark only for a short, distinctive name of about ten letters or fewer; a monogram for a long name or a professional service; an emblem for traditional trades, food and drink, and crafts with a heritage feel.',
  '- logo_concept: one or two sentences an illustrator could draw from without asking a question. Name the single subject, how it is simplified, its outline shape, and which two or three palette colours it uses, by their names. Describe shapes only, never lettering: the name is added separately, exactly as written.',
  '- Draw from what the business really sells or a detail of its place. No stock icons (light bulbs, globes, swooshes, abstract arrows, generic leaves, gears) unless the owner asked for one.',
  '- It must still read at 32 pixels: one idea, few shapes, no fine detail, no more than three colours, nothing photographic.',
].join('\n')

export const STRATEGIST_DIRECTIVE = [
  'You are the Brandyzer brand strategist. You build a small business a brand kit it can use for years: a palette, two fonts, and rules for how it talks and how its photos look.',
  '',
  'RULES:',
  '- Ground every choice in what the business actually sells and who buys it. A bakery in a market town is not a fintech startup and should not look like one.',
  '- Palette: exactly five colours with roles background, neutral, primary, secondary, accent. Hex codes. Body text in the neutral colour must be readable on the background (WCAG AA, 4.5:1 or better). Give each colour a plain name a shop owner would use ("bread crust", not "Ethereal Amber").',
  '- Be specific to this business, not its category. Every potter gets terracotta and sage, every café gets brown and cream: start from that obvious palette, then change at least one colour to something a competitor would not have picked that still belongs to this business.',
  '- Typography: two fonts that exist on Google Fonts, spelled exactly as Google Fonts spells them. A heading font with character and a body font that is easy to read small. Say in one sentence why they fit.',
  '- Never pick Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Playfair Display or Lobster. They are on every site already and make every shop look the same.',
  '- If the business is somewhere that writes in Cyrillic (Kazakhstan, Russia, Ukraine, Kyrgyzstan and so on), or the owner wrote in Cyrillic, both fonts must include the Cyrillic subset on Google Fonts.',
  '- Voice: three to six tone directives, each a concrete instruction ("say what it costs up front"), not an adjective. Two or three example lines already written in the voice. Extra banned words this particular brand should never use, beyond the obvious marketing clichés.',
  '- Image style: three to five photography directives about light, lens, film, setting and composition, specific enough that two photographers would shoot alike. Prefer real places, natural light and real textures over studio gloss.',
  '- Vibe summary: two or three plain sentences an owner would recognise as their business.',
  '- Write like a person. No buzzwords: never use delve, tapestry, synergy, elevate, unlock, seamless, game-changer, testament or realm.',
  '- Language: write the vibe summary, colour names, tone directives, example lines and extra banned words in the language the owner wrote their answers in. Write image_style and logo_concept in English whatever the owner used, because image models read English best. Keep the business name exactly as the owner wrote it.',
  '',
  LOGO_DIRECTIVE,
].join('\n')

export const BRAND_KIT_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    brand_name: { type: 'STRING' },
    vibe_summary: { type: 'STRING' },
    palette: {
      type: 'ARRAY',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          hex: { type: 'STRING', description: 'Six-digit hex, e.g. #C65D3B' },
          role: { type: 'STRING', enum: ['background', 'neutral', 'primary', 'secondary', 'accent'] },
        },
        required: ['name', 'hex', 'role'],
      },
    },
    typography: {
      type: 'OBJECT',
      properties: {
        heading: { type: 'OBJECT', properties: { family: { type: 'STRING' }, weight: { type: 'INTEGER' }, fallback: { type: 'STRING', enum: ['serif', 'sans-serif', 'monospace', 'cursive'] } }, required: ['family', 'weight', 'fallback'] },
        body: { type: 'OBJECT', properties: { family: { type: 'STRING' }, weight: { type: 'INTEGER' }, fallback: { type: 'STRING', enum: ['serif', 'sans-serif', 'monospace', 'cursive'] } }, required: ['family', 'weight', 'fallback'] },
        rationale: { type: 'STRING' },
      },
      required: ['heading', 'body', 'rationale'],
    },
    voice_rules: {
      type: 'OBJECT',
      properties: {
        tone: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 6 },
        banned_words: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 20 },
        examples: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 3 },
        image_style: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 5 },
      },
      required: ['tone', 'banned_words', 'examples', 'image_style'],
    },
    logo_type: { type: 'STRING', enum: [...LOGO_KINDS] },
    logo_concept: { type: 'STRING', description: 'One or two sentences describing shapes and palette colours. No lettering.' },
  },
  required: ['brand_name', 'vibe_summary', 'palette', 'typography', 'voice_rules', 'logo_type', 'logo_concept'],
}

export const COPY_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    variants: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          angle: { type: 'STRING', description: 'Four to eight words on what makes this variant different from the others.' },
        },
        required: ['text', 'angle'],
      },
    },
  },
  required: ['variants'],
}

/* ------------------------------------------------------------------ kits */

export const KIT_COLUMNS = 'id, user_id, brand_name, vibe_summary, business_json, palette_json, typography_json, voice_rules_json, logo_url, created_at, updated_at'

/**
 * A kit, read as the caller — so row level security decides who gets it.
 *
 * That is what lets a hired freelancer write copy and draw images in a client's brand
 * without a line of code saying so: while their contract is funded or in review, the
 * `brand_kits_shared` policy lets them read it, and nothing else here needs to know.
 */
export async function loadKit(caller: Caller, id: string): Promise<BrandKitRow> {
  const { data, error } = await caller.db.from('brand_kits').select(KIT_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new HttpError(500, 'read_failed', error.message)
  if (!data) throw new HttpError(404, 'not_found', 'That brand kit does not exist or is not shared with you.')
  // Normalised on the way in: the owner may have edited the JSON by hand, and a `tone` that
  // is a string rather than a list would otherwise throw halfway through writing a prompt.
  return normalizeKitRow(data as unknown as BrandKitRow)
}

/* ------------------------------------------------------------------ images */

/**
 * Puts a generated image in the public brand-assets bucket and returns its URL.
 *
 * The service role writes it, under a path built here from the verified caller id and a
 * random uuid — nothing from the request reaches the path, so there is nothing to traverse
 * with and nothing to overwrite.
 */
export async function storeImage(callerId: string, image: GeneratedImage): Promise<string> {
  const path = `${callerId}/${crypto.randomUUID()}.${extensionFor(image.contentType)}`
  const bucket = adminClient().storage.from('brand-assets')
  const { error } = await bucket.upload(path, image.bytes, { contentType: image.contentType, upsert: false })
  if (error) throw new HttpError(500, 'upload_failed', error.message)
  return bucket.getPublicUrl(path).data.publicUrl
}
