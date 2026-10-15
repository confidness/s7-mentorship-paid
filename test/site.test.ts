/** Websites: every template renders, owner text cannot become markup, addresses are valid. */

import { SLUG_RE, TEMPLATE_IDS, defaultContent, renderSite, slugify } from '../src/lib/site.ts'
import type { BrandKitRow } from '../src/lib/brand.ts'

declare const process: { exitCode?: number }
let failures = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) {
    failures++
    console.error(`  FAIL  ${name}`, detail ?? '')
  }
}

const kit = {
  id: '11111111-1111-4111-8111-111111111111',
  brand_name: 'Утро',
  vibe_summary: 'A small coffee shop.',
  business_json: { offering: 'coffee', audience: '', location: 'Almaty', vibe_words: [], logo: {} },
  palette_json: [
    { name: 'a', hex: '#F7F1E8', role: 'background' },
    { name: 'b', hex: '#2B2118', role: 'neutral' },
    { name: 'c', hex: '#C65D3B', role: 'primary' },
    { name: 'd', hex: '#8A9A5B', role: 'secondary' },
    { name: 'e', hex: '#E0B04A', role: 'accent' },
  ],
  typography_json: { heading: { family: 'PT Serif', weight: 700, fallback: 'serif' }, body: { family: 'PT Sans', weight: 400, fallback: 'sans-serif' }, rationale: '' },
  voice_rules_json: { tone: [], banned_words: [], examples: ['Coffee from seven.'], image_style: [] },
  logo_url: null,
} as unknown as BrandKitRow

for (const template of TEMPLATE_IDS) {
  const html = renderSite(kit, { ...defaultContent(kit, 'ru'), template, items: [{ name: 'Латте', price: '1 200 ₸', note: '' }], phone: '+7 701 000 00 00', instagram: '@utro.coffee' })
  check(`${template}: a whole document`, html.startsWith('<!doctype html>') && html.includes('</html>'))
  check(`${template}: the item is listed`, html.includes('Латте') && html.includes('1 200 ₸'))
  check(`${template}: headings in the site language`, html.includes('Как нас найти'))
}

const evil = renderSite(kit, { ...defaultContent(kit, 'en'), headline: '<script>alert(1)</script>', instagram: 'javascript:alert(1)', phone: 'javascript:alert(1)1' })
check('owner text is escaped, never markup', !evil.includes('<script>') && evil.includes('&#60;script&#62;'), evil.slice(0, 400))
check('no javascript: link can be built', !/href="javascript/i.test(evil))
check('no script tag anywhere', !/<script/i.test(evil))

check('Cyrillic becomes a valid address', SLUG_RE.test(slugify('Кофейня Утро')) && slugify('Кофейня Утро') === 'kofeinya-utro', slugify('Кофейня Утро'))
check('Kazakh letters too', slugify('Қызыл гүл') === 'qyzyl-gul', slugify('Қызыл гүл'))

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ eight templates render, owner text stays text, and addresses are valid')
}
