import { useEffect, useState, type ReactNode } from 'react'
import { Ban, Camera, Check, Copy, MessageSquareQuote, Type } from 'lucide-react'
import { googleFontsHrefs, type BrandKitRow, type PaletteColor, type Typography, type VoiceRules } from '../lib/brand'
import { Card, SectionHeading } from './ui'
import { t } from '../i18n'

/**
 * How a brand kit looks on screen. Used by the owner's own kit page and, read-only, by a
 * freelancer looking at a kit shared through a contract — the same picture of the brand on
 * both sides is the point of sharing it.
 */

/* ------------------------------------------------------------------ page chrome */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-ink-600">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
      {children}
    </p>
  )
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  const tones = {
    info: 'border-brand-300/50 bg-brand-100/40 text-ink-700',
    warn: 'border-amber-300/60 bg-amber-100/60 text-amber-900',
    ok: 'border-emerald-300/60 bg-emerald-100/50 text-emerald-900',
  }
  return <p className={`border px-3.5 py-3 text-sm leading-relaxed ${tones[tone]}`}>{children}</p>
}

/* ------------------------------------------------------------------ fonts */

/**
 * Loads a kit's Google Fonts into the page while it is shown.
 *
 * The family names were sanitised before they were stored (see safeFontFamily), so building
 * a URL from them here cannot inject anything; each is still its own <link> so one family
 * Google refuses does not take the other with it.
 */
export function useKitFonts(typography: Typography | undefined) {
  const hrefs = typography ? googleFontsHrefs(typography).join('\n') : ''
  useEffect(() => {
    if (!hrefs) return
    const links = hrefs.split('\n').map((href) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
      return link
    })
    return () => links.forEach((link) => link.remove())
  }, [hrefs])
}

export const fontStack = (f: Typography['heading']) => `"${f.family}", ${f.fallback}`

/* ------------------------------------------------------------------ pieces */

/** A thin bar of the palette, for cards where a full swatch grid would be too much. */
export function PaletteStrip({ palette, className = 'h-2.5' }: { palette: PaletteColor[]; className?: string }) {
  return (
    <div className={`flex overflow-hidden rounded-[var(--ui-radius-sm)] ${className}`} aria-hidden="true">
      {palette.map((c) => (
        <span key={c.hex} className="flex-1" style={{ background: c.hex }} />
      ))}
    </div>
  )
}

/** The logo if there is one; otherwise the brand's initials on its own primary colour. */
export function LogoTile({ kit, size = 64 }: { kit: Pick<BrandKitRow, 'brand_name' | 'logo_url' | 'palette_json'>; size?: number }) {
  const primary = kit.palette_json.find((c) => c.role === 'primary')?.hex ?? kit.palette_json[0]?.hex ?? '#222222'
  const background = kit.palette_json.find((c) => c.role === 'background')?.hex ?? '#ffffff'
  if (kit.logo_url) {
    return <img src={kit.logo_url} alt={t('logo_of', { name: kit.brand_name })} width={size} height={size} className="shrink-0 rounded-[var(--ui-radius-sm)] object-cover ring-1 rim" style={{ width: size, height: size, background }} />
  }
  const initials = kit.brand_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-[var(--ui-radius-sm)] font-bold ring-1 rim" style={{ width: size, height: size, background: primary, color: background, fontSize: size * 0.36 }}>
      {initials}
    </span>
  )
}

function Swatch({ color }: { color: PaletteColor }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(color.hex).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      className="group flex flex-col overflow-hidden rounded-[var(--ui-radius-sm)] text-left ring-1 rim transition hover:-translate-y-0.5"
      aria-label={t('copy_hex', { hex: color.hex, name: color.name })}
    >
      <span className="h-20 w-full" style={{ background: color.hex }} />
      <span className="fill-strong flex items-start justify-between gap-2 p-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-900">{color.name}</span>
          <span className="mt-0.5 block font-mono text-xs text-ink-500">{color.hex}</span>
          <span className="mt-1 block text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{t(`color_role_${color.role}`)}</span>
        </span>
        {copied ? <Check size={15} className="shrink-0 text-emerald-600" aria-hidden="true" /> : <Copy size={15} className="shrink-0 text-ink-400 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />}
      </span>
    </button>
  )
}

export function Swatches({ palette }: { palette: PaletteColor[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {palette.map((c) => (
        <Swatch key={c.hex} color={c} />
      ))}
    </div>
  )
}

/** `sample` is a line in the brand's own voice and language; a fixed bakery sentence fits no one else. */
export function TypeSpecimen({ typography, brandName, sample }: { typography: Typography; brandName: string; sample?: string }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
          {t('heading_font')} · {typography.heading.family} {typography.heading.weight}
        </p>
        <p className="mt-1 text-[34px] leading-tight text-ink-900" style={{ fontFamily: fontStack(typography.heading), fontWeight: typography.heading.weight }}>
          {brandName}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
          {t('body_font')} · {typography.body.family} {typography.body.weight}
        </p>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-ink-700" style={{ fontFamily: fontStack(typography.body), fontWeight: typography.body.weight }}>
          {sample || t('type_specimen_sentence')}
        </p>
      </div>
      {typography.rationale && <p className="text-sm text-ink-600">{typography.rationale}</p>}
    </div>
  )
}

function Chips({ items, tone = 'neutral' }: { items: string[]; tone?: 'neutral' | 'danger' }) {
  const cls = tone === 'danger' ? 'bg-brand-100 text-brand-800' : 'fill text-ink-700'
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className={`rounded-[var(--ui-radius-sm)] px-2.5 py-1 text-xs font-semibold ring-1 ring-inset rim ${cls}`}>
          {item}
        </li>
      ))}
    </ul>
  )
}

export function VoicePanel({ voice }: { voice: VoiceRules }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-900">
            <MessageSquareQuote size={15} className="text-brand-500" aria-hidden="true" />
            {t('how_it_talks')}
          </p>
          <ul className="list-inside list-disc space-y-1.5 text-sm text-ink-700">
            {voice.tone.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {voice.examples.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-ink-900">{t('sounds_like')}</p>
            <ul className="space-y-2">
              {voice.examples.map((line) => (
                <li key={line} className="border-l-2 border-brand-300 pl-3 text-sm text-ink-700 italic">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="space-y-5">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-900">
            <Ban size={15} className="text-brand-500" aria-hidden="true" />
            {t('never_says')}
          </p>
          <Chips items={voice.banned_words} tone="danger" />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-900">
            <Camera size={15} className="text-brand-500" aria-hidden="true" />
            {t('photo_style')}
          </p>
          <Chips items={voice.image_style} />
        </div>
      </div>
    </div>
  )
}

/** The whole kit, read-only. */
export function KitPreview({ kit }: { kit: BrandKitRow }) {
  useKitFonts(kit.typography_json)
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <LogoTile kit={kit} size={88} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[24px] font-bold tracking-[-0.02em] text-ink-900">{kit.brand_name}</h2>
          {kit.vibe_summary && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-600">{kit.vibe_summary}</p>}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('palette')} subtitle={t('click_a_colour_to_copy')} />
        <Swatches palette={kit.palette_json} />
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('typography')} icon={Type} />
        <TypeSpecimen typography={kit.typography_json} brandName={kit.brand_name} sample={kit.voice_rules_json.examples[0]} />
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('voice_and_photos')} />
        <VoicePanel voice={kit.voice_rules_json} />
      </Card>
    </div>
  )
}
