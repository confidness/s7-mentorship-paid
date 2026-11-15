import { Field, inputClass } from '../../components/ui'
import { t } from '../../i18n'
import { LOGO_KINDS, LOGO_SHAPES, LOGO_STYLES, type LogoBrief } from '../../lib/brand'

export type LogoAnswers = Pick<LogoBrief, 'kind' | 'style' | 'shape' | 'idea' | 'avoid'>

export const NO_LOGO_ANSWERS: LogoAnswers = { kind: 'auto', style: 'auto', shape: 'auto', idea: '', avoid: '' }

/** Kinds that put letters in the picture, which image models still misspell now and then. */
const LETTERED: LogoAnswers['kind'][] = ['wordmark', 'combination', 'monogram', 'emblem']

/**
 * The questions asked before a logo is drawn: what kind, what style, what shape, what it
 * should show and what to avoid. The new-kit form and the Redraw dialog both use this.
 */
export function LogoQuestions({ value, onChange }: { value: LogoAnswers; onChange: (patch: Partial<LogoAnswers>) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={t('logo_kind_question')} hint={LETTERED.includes(value.kind) ? t('lettering_may_be_misspelled') : undefined}>
          <select className={inputClass} value={value.kind} onChange={(e) => onChange({ kind: e.target.value as LogoAnswers['kind'] })}>
            {(['auto', ...LOGO_KINDS] as const).map((k) => (
              <option key={k} value={k}>
                {t(`logo_kind_${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('logo_style_question')}>
          <select className={inputClass} value={value.style} onChange={(e) => onChange({ style: e.target.value as LogoAnswers['style'] })}>
            {(['auto', ...LOGO_STYLES] as const).map((s) => (
              <option key={s} value={s}>
                {t(`logo_style_${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('logo_shape_question')}>
          <select className={inputClass} value={value.shape} onChange={(e) => onChange({ shape: e.target.value as LogoAnswers['shape'] })}>
            {(['auto', ...LOGO_SHAPES] as const).map((s) => (
              <option key={s} value={s}>
                {t(`logo_shape_${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t('logo_idea_question')}>
        <input className={inputClass} value={value.idea} maxLength={200} onChange={(e) => onChange({ idea: e.target.value })} placeholder={t('logo_idea_placeholder')} />
      </Field>
      <Field label={t('logo_avoid_question')}>
        <input className={inputClass} value={value.avoid} maxLength={200} onChange={(e) => onChange({ avoid: e.target.value })} placeholder={t('logo_avoid_placeholder')} />
      </Field>
    </div>
  )
}
