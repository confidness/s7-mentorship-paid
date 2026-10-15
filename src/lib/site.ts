/**
 * Websites from a brand kit: eight templates, one renderer.
 *
 * A template is a handful of layout choices, not a page of its own, so every template gets the
 * same escaping, the same palette maths and the same fonts, and an eighth costs a config line.
 * The output is one standalone HTML document with no scripts: it previews in a sandboxed
 * iframe, downloads as a file that works anywhere, and is what a published site serves.
 */

import { googleFontsHrefs, type BrandKitRow } from './brand'

export type TemplateId = 'cafe' | 'bakery' | 'flowers' | 'salon' | 'restaurant' | 'boutique' | 'fitness' | 'services'

interface Template {
  hero: 'split' | 'cover' | 'centered'
  dark: boolean
  radius: number
  upper: boolean
  items: 'list' | 'grid'
}

export const TEMPLATES: Record<TemplateId, Template> = {
  cafe: { hero: 'split', dark: false, radius: 18, upper: false, items: 'list' },
  bakery: { hero: 'centered', dark: false, radius: 28, upper: false, items: 'grid' },
  flowers: { hero: 'cover', dark: false, radius: 999, upper: false, items: 'grid' },
  salon: { hero: 'split', dark: false, radius: 2, upper: true, items: 'list' },
  restaurant: { hero: 'cover', dark: true, radius: 6, upper: true, items: 'list' },
  boutique: { hero: 'centered', dark: false, radius: 0, upper: true, items: 'grid' },
  fitness: { hero: 'cover', dark: true, radius: 10, upper: true, items: 'grid' },
  services: { hero: 'split', dark: false, radius: 12, upper: false, items: 'list' },
}
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]

export type SiteLang = 'en' | 'ru' | 'kk'

/** The site's own headings, in the language the site is written in, not the editor's. */
const LABELS: Record<SiteLang, Record<'about' | 'hours' | 'find' | 'call' | 'made' | TemplateId, string>> = {
  en: { about: 'About us', hours: 'Opening hours', find: 'Find us', call: 'Call us', made: 'Made with Brandyzer', cafe: 'Menu', bakery: 'Today’s bakes', flowers: 'Bouquets', salon: 'Services & prices', restaurant: 'Menu', boutique: 'New in', fitness: 'Classes', services: 'Prices' },
  ru: { about: 'О нас', hours: 'Часы работы', find: 'Как нас найти', call: 'Позвонить', made: 'Сделано в Brandyzer', cafe: 'Меню', bakery: 'Сегодня в печи', flowers: 'Букеты', salon: 'Услуги и цены', restaurant: 'Меню', boutique: 'Новинки', fitness: 'Занятия', services: 'Цены' },
  kk: { about: 'Біз туралы', hours: 'Жұмыс уақыты', find: 'Бізді табу', call: 'Қоңырау шалу', made: 'Brandyzer-де жасалған', cafe: 'Мәзір', bakery: 'Бүгін пеште', flowers: 'Гүл шоқтары', salon: 'Қызметтер мен бағалар', restaurant: 'Мәзір', boutique: 'Жаңалықтар', fitness: 'Сабақтар', services: 'Бағалар' },
}

export interface SiteItem {
  name: string
  price: string
  note: string
}

export interface SiteContent {
  template: TemplateId
  lang: SiteLang
  headline: string
  tagline: string
  about: string
  items: SiteItem[]
  hours: string
  address: string
  phone: string
  instagram: string
}

