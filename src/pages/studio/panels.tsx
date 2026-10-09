import { useState } from 'react'
import { Check, Copy, Download, ImagePlus, PenLine, TriangleAlert } from 'lucide-react'
import { COPY_FORMATS, IMAGE_SHAPES, type CopyFormat, type ImageShape } from '../../lib/brand'
import { drawImage, writeCopy, type CopyVariant } from '../../lib/api'
import { errorMessage } from '../../lib/hooks'
import { Button, Card, Field, controlClass, inputClass } from '../../components/ui'
import { ErrorNote } from '../../components/kit'
import { t } from '../../i18n'

/**
 * The two things a kit is for: writing in its voice and drawing in its style.
 *
 * Both work on any kit the caller can read, which includes a client's kit shared with a
 * freelancer on an active contract. That is not a feature anybody had to build — the routes
 * read the kit as the caller, and row level security already says who may.
 */

/** `banned:delve` → "Uses “delve”". The server's issue codes, said in words. */
function describeIssue(code: string): string {
  const [kind, value] = code.split(':')
  if (kind === 'banned') return t('issue_banned', { word: value })
  if (kind === 'emoji') return t('issue_emoji', { n: value })
  if (kind === 'exclamation') return t('issue_exclamation', { n: value })
  if (kind === 'em_dash') return t('issue_em_dash', { n: value })
  return code
}

function VariantCard({ variant }: { variant: CopyVariant }) {
  const [copied, setCopied] = useState(false)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">{variant.angle || t('variant')}</p>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ui-radius-sm)] fill text-ink-500 transition hover:fill-raised hover:text-ink-900"
          aria-label={t('copy_text')}
          onClick={() => {
            void navigator.clipboard?.writeText(variant.text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
      </div>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-900">{variant.text}</p>
      {variant.issues.length > 0 && (
        <p className="flex items-start gap-2 border border-amber-300/60 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('slipped_through')} {variant.issues.map(describeIssue).join(' · ')}
          </span>
        </p>
      )}
    </Card>
  )
}

export function CopyPanel({ kitId }: { kitId: string }) {
  const [format, setFormat] = useState<CopyFormat>('instagram_caption')
  const [brief, setBrief] = useState('')
  const [language, setLanguage] = useState<'en' | 'ru' | 'kk'>('en')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [variants, setVariants] = useState<CopyVariant[]>([])

  async function run() {
    setBusy(true)
    setError('')
    try {
      const result = await writeCopy({ brandKitId: kitId, format, brief: brief.trim(), language })
      setVariants(result.variants)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label={t('what_to_write')}>
            <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as CopyFormat)}>
              {COPY_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`format_${f}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('language')}>
            <select className={controlClass} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ru' | 'kk')}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
            </select>
          </Field>
        </div>
        <Field label={t('what_is_it_about')} hint={t('what_is_it_about_hint')}>
          <textarea className={`${inputClass} min-h-24`} value={brief} maxLength={1000} onChange={(e) => setBrief(e.target.value)} placeholder={t('copy_brief_placeholder')} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button icon={PenLine} loading={busy} disabled={brief.trim().length < 3} onClick={() => void run()}>
          {variants.length ? t('write_three_more') : t('write_three_versions')}
        </Button>
      </Card>

      {variants.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {variants.map((v, i) => (
            <VariantCard key={`${i}-${v.text.slice(0, 20)}`} variant={v} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Drawn {
  url: string
  prompt: string
}

export function ImagePanel({ kitId }: { kitId: string }) {
  const [subject, setSubject] = useState('')
  const [shape, setShape] = useState<ImageShape>('square')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [images, setImages] = useState<Drawn[]>([])

  async function run() {
    setBusy(true)
    setError('')
    try {
      const result = await drawImage({ brandKitId: kitId, purpose: 'photo', subject: subject.trim(), shape })
      setImages((all) => [{ url: result.url, prompt: result.prompt }, ...all])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label={t('what_should_it_show')} hint={t('style_is_added_for_you')}>
            <input className={inputClass} value={subject} maxLength={400} onChange={(e) => setSubject(e.target.value)} placeholder={t('image_subject_placeholder')} />
          </Field>
          <Field label={t('shape')}>
            <select className={controlClass} value={shape} onChange={(e) => setShape(e.target.value as ImageShape)}>
              {(Object.keys(IMAGE_SHAPES) as ImageShape[]).map((s) => (
                <option key={s} value={s}>
                  {t(`shape_${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={ImagePlus} loading={busy} disabled={subject.trim().length < 3} onClick={() => void run()}>
            {t('make_image')}
          </Button>
          {busy && <span className="text-sm text-ink-500">{t('images_take_a_while')}</span>}
        </div>
      </Card>

      {images.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => (
            <li key={img.url}>
              <Card className="overflow-hidden">
                <img src={img.url} alt={t('generated_image_alt', { subject: img.prompt.slice(0, 80) })} className="aspect-square w-full object-cover" loading="lazy" />
                <div className="flex items-center justify-between gap-2 p-3">
                  <details className="min-w-0 text-xs text-ink-500">
                    <summary className="cursor-pointer font-semibold">{t('prompt_used')}</summary>
                    <p className="mt-1 leading-relaxed">{img.prompt}</p>
                  </details>
                  <a href={img.url} target="_blank" rel="noopener noreferrer" download className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ui-radius-sm)] fill text-ink-500 hover:text-ink-900" aria-label={t('open_full_size')}>
                    <Download size={15} aria-hidden="true" />
                  </a>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
