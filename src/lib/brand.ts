/**
 * What a brand kit is, in one place.
 *
 * Shared by the browser, which renders a kit, and the server, which asks a model for one and
 * stores it. So it must not import anything browser- or node-specific — the same constraint
 * money.ts lives under.
 *
 * The model's output is untrusted input like any other. It arrives shaped by a response
 * schema, which makes it likely to be well-formed and guarantees nothing: a colour can come
 * back as "warm terracotta", a font family as `Inter; } body { display:none`. Everything
 * the model says goes through `normalizeBrandKit` before it reaches a row, and what comes out
 * is something the interface can render without asking further questions.
 */

/* ------------------------------------------------------------------ shapes */

export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'neutral', 'background'] as const
export type ColorRole = (typeof COLOR_ROLES)[number]

export interface PaletteColor {
  name: string
  hex: string
  role: ColorRole
}

export const FONT_FALLBACKS = ['serif', 'sans-serif', 'monospace', 'cursive'] as const
export type FontFallback = (typeof FONT_FALLBACKS)[number]

export interface FontChoice {
  family: string
  weight: number
  fallback: FontFallback
}

export interface Typography {
  heading: FontChoice
  body: FontChoice
  rationale: string
}

export interface VoiceRules {
  /** Directives for how the brand talks: "short sentences", "sound like the owner, not a chain". */
  tone: string[]
  /** Never written in this brand's copy. Always includes the house list below. */
  banned_words: string[]
  /** A few lines already in the voice, which teach a model more than any adjective does. */
  examples: string[]
  /** Carried into every image prompt: "natural lighting", "35mm film grain". */
  image_style: string[]
}

export interface BusinessInfo {
  offering: string
  audience: string
  location: string
  vibe_words: string[]
}

/** A brand_kits row as the browser reads it. */
export interface BrandKitRow {
  id: string
  user_id: string
  brand_name: string
  vibe_summary: string
  business_json: BusinessInfo
  palette_json: PaletteColor[]
  typography_json: Typography
  voice_rules_json: VoiceRules
  logo_url: string | null
  created_at: string
  updated_at: string
}

/** What the server writes for a new kit, plus the prompt it will draw the logo from. */
export interface BrandKitDraft {
  brand_name: string
  vibe_summary: string
  palette_json: PaletteColor[]
  typography_json: Typography
  voice_rules_json: VoiceRules
  logo_concept: string
}

/* ------------------------------------------------------------------ the anti-slop list */

/**
 * Words and phrases that mark text as machine-written, banned in every kit by default.
 *
 * Not a style preference. A small business's customers have read these a thousand times in
 * the last year and they now read as "nobody wrote this" — which is the opposite of what a
 * corner shop's caption is for. A kit may add its own; it cannot remove these.
 */
export const DEFAULT_BANNED_WORDS = [
  'delve',
  'tapestry',
  'synergy',
  'leverage',
  'elevate',
  'unlock',
  'unleash',
  'seamless',
  'game-changer',
  'cutting-edge',
  'revolutionize',
  'testament',
  'realm',
  'embark',
  'bustling',
  'nestled',
  'holistic',
  'world-class',
  'best-in-class',
  'dive into',
  'look no further',
  "in today's fast-paced world",
  'moreover',
  'furthermore',
  'additionally',
  'in conclusion',
] as const

/** The spec's own example, and a good default for a business that has said nothing yet. */
export const DEFAULT_IMAGE_STYLE = ['natural lighting', '35mm film grain', 'photorealistic product style']

