import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { createKit } from '../../lib/api'
import { errorMessage } from '../../lib/hooks'
import { Button, Card, Field, inputClass } from '../../components/ui'
import { ErrorNote, PageHeader } from '../../components/kit'
import { t } from '../../i18n'

/**
 * Describe the business, get a kit.
 *
 * Four questions and no more. The model needs to know what is sold and to whom; everything
 * else it can propose and the owner can judge. A long form in front of the first result is
 * where people leave.
 */
export default function NewKit() {
  const navigate = useNavigate()
  const [brandName, setBrandName] = useState('')
  const [offering, setOffering] = useState('')
  const [audience, setAudience] = useState('')
  const [location, setLocation] = useState('')
  const [vibe, setVibe] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (offering.trim().length < 10) {
      setInvalid(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { kit, logoConcept } = await createKit({
        brandName: brandName.trim() || undefined,
        offering: offering.trim(),
        audience: audience.trim() || undefined,
        location: location.trim() || undefined,
        vibeWords: vibe
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean),
      })
      // The kit page draws the logo next, from the concept the strategist wrote.
      navigate(`/studio/${kit.id}`, { state: { drawLogo: logoConcept || true } })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
        <ArrowLeft size={15} aria-hidden="true" />
        {t('studio_title')}
      </Link>
      <PageHeader title={t('new_brand_kit')} subtitle={t('new_kit_subtitle')} />

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label={t('what_do_you_sell')} required hint={t('what_do_you_sell_hint')} error={invalid && offering.trim().length < 10 ? t('say_a_bit_more') : undefined}>
            <textarea className={`${inputClass} min-h-28`} value={offering} maxLength={500} onChange={(e) => setOffering(e.target.value)} placeholder={t('what_do_you_sell_placeholder')} />
          </Field>
          <Field label={t('business_name')} hint={t('business_name_hint')}>
            <input className={inputClass} value={brandName} maxLength={120} onChange={(e) => setBrandName(e.target.value)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('who_buys')}>
              <input className={inputClass} value={audience} maxLength={300} onChange={(e) => setAudience(e.target.value)} placeholder={t('who_buys_placeholder')} />
            </Field>
            <Field label={t('where')}>
              <input className={inputClass} value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} placeholder={t('where_placeholder')} />
            </Field>
          </div>
          <Field label={t('three_words_for_the_feel')} hint={t('comma_separated')}>
            <input className={inputClass} value={vibe} maxLength={200} onChange={(e) => setVibe(e.target.value)} placeholder={t('vibe_placeholder')} />
          </Field>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" icon={Sparkles} loading={busy}>
              {busy ? t('building_your_kit') : t('build_my_brand_kit')}
            </Button>
            {busy && <span className="text-sm text-ink-500">{t('takes_about_twenty_seconds')}</span>}
          </div>
        </form>
      </Card>
    </div>
  )
}
