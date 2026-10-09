import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Trash2 } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { sells, splitPayment } from '../../lib/bazaar'
import { parsePrice } from '../../lib/money'
import { deleteService, getService, saveService } from '../../lib/api'
import { errorMessage } from '../../lib/hooks'
import { Button, Card, Field, inputClass } from '../../components/ui'
import { ErrorNote, InfoNote, PageHeader } from '../../components/kit'
import { usd } from '../../components/contract'
import { t } from '../../i18n'

/** Mirrors the schema's bounds, so the form refuses what the database would. */
const MIN_PRICE = 500
const MAX_PRICE = 5_000_000

export default function ServiceEditor() {
  const { serviceId } = useParams()
  const { user } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [days, setDays] = useState('7')
  const [portfolio, setPortfolio] = useState('')
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!serviceId) return
    void getService(serviceId)
      .then((s) => {
        if (!s || s.freelancer_id !== user?.id) return setLoadError(t('service_not_found'))
        setTitle(s.title)
        setDescription(s.description)
        setPrice((s.price_usd_cents / 100).toFixed(2))
        setDays(String(s.delivery_days))
        setPortfolio(s.portfolio_urls.join('\n'))
        setActive(s.active)
      })
      .catch((err) => setLoadError(errorMessage(err)))
  }, [serviceId, user?.id])

  if (!sells(user?.role)) {
    return (
      <InfoNote>
        {t('switch_to_freelancer_first')}{' '}
        <Link to="/settings" className="font-semibold underline">
          {t('nav_settings')}
        </Link>
      </InfoNote>
    )
  }
  if (loadError) return <ErrorNote>{loadError}</ErrorNote>

  const cents = parsePrice(price, 'usd')
  const urls = portfolio
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (title.trim().length < 3) next.title = t('title_too_short')
    if (cents === null || cents < MIN_PRICE || cents > MAX_PRICE) next.price = t('price_range')
    const d = Number(days)
    if (!Number.isInteger(d) || d < 1 || d > 180) next.days = t('days_range')
    if (urls.length > 12) next.portfolio = t('portfolio_too_many')
    else if (urls.some((u) => !/^https:\/\/\S{1,500}$/.test(u))) next.portfolio = t('portfolio_https_only')
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    try {
      const id = await saveService({ title: title.trim(), description: description.trim(), price_usd_cents: cents!, delivery_days: d, portfolio_urls: urls, active }, serviceId)
      toast({ title: t('service_saved'), tone: 'success' })
      navigate(`/bazaar/${id}`)
    } catch (err) {
      setErrors({ form: errorMessage(err) })
      setBusy(false)
    }
  }

  async function remove() {
    if (!serviceId) return
    setBusy(true)
    try {
      await deleteService(serviceId)
      toast({ title: t('service_deleted'), tone: 'info' })
      navigate('/sell')
    } catch {
      // The foreign key refuses once anybody has hired it; pausing is the way out.
      setErrors({ form: t('cannot_delete_hired_service') })
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/sell" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
        <ArrowLeft size={15} aria-hidden="true" />
        {t('my_services')}
      </Link>
      <PageHeader title={serviceId ? t('edit_service') : t('list_a_service')} subtitle={t('service_editor_subtitle')} />

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label={t('service_title')} required error={errors.title} hint={t('service_title_hint')}>
            <input className={inputClass} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('service_description')} hint={t('service_description_hint')}>
            <textarea className={`${inputClass} min-h-32`} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('price_usd')} required error={errors.price} hint={cents && cents >= MIN_PRICE ? t('you_receive_x', { amount: usd(splitPayment(cents).payoutCents) }) : undefined}>
              <input className={inputClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150.00" />
            </Field>
            <Field label={t('delivery_days')} required error={errors.days}>
              <input className={inputClass} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </div>
          <Field label={t('portfolio_links')} error={errors.portfolio} hint={t('portfolio_links_hint')}>
            <textarea className={`${inputClass} min-h-24 font-mono text-xs`} value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="https://" />
          </Field>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-ink-800">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
            {t('show_in_bazaar')}
          </label>

          {errors.form && <ErrorNote>{errors.form}</ErrorNote>}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" icon={Save} loading={busy}>
              {t('save')}
            </Button>
            {serviceId && (
              <Button type="button" variant="ghost" icon={Trash2} disabled={busy} onClick={() => void remove()}>
                {t('delete')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
