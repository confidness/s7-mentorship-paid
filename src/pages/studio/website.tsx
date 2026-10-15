import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Globe, Plus, Sparkles, X } from 'lucide-react'
import { Button, Card, Field, inputClass } from '../../components/ui'
import { ErrorNote } from '../../components/kit'
import { supabase } from '../../lib/supabase'
import { writeCopy } from '../../lib/api'
import { errorMessage } from '../../lib/hooks'
import { useToast } from '../../lib/store'
import { getLocale, t } from '../../i18n'
import type { BrandKitRow } from '../../lib/brand'
import { SLUG_RE, TEMPLATE_IDS, defaultContent, renderSite, slugify, type SiteContent, type SiteLang } from '../../lib/site'

const LANGS: { id: SiteLang; label: string }[] = [
  { id: 'kk', label: 'Қазақша' },
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
]

/**
 * A website from the kit: pick a template, fill a short form, watch the preview, then download
 * the file or publish it at /s/<address>. The database holds the Free/Pro site limit, so the
 * refusal comes back as a row-level-security error and is shown as the plan's limit.
 */
export function WebsitePanel({ kit }: { kit: BrandKitRow }) {
  const toast = useToast()
  const [c, setC] = useState<SiteContent>(() => defaultContent(kit, getLocale() as SiteLang))
  const [slug, setSlug] = useState(() => slugify(kit.brand_name) || `site-${kit.id.slice(0, 8)}`)
  const [published, setPublished] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'ai' | 'publish'>('')
  const [error, setError] = useState('')
  const html = useMemo(() => renderSite(kit, c), [kit, c])
  const set = (patch: Partial<SiteContent>) => setC((prev) => ({ ...prev, ...patch }))
  const setItem = (i: number, patch: Partial<SiteContent['items'][number]>) => set({ items: c.items.map((item, j) => (j === i ? { ...item, ...patch } : item)) })

  useEffect(() => {
    void supabase()
      .from('sites')
      .select('slug, content')
      .eq('kit_id', kit.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setSlug(data.slug)
        setPublished(data.slug)
        setC((prev) => ({ ...prev, ...(data.content as Partial<SiteContent>) }))
      })
  }, [kit.id])

  async function writeTagline() {
    setBusy('ai')
    setError('')
    try {
      const { variants } = await writeCopy({ brandKitId: kit.id, format: 'website_hero', brief: c.about || kit.vibe_summary, language: c.lang })
      if (variants[0]) set({ tagline: variants[0].text })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${slug || 'site'}.html` })
    a.click()
    URL.revokeObjectURL(url)
  }

  async function publish() {
    if (!SLUG_RE.test(slug)) return setError(t('site_slug_rule'))
    setBusy('publish')
    setError('')
    const row = { slug, content: c, html, updated_at: new Date().toISOString() }
    const { error } = published ? await supabase().from('sites').update(row).eq('kit_id', kit.id) : await supabase().from('sites').insert({ ...row, kit_id: kit.id })
    setBusy('')
    if (error) return setError(error.code === '23505' ? t('site_slug_taken') : error.code === '42501' ? t('site_limit_reached') : error.message)
    setPublished(slug)
    toast({ title: t('site_published'), tone: 'success' })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <Card className="space-y-4 p-5">
        <Field label={t('site_template')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TEMPLATE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={c.template === id}
                onClick={() => set({ template: id })}
                className={`rounded-[var(--ui-radius-sm)] border px-2.5 py-2 text-sm font-semibold transition ${c.template === id ? 'border-[var(--color-accent-400)] fill-strong ring-2 ring-[var(--color-accent-400)]' : 'edge fill-soft hover:fill'}`}
              >
                {t(`template_${id}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('site_language')}>
          <select className={inputClass} value={c.lang} onChange={(e) => set({ lang: e.target.value as SiteLang })}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('site_headline')}>
          <input className={inputClass} value={c.headline} maxLength={80} onChange={(e) => set({ headline: e.target.value })} />
        </Field>
        <Field label={t('site_tagline')}>
          <textarea className={`${inputClass} min-h-16`} value={c.tagline} maxLength={240} onChange={(e) => set({ tagline: e.target.value })} />
        </Field>
        <Button variant="secondary" size="sm" icon={Sparkles} loading={busy === 'ai'} onClick={() => void writeTagline()}>
          {t('write_with_ai')}
        </Button>
        <Field label={t('site_about')}>
          <textarea className={`${inputClass} min-h-24`} value={c.about} maxLength={1200} onChange={(e) => set({ about: e.target.value })} />
        </Field>

        <Field label={t('site_items')}>
          <div className="space-y-2">
            {c.items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_auto] gap-2">
                <input className={inputClass} placeholder={t('site_item_name')} value={item.name} maxLength={80} onChange={(e) => setItem(i, { name: e.target.value })} />
                <input className={inputClass} placeholder={t('site_item_price')} value={item.price} maxLength={24} onChange={(e) => setItem(i, { price: e.target.value })} />
                <Button variant="ghost" size="sm" icon={X} aria-label={t('remove')} onClick={() => set({ items: c.items.filter((_, j) => j !== i) })} />
                <input className={`${inputClass} col-span-2`} placeholder={t('site_item_note')} value={item.note} maxLength={160} onChange={(e) => setItem(i, { note: e.target.value })} />
              </div>
            ))}
            {c.items.length < 30 && (
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => set({ items: [...c.items, { name: '', price: '', note: '' }] })}>
                {t('add_item')}
              </Button>
            )}
          </div>
        </Field>

        <Field label={t('site_hours')}>
          <textarea className={`${inputClass} min-h-16`} value={c.hours} maxLength={300} onChange={(e) => set({ hours: e.target.value })} />
        </Field>
        <Field label={t('site_address')}>
          <input className={inputClass} value={c.address} maxLength={200} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('site_phone')}>
            <input className={inputClass} type="tel" value={c.phone} maxLength={30} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Instagram">
            <input className={inputClass} placeholder="@username" value={c.instagram} maxLength={60} onChange={(e) => set({ instagram: e.target.value })} />
          </Field>
        </div>

        <Field label={t('site_web_address')} hint={t('site_slug_rule')}>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-sm text-ink-500">/s/</span>
            <input className={inputClass} value={slug} maxLength={48} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </div>
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap gap-2">
          <Button icon={Globe} loading={busy === 'publish'} onClick={() => void publish()}>
            {published ? t('update_site') : t('publish_site')}
          </Button>
          <Button variant="secondary" icon={Download} onClick={download}>
            {t('download_html')}
          </Button>
          {published && (
            <a className="inline-flex items-center gap-1.5 self-center text-sm font-semibold text-brand-600 hover:text-brand-700" href={`/s/${published}`} target="_blank" rel="noopener">
              <ExternalLink size={14} aria-hidden="true" />
              {t('open_site')}
            </a>
          )}
        </div>
      </Card>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <iframe title={t('site_preview')} srcDoc={html} sandbox="" className="h-[680px] w-full rounded-[var(--ui-radius-sm)] border edge bg-white" />
      </div>
    </div>
  )
}
