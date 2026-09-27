import { Check } from 'lucide-react'
import { HOUSE_SKINS, INDUSTRY_SKINS, useSkin, type SkinChoice } from '../lib/theme'
import { t } from '../i18n'

/**
 * Choosing what the interface is made of.
 *
 * Each option carries a swatch drawn from the skin's own tokens rather than a screenshot or
 * a name. A name tells somebody nothing — "atelier" could be anything — and a screenshot
 * goes stale the first time a colour moves. Three squares in the actual palette, with the
 * actual radius and the actual border, is the shortest honest answer to "what will this
 * look like", and it cannot drift from the thing it describes.
 *
 * The swatches are inline styles on purpose: they have to render in a skin that is *not*
 * the one currently applied, so they cannot read the live custom properties.
 */
interface Swatch {
  canvas: string
  surface: string
  accent: string
  border: string
  radius: number
}

const SWATCHES: Record<SkinChoice, Swatch> = {
  plain: { canvas: '#f4f6fa', surface: '#ffffff', accent: '#4f46e5', border: '#e2e8f0', radius: 8 },
  editorial: { canvas: '#f7f6f3', surface: '#ffffff', accent: '#111111', border: '#eaeaea', radius: 5 },
  atelier: { canvas: '#eceef1', surface: '#ffffff', accent: '#14161a', border: 'transparent', radius: 14 },
  brutal: { canvas: '#dcdcde', surface: '#ffffff', accent: '#ffe000', border: '#000000', radius: 0 },
  terminal: { canvas: '#0a0a0a', surface: '#0e0e0e', accent: '#e61919', border: '#2a2a2a', radius: 0 },
  marketplace: { canvas: '#ffffff', surface: '#ffffff', accent: '#a435f0', border: '#d1d7dc', radius: 3 },
  academy: { canvas: '#f5f7fa', surface: '#ffffff', accent: '#0056d2', border: '#dde3ec', radius: 6 },
  streak: { canvas: '#ffffff', surface: '#ffffff', accent: '#58cc02', border: '#e5e5e5', radius: 12 },
  cinema: { canvas: '#14100f', surface: '#1b1716', accent: '#e32652', border: '#332d2b', radius: 5 },
  poster: { canvas: '#ffffff', surface: '#ffffff', accent: '#00ff84', border: '#000000', radius: 0 },
}

export default function SkinPicker() {
  const { skin, setSkin } = useSkin()

  return (
    <div role="radiogroup" aria-label={t('appearance')} className="space-y-5">
      <Group heading={t('skins_house')} options={HOUSE_SKINS} skin={skin} onPick={setSkin} />
      <Group heading={t('skins_industry')} subtitle={t('skins_industry_note')} options={INDUSTRY_SKINS} skin={skin} onPick={setSkin} />
    </div>
  )
}

function Group({ heading, subtitle, options, skin, onPick }: { heading: string; subtitle?: string; options: SkinChoice[]; skin: SkinChoice; onPick: (id: SkinChoice) => void }) {
  return (
    <div>
      <p className="text-xs font-bold tracking-wide text-ink-500">{heading}</p>
      {subtitle && <p className="mt-0.5 mb-2.5 text-xs text-ink-500">{subtitle}</p>}
      <div className={`grid gap-3 sm:grid-cols-2 ${subtitle ? '' : 'mt-2.5'}`}>
      {options.map((id) => {
        const swatch = SWATCHES[id]
        const active = skin === id
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            onClick={() => onPick(id)}
            className={`flex items-start gap-3.5 rounded-[var(--ui-radius-sm)] border p-3.5 text-left transition ${
              active ? 'border-[var(--color-accent-400)] fill-strong ring-2 ring-[var(--color-accent-400)]' : 'edge fill-soft hover:fill'
            }`}
          >
            {/* A miniature of the thing itself: canvas, a sheet on it, and the one loud colour. */}
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center"
              style={{ background: swatch.canvas, borderRadius: swatch.radius, border: `1px solid ${swatch.border === 'transparent' ? swatch.canvas : swatch.border}` }}
            >
              <span
                className="grid h-7 w-7 place-items-center"
                style={{ background: swatch.surface, borderRadius: Math.max(0, swatch.radius - 3), border: `1px solid ${swatch.border}` }}
              >
                <span className="h-2.5 w-2.5" style={{ background: swatch.accent, borderRadius: Math.max(0, swatch.radius - 5) }} />
              </span>
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                {t(`skin_${id}`)}
                {active && <Check size={14} aria-hidden="true" />}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-500">{t(`skin_${id}_note`)}</span>
            </span>
          </button>
        )
      })}
      </div>
    </div>
  )
}
