/**
 * What a brand kit is allowed to contain, and what anti-slop actually catches.
 *
 * The model's output is untrusted input. These checks feed `normalizeBrandKit` the kinds of
 * thing a model really sends — a colour by name, a font with a stylesheet in it, a palette
 * of two — and the kinds of thing an owner editing their own JSON could write, and assert
 * that what comes out is safe to store and to render in somebody else's browser.
 */

import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_IMAGE_STYLE,
  MAX_IMAGE_PROMPT,
  buildImagePrompt,
  googleFontsHrefs,
  normalizeBrandKit,
  normalizeHex,
  normalizeKitRow,
  safeFontFamily,
  slopCheck,
  type BrandKitRow,
} from '../src/lib/brand.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })

/* ------------------------------------------------------------------ colours and fonts */

console.log('colours and fonts')

eq('a 6-digit hex is upper-cased', normalizeHex('#c65d3b'), '#C65D3B')
eq('a 3-digit hex is expanded', normalizeHex('#abc'), '#AABBCC')
eq('a missing # is added', normalizeHex('112233'), '#112233')
eq('a colour name is not a colour', normalizeHex('terracotta'), null)
eq('neither is a CSS expression', normalizeHex('red; background:url(x)'), null)

eq('a real Google font survives', safeFontFamily('Playfair Display'), 'Playfair Display')
eq('quotes are dropped', safeFontFamily('"Inter"'), 'Inter')
eq('a font that closes a declaration is refused', safeFontFamily('Inter; } body { display:none'), null)
eq('so is one that would break a URL', safeFontFamily('Inter&family=Evil'), null)

{
  const hrefs = googleFontsHrefs({ heading: { family: 'Playfair Display', weight: 700, fallback: 'serif' }, body: { family: 'Inter', weight: 400, fallback: 'sans-serif' }, rationale: '' })
  eq('one stylesheet per family, so one bad family cannot take down the other', hrefs.length, 2)
  check('spaces become plus signs, as Google expects', hrefs[0].includes('family=Playfair+Display'), hrefs)
  check('no weight axis is requested', !hrefs.some((h) => h.includes('wght')), hrefs)
}

/* ------------------------------------------------------------------ whole kits */

console.log('normalising what the model sends')

const modelReply = {
  brand_name: 'Crumb & Co',
  vibe_summary: 'A neighbourhood bakery.',
  palette: [
    { name: 'flour', hex: '#F7F1E8', role: 'background' },
    { name: 'oven', hex: '#3B2A20', role: 'neutral' },
    { name: 'crust', hex: '#C65D3B', role: 'primary' },
    { name: 'crust again', hex: '#c65d3b', role: 'secondary' },
    { name: 'sage', hex: '#8A9A5B', role: 'sparkly' },
    { name: 'butter', hex: 'buttery yellow', role: 'accent' },
  ],
  typography: { heading: { family: 'Fraunces', weight: 750, fallback: 'serif' }, body: { family: 'Inter; }', weight: 400, fallback: 'comic' }, rationale: 'Warm.' },
  voice_rules: { tone: ['Say the price', 'say the price'], banned_words: ['Artisanal', 'DELVE'], examples: ['Out of the oven at 7.'], image_style: [] },
  logo_concept: 'A wheat stalk',
}

{
  const kit = normalizeBrandKit(modelReply)!
  check('a usable reply becomes a kit', kit !== null)
  eq('duplicate hexes collapse to one', kit.palette_json.filter((c) => c.hex === '#C65D3B').length, 1)
  eq('a colour without a hex is dropped', kit.palette_json.some((c) => c.name === 'butter'), false)
  eq('an unknown role becomes accent', kit.palette_json.find((c) => c.name === 'sage')?.role, 'accent')
  eq('a weight that no font file ships falls back', kit.typography_json.heading.weight, 700)
  eq('an injected body font falls back to Inter', kit.typography_json.body.family, 'Inter')
  eq('an unknown fallback becomes sans-serif', kit.typography_json.body.fallback, 'sans-serif')
  eq('tone lines are de-duplicated', kit.voice_rules_json.tone.length, 1)
  check('the kit’s own banned words are kept, lower-cased', kit.voice_rules_json.banned_words.includes('artisanal'))
  check('the house list is always present', DEFAULT_BANNED_WORDS.every((w) => kit.voice_rules_json.banned_words.includes(w)))
  eq('"delve" appears once, not twice', kit.voice_rules_json.banned_words.filter((w) => w === 'delve').length, 1)
  eq('an empty photo style gets the default', kit.voice_rules_json.image_style.join(), DEFAULT_IMAGE_STYLE.join())
}

eq('two colours is not a palette', normalizeBrandKit({ ...modelReply, palette: modelReply.palette.slice(0, 2) }), null)
eq('no name and no fallback is not a kit', normalizeBrandKit({ ...modelReply, brand_name: '' }), null)
eq('the owner’s own name fills a blank one', normalizeBrandKit({ ...modelReply, brand_name: '' }, 'Bread Shop')?.brand_name, 'Bread Shop')
eq('a reply that is not an object is nothing', normalizeBrandKit('sure! here is your kit'), null)