export function defaultContent(kit: BrandKitRow, lang: SiteLang): SiteContent {
  return {
    template: 'cafe',
    lang,
    headline: kit.brand_name,
    tagline: kit.voice_rules_json.examples?.[0] ?? '',
    about: kit.vibe_summary,
    items: [],
    hours: '',
    address: kit.business_json?.location ?? '',
    phone: '',
    instagram: '',
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const lines = (s: string) => esc(s.trim()).replace(/\n/g, '<br>')

/** Black or white, whichever reads on this colour. */
function ink(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff'
}

export function renderSite(kit: BrandKitRow, c: SiteContent): string {
  const t = TEMPLATES[c.template] ?? TEMPLATES.cafe
  const L = LABELS[c.lang] ?? LABELS.en
  const color = (role: string, fallback: string) => kit.palette_json.find((p) => p.role === role)?.hex ?? fallback
  const primary = color('primary', '#333333')
  const accent = color('accent', primary)
  const bg = t.dark ? color('neutral', '#151515') : color('background', '#ffffff')
  const text = t.dark ? color('background', '#f5f5f5') : color('neutral', '#1a1a1a')
  const head = kit.typography_json.heading
  const body = kit.typography_json.body
  const r = `${t.radius}px`
  const phone = c.phone.replace(/[^\d+]/g, '')
  const insta = c.instagram.replace(/^@|^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[^\w.]/g, '')
  const logo = kit.logo_url?.startsWith('https://') ? `<img class="logo" src="${esc(kit.logo_url)}" alt="${esc(kit.brand_name)}">` : ''

  const items = c.items.filter((i) => i.name.trim())
  const itemHtml = items
    .map((i) => `<div class="item"><div><strong>${esc(i.name)}</strong>${i.note.trim() ? `<p>${esc(i.note)}</p>` : ''}</div>${i.price.trim() ? `<span class="price">${esc(i.price)}</span>` : ''}</div>`)
    .join('')
  const cta = phone ? `<a class="btn" href="tel:${phone}">${L.call}</a>` : insta ? `<a class="btn" href="https://instagram.com/${insta}" target="_blank" rel="noopener">Instagram</a>` : ''
  const heroText = `<h1>${esc(c.headline)}</h1>${c.tagline.trim() ? `<p class="tag">${lines(c.tagline)}</p>` : ''}${cta}`

  const hero =
    t.hero === 'split'
      ? `<header class="hero split"><div>${heroText}</div><div class="art">${logo || `<span>${esc(kit.brand_name.slice(0, 1))}</span>`}</div></header>`
      : t.hero === 'cover'
        ? `<header class="hero cover">${logo}${heroText}</header>`
        : `<header class="hero centered">${logo}${heroText}</header>`

  const find = [c.address && `<p>${lines(c.address)}</p>`, phone && `<p><a href="tel:${phone}">${esc(c.phone)}</a></p>`, insta && `<p><a href="https://instagram.com/${insta}" target="_blank" rel="noopener">@${esc(insta)}</a></p>`].filter(Boolean).join('')

  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.headline || kit.brand_name)}</title>${googleFontsHrefs(kit.typography_json).map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('')}
<style>
*{box-sizing:border-box}body{margin:0;background:${bg};color:${text};font:17px/1.6 '${body.family}',${body.fallback}}
h1,h2{font-family:'${head.family}',${head.fallback};font-weight:${head.weight};line-height:1.1;margin:0 0 .5em;${t.upper ? 'text-transform:uppercase;letter-spacing:.04em;' : ''}}
h1{font-size:clamp(36px,7vw,68px)}h2{font-size:clamp(24px,4vw,34px)}a{color:inherit}
.wrap{max-width:980px;margin:0 auto;padding:56px 20px}.tag{font-size:1.15em;opacity:.85;max-width:36em}
.btn{display:inline-block;margin-top:18px;padding:14px 26px;border-radius:${r};background:${accent};color:${ink(accent)};text-decoration:none;font-weight:700}
.hero{padding:72px 20px}.hero.cover{background:${primary};color:${ink(primary)};text-align:center}.hero.centered{text-align:center}
.hero.cover .tag,.hero.centered .tag{margin:0 auto}.hero.split{max-width:980px;margin:0 auto;display:grid;gap:32px;align-items:center;grid-template-columns:1.3fr 1fr}
.art{aspect-ratio:1;border-radius:${r};background:${primary};display:grid;place-items:center;overflow:hidden}.art span{font:700 120px '${head.family}';color:${ink(primary)}}
.art .logo{width:70%;height:auto;border-radius:${r}}.logo{width:96px;height:96px;object-fit:contain;border-radius:${r};margin-bottom:20px}
.items{display:grid;gap:14px;${t.items === 'grid' ? 'grid-template-columns:repeat(auto-fill,minmax(220px,1fr));' : ''}}
.item{display:flex;justify-content:space-between;gap:16px;padding:18px 20px;border-radius:${r};border:1px solid ${text}22}${t.items === 'grid' ? '.item{flex-direction:column}' : ''}
.item p{margin:4px 0 0;opacity:.75;font-size:.92em}.price{font-weight:700;color:${t.dark ? accent : primary};white-space:nowrap}
.band{background:${text}0d}footer{padding:28px 20px;text-align:center;font-size:13px;opacity:.6}
@media(max-width:700px){.hero.split{grid-template-columns:1fr}.art{max-width:240px}}
</style></head><body>
${hero}
${c.about.trim() ? `<section class="wrap"><h2>${L.about}</h2><p>${lines(c.about)}</p></section>` : ''}
${items.length ? `<section class="band"><div class="wrap"><h2>${L[c.template]}</h2><div class="items">${itemHtml}</div></div></section>` : ''}
${c.hours.trim() ? `<section class="wrap"><h2>${L.hours}</h2><p>${lines(c.hours)}</p></section>` : ''}
${find ? `<section class="wrap"><h2>${L.find}</h2>${find}</section>` : ''}
<footer>© ${esc(kit.brand_name)} · ${L.made}</footer>
</body></html>`
}

/** A web address from a name: Latin letters, digits and dashes. Cyrillic is transliterated. */
export function slugify(name: string): string {
  const map: Record<string, string> = { а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', і: 'i', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ъ: '', ь: '' }
  return [...name.toLowerCase()].map((ch) => map[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/