/* ------------------------------------------------------------------ normalising */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#abc` and `ABCDEF` both become `#AABBCC`; anything else is not a colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(HEX)
  if (!m) return null
  const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${digits.toUpperCase()}`
}

/**
 * A font family name safe to put in a stylesheet and a Google Fonts URL.
 *
 * Letters, digits and spaces only. Every real Google font fits that, and nothing that does
 * can close a declaration or break out of a query string.
 */
export function safeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const family = value.replace(/["']/g, '').trim().replace(/\s+/g, ' ')
  return /^[A-Za-z0-9 ]{2,60}$/.test(family) ? family : null
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function list(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const clean = text(item, maxLength)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= maxItems) break
  }
  return out
}

function font(raw: unknown, fallbackFamily: string, fallbackWeight: number): FontChoice {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const weight = Number(obj.weight)
  return {
    family: safeFontFamily(obj.family) ?? fallbackFamily,
    // Whole hundreds, 100 to 900: the only weights a font file actually ships.
    weight: Number.isInteger(weight) && weight >= 100 && weight <= 900 && weight % 100 === 0 ? weight : fallbackWeight,
    fallback: (FONT_FALLBACKS as readonly string[]).includes(String(obj.fallback)) ? (obj.fallback as FontFallback) : 'sans-serif',
  }
}

/** Banned words, lower-cased, de-duplicated, and always including the house list. */
export function mergeBannedWords(extra: unknown): string[] {
  return [...new Set([...DEFAULT_BANNED_WORDS, ...list(extra, 40, 40).map((w) => w.toLowerCase())])]
}

export function normalizeVoiceRules(raw: unknown): VoiceRules {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const imageStyle = list(obj.image_style, 8, 120)
  return {
    tone: list(obj.tone, 8, 200),
    banned_words: mergeBannedWords(obj.banned_words),
    examples: list(obj.examples, 4, 280),
    image_style: imageStyle.length ? imageStyle : [...DEFAULT_IMAGE_STYLE],
  }
}

export function normalizePalette(raw: unknown): PaletteColor[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PaletteColor[] = []
  for (const item of raw) {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const hex = normalizeHex(obj.hex)
    if (!hex || seen.has(hex)) continue
    seen.add(hex)
    const role = (COLOR_ROLES as readonly string[]).includes(String(obj.role)) ? (obj.role as ColorRole) : 'accent'
    out.push({ name: text(obj.name, 40) || hex, hex, role })
    if (out.length >= 8) break
  }
  return out
}

export function normalizeBusiness(raw: unknown): BusinessInfo {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    offering: text(obj.offering, 500),
    audience: text(obj.audience, 300),
    location: text(obj.location, 120),
    vibe_words: list(obj.vibe_words, 6, 30),
  }
}

export function normalizeTypography(raw: unknown): Typography {
  const typo = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    heading: font(typo.heading, 'Fraunces', 700),
    body: font(typo.body, 'Inter', 400),
    rationale: text(typo.rationale, 400),
  }
}

/**
 * A row as read back from the database, made safe to render.
 *
 * The owner may write their own kit's JSON directly — row level security allows it, and it
 * should — so what comes back is whatever they wrote, and it is rendered in somebody else's
 * browser when a freelancer opens a shared kit. Running it through the same normalisers as
 * the model's output means a hand-edited palette cannot crash that page, and a "hex" of
 * `red; background: url(…)` never reaches a style attribute.
 */
export function normalizeKitRow<T extends BrandKitRow>(row: T): T {
  return {
    ...row,
    business_json: normalizeBusiness(row.business_json),
    palette_json: normalizePalette(row.palette_json),
    typography_json: normalizeTypography(row.typography_json),
    voice_rules_json: normalizeVoiceRules(row.voice_rules_json),
    logo_url: typeof row.logo_url === 'string' && /^https:\/\//.test(row.logo_url) ? row.logo_url : null,
  }
}

/**
 * Turns whatever the model sent into a kit the app can store and render, or null.
 *
 * Null only when there is nothing usable to save: no name, or fewer than three colours. A
 * kit with two colours is not a palette, and saving it would hand the owner a broken page
 * they did not cause. Everything short of that is repaired rather than refused — a missing
 * font gets a sensible default, a missing banned list gets the house one.
 */
export function normalizeBrandKit(raw: unknown, fallbackName = ''): BrandKitDraft | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const brand_name = text(obj.brand_name, 120) || text(fallbackName, 120)
  const palette_json = normalizePalette(obj.palette)
  if (!brand_name || palette_json.length < 3) return null

  return {
    brand_name,
    vibe_summary: text(obj.vibe_summary, 2000),
    palette_json,
    typography_json: normalizeTypography(obj.typography),
    voice_rules_json: normalizeVoiceRules(obj.voice_rules),
    logo_concept: text(obj.logo_concept, 300),
  }
}

/* ------------------------------------------------------------------ checking copy */

export interface SlopReport {
  clean: boolean
  /** Machine-readable, e.g. `banned:delve`, `emoji:4`. The interface translates them. */
  issues: string[]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The deterministic half of anti-slop.
 *
 * A model asked not to say "delve" will mostly not say it, and "mostly" is the problem: the
 * one caption that slips through is the one the owner posts. So every reply is read back
 * against the kit's own banned list, plus the three tells no list catches — a fistful of
 * emoji, a row of exclamation marks, and the em dash a model reaches for every other line.
 */
export function slopCheck(text: string, bannedWords: readonly string[]): SlopReport {
  const issues: string[] = []
  const lower = text.toLowerCase()
  for (const word of bannedWords) {
    const w = word.toLowerCase().trim()
    if (!w) continue
    // Whole words, so "realm" does not fire inside "realmente". The ordinary inflections
    // count as the word — "elevated", "leveraging", "unlocks" are the same tell — including
    // the dropped e of "leverage" → "leveraging".
    const forms = [`${escape(w)}(?:s|d|ed|es|ing)?`]
    if (w.endsWith('e')) forms.push(`${escape(w.slice(0, -1))}ing`)
    const re = new RegExp(`(?:^|[^a-z])(?:${forms.join('|')})(?![a-z])`, 'i')
    if (re.test(lower)) issues.push(`banned:${w}`)
  }
  const emoji = text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0
  if (emoji > 2) issues.push(`emoji:${emoji}`)
  const bangs = text.match(/!/g)?.length ?? 0
  if (bangs > 2) issues.push(`exclamation:${bangs}`)
  const dashes = text.match(/—/g)?.length ?? 0
  if (dashes > 1) issues.push(`em_dash:${dashes}`)
  return { clean: issues.length === 0, issues }
}

/* ------------------------------------------------------------------ copy formats */

export const COPY_FORMATS = ['instagram_caption', 'product_description', 'email', 'website_hero', 'google_ad'] as const
export type CopyFormat = (typeof COPY_FORMATS)[number]

/** What each format is, told to the model. The interface has its own translated labels. */
export const COPY_GUIDANCE: Record<CopyFormat, string> = {
  instagram_caption: 'An Instagram caption. The first line has to stop a thumb. Under 600 characters. At most two emoji, and none is fine. Up to three plain hashtags at the very end.',
  product_description: 'A product description for an online shop. What it is, what it is made of or how it works, who it is for. Under 120 words. No headings.',
  email: 'A short email to existing customers. First line is the subject, prefixed "Subject: ". Then a blank line and a body under 150 words that reads like the owner wrote it.',
  website_hero: 'The headline and one-line subheadline at the top of a homepage. Headline under 9 words. Put the subheadline on its own line.',
  google_ad: 'A search ad: three headlines of at most 30 characters each, one per line, then a description of at most 90 characters on the last line.',
}

/* ------------------------------------------------------------------ image prompts */

export const IMAGE_PURPOSES = ['photo', 'logo'] as const
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number]

export const IMAGE_SHAPES = { square: [1024, 1024], portrait: [896, 1152], landscape: [1152, 896] } as const
export type ImageShape = keyof typeof IMAGE_SHAPES

/** Pollinations takes the prompt in the URL path, so it stays well under any URL limit. */
export const MAX_IMAGE_PROMPT = 900

/**
 * Writes the prompt an image model is given, with the brand folded in.
 *
 * The kit's image_style directives go into every photo, which is the whole point of having a
 * kit: the tenth image looks like it came from the same shop as the first. Colours are named
 * with their hex, because "sage" alone means a different green to every model.
 *
 * A logo is asked for without lettering. Image models still cannot spell, and a garbled
 * brand name is worse than no name — the name is set in the kit's own heading font instead.
 */
export function buildImagePrompt(input: {
  purpose: ImagePurpose
  subject: string
  brandName: string
  offering?: string
  palette: PaletteColor[]
  imageStyle: string[]
}): string {
  const colours = input.palette
    .slice(0, 5)
    .map((c) => `${c.name} ${c.hex}`)
    .join(', ')
  const style = (input.imageStyle.length ? input.imageStyle : DEFAULT_IMAGE_STYLE).join(', ')
  const subject = text(input.subject, 400)

  const parts =
    input.purpose === 'logo'
      ? [
          `Minimal flat vector logo mark for "${text(input.brandName, 80)}"${input.offering ? `, ${text(input.offering, 120)}` : ''}`,
          subject,
          'one simple memorable symbol, centered, plain solid background, crisp edges',
          colours && `colours: ${colours}`,
          'no text, no letters, no words, no mockup, no gradients, no 3D render',
        ]
      : [
          subject,
          style,
          colours && `colour palette: ${colours}`,
          'candid composition, true-to-life colour, real textures',
          'no text, no watermark, no logos, no plastic skin, no oversaturated HDR',
        ]

  return parts
    .filter(Boolean)
    .join('. ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_IMAGE_PROMPT)
}

/**
 * Google Fonts stylesheets for a kit's families, one per family, for previewing them.
 *
 * One link each and no weight axis, on purpose. Google answers a request naming a weight a
 * family does not ship with a 400 for the whole stylesheet, and a model picks fonts like
 * Pacifico that ship exactly one. Asking separately means one odd choice cannot take the
 * other font down with it.
 */
export function googleFontsHrefs(t: Typography): string[] {
  const families = [...new Set([t.heading, t.body].map((f) => f.family))]
  return families.map((f) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}&display=swap`)
}