console.log('rows edited by hand still render')
{
  // What an owner could write straight into their own row with the anon key.
  const hostile = {
    id: 'k1',
    user_id: 'u1',
    brand_name: 'X',
    vibe_summary: '',
    business_json: 'not an object',
    palette_json: [{ hex: 'red; background:url(https://tracker.example)' }, 'nonsense', { hex: '#000' }],
    typography_json: null,
    voice_rules_json: { tone: 'a string, not a list', banned_words: 42 },
    logo_url: 'javascript:alert(1)',
    created_at: '',
    updated_at: '',
  } as unknown as BrandKitRow
  let row: BrandKitRow | null = null
  try {
    row = normalizeKitRow(hostile)
  } catch (error) {
    check('normalising a hostile row does not throw', false, String(error))
  }
  if (row) {
    eq('only real colours survive', row.palette_json.map((c) => c.hex).join(), '#000000')
    eq('a non-https logo is dropped', row.logo_url, null)
    check('tone becomes a list', Array.isArray(row.voice_rules_json.tone))
    check('fonts are filled in', row.typography_json.heading.family.length > 0 && row.typography_json.body.family.length > 0)
    check('business info becomes an object', typeof row.business_json.offering === 'string')
  }
}

/* ------------------------------------------------------------------ anti-slop */

console.log('anti-slop')

const banned = [...DEFAULT_BANNED_WORDS]
const issues = (text: string) => slopCheck(text, banned).issues

check('"delve" is caught', issues('Let us delve into our menu.').includes('banned:delve'))
check('so are "delves" and "delving"', issues('She delves into flavour.').includes('banned:delve') && issues('Delving into rye.').includes('banned:delve'))
check('"elevated" is the same tell as "elevate"', issues('An elevated experience.').includes('banned:elevate'))
check('"leveraging" drops the e and is still caught', issues('Leveraging local grain.').includes('banned:leverage'))
check('phrases are caught', issues("In today's fast-paced world, bread matters.").includes("banned:in today's fast-paced world"))
check('case does not matter', issues('SYNERGY at the bakery').includes('banned:synergy'))
eq('a word inside another word is not a hit', issues('Realmente bueno.').length, 0)
eq('plain good copy is clean', slopCheck('Cardamom buns are back on Saturday. Two for the price of one until ten.', banned).clean, true)
check('three emoji is too many', issues('Fresh 🍞🥐🎉').includes('emoji:3'))
eq('two is allowed', issues('Fresh 🍞🥐').length, 0)
check('a row of exclamation marks is caught', issues('Wow! Bread! Now! Here!').includes('exclamation:4'))
check('em dashes are counted', issues('Bread — warm — fresh').includes('em_dash:2'))
eq('a single em dash is fine', issues('Bread — warm.').length, 0)

/* ------------------------------------------------------------------ image prompts */

console.log('image prompts carry the brand')

const palette = [
  { name: 'crust', hex: '#C65D3B', role: 'primary' as const },
  { name: 'flour', hex: '#F7F1E8', role: 'background' as const },
]

{
  const prompt = buildImagePrompt({ purpose: 'photo', subject: 'sourdough on a counter', brandName: 'Crumb', palette, imageStyle: ['window light', 'Portra 400 grain'] })
  check('the subject is there', prompt.startsWith('sourdough on a counter'), prompt)
  check('the kit’s photo style is added automatically', prompt.includes('window light') && prompt.includes('Portra 400 grain'), prompt)
  check('colours are named with their hex', prompt.includes('crust #C65D3B'), prompt)
  check('the anti-slop negatives are there', prompt.includes('no watermark') && prompt.includes('no plastic skin'), prompt)
}

{
  const prompt = buildImagePrompt({ purpose: 'photo', subject: 'a cake', brandName: 'Crumb', palette, imageStyle: [] })
  check('a kit with no style gets the spec’s default', DEFAULT_IMAGE_STYLE.every((s) => prompt.includes(s)), prompt)
}

{
  const prompt = buildImagePrompt({ purpose: 'logo', subject: 'a wheat stalk', brandName: 'Crumb', offering: 'a bakery', palette, imageStyle: ['35mm film grain'] })
  check('a logo asks for no lettering', prompt.includes('no text, no letters'), prompt)
  check('a logo does not get photo grain', !prompt.includes('35mm'), prompt)
  check('a logo names the brand it is for', prompt.includes('"Crumb"'), prompt)
}

{
  const prompt = buildImagePrompt({ purpose: 'photo', subject: 'x'.repeat(5000), brandName: 'Crumb', palette, imageStyle: ['a', 'b'] })
  check('prompts stay under the URL-safe ceiling', prompt.length <= MAX_IMAGE_PROMPT, prompt.length)
  check('and carry no line breaks', !prompt.includes(NL))
}

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ kits are repaired before they are stored, slop is caught, and every image carries the brand')
}
