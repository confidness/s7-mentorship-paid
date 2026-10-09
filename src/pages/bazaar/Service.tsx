import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock, CreditCard, ExternalLink, PenLine } from 'lucide-react'
import { useApp } from '../../lib/store'
import { splitPayment } from '../../lib/bazaar'
import { getService, hire, listKits } from '../../lib/api'
import { errorMessage, useAsync } from '../../lib/hooks'
import { Avatar, Button, Card, Field, SkeletonCard, btn, inputClass } from '../../components/ui'
import { ErrorNote, InfoNote, LogoTile, PageHeader } from '../../components/kit'
import { usd } from '../../components/contract'
import { t } from '../../i18n'

/**
 * One service, and the hire form.
 *
 * The breakdown shown here is computed with the same function the server uses, from the same
 * price — but it is a preview. The amount actually charged is read from the database by
 * /api/bazaar/hire, and nothing typed on this page can change it.
 */
export default function ServicePage() {
  const { serviceId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useApp()
  const { data: service, error, loading } = useAsync(() => getService(serviceId), [serviceId])
  const { data: kits } = useAsync(listKits, [])
  const [kitId, setKitId] = useState<string>('')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [hireError, setHireError] = useState('')

  if (loading && !service) return <SkeletonCard />
  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!service) return <ErrorNote>{t('service_not_found')}</ErrorNote>

  const mine = service.freelancer_id === user?.id
  const split = splitPayment(service.price_usd_cents)
  const chosenKit = kits?.find((k) => k.id === kitId)

  async function startHire() {
    setBusy(true)
    setHireError('')
    try {
      const { url } = await hire({ serviceId: service!.id, brandKitId: kitId || null, brief: brief.trim() })
      // Stripe's page from here. The contract is pending until the webhook hears the money arrived.
      window.location.href = url
    } catch (err) {
      setHireError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/bazaar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
        <ArrowLeft size={15} aria-hidden="true" />
        {t('bazaar_title')}
      </Link>

      {params.get('canceled') && <InfoNote>{t('checkout_canceled')}</InfoNote>}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
        <div className="space-y-6">
          <PageHeader title={service.title} />
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-600">
            <span className="flex items-center gap-2">
              <Avatar name={service.freelancer?.name ?? '?'} initials={service.freelancer?.avatar || undefined} size={28} />
              <span className="font-semibold text-ink-800">{service.freelancer?.name}</span>
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} aria-hidden="true" />
              {t('delivered_in_n_days', { n: service.delivery_days })}
            </span>
          </div>
          {service.description && (
            <Card className="p-5 sm:p-6">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-800">{service.description}</p>
            </Card>
          )}
          {service.portfolio_urls.length > 0 && (
            <Card className="p-5 sm:p-6">
              <p className="mb-3 text-sm font-bold text-ink-900">{t('portfolio')}</p>
              <ul className="space-y-2">
                {/* https only, enforced by the schema; noopener so the linked page cannot reach back into this one. */}
                {service.portfolio_urls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold break-all text-brand-600 hover:text-brand-700">
                      <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                      {url.replace(/^https:\/\//, '')}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="h-fit space-y-4 p-5 sm:p-6">
          <p className="text-[28px] font-bold tracking-[-0.03em] text-ink-900 tabular-nums">{usd(split.totalCents)}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('freelancer_receives')}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{usd(split.payoutCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('brandyzer_fee')}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{usd(split.feeCents)}</dd>
            </div>
          </dl>

          {mine ? (
            <>
              <InfoNote>{t('this_is_your_service')}</InfoNote>
              <Link to={`/sell/${service.id}/edit`} className={btn('secondary', 'md', 'w-full')}>
                <PenLine size={16} aria-hidden="true" />
                {t('edit_service')}
              </Link>
            </>
          ) : (
            <>
              <Field label={t('share_a_brand_kit')} hint={t('share_a_brand_kit_hint')}>
                <select className={inputClass} value={kitId} onChange={(e) => setKitId(e.target.value)}>
                  <option value="">{t('dont_share_a_kit')}</option>
                  {kits?.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.brand_name}
                    </option>
                  ))}
                </select>
              </Field>
              {chosenKit && (
                <div className="flex items-center gap-3 border edge fill-soft p-3">
                  <LogoTile kit={chosenKit} size={40} />
                  <p className="text-xs leading-relaxed text-ink-600">{t('kit_opens_when_paid')}</p>
                </div>
              )}
              <Field label={t('your_brief')} hint={t('your_brief_hint')}>
                <textarea className={`${inputClass} min-h-28`} value={brief} maxLength={4000} onChange={(e) => setBrief(e.target.value)} />
              </Field>
              {!service.freelancer?.stripe_transfers_active && <InfoNote tone="warn">{t('freelancer_not_ready')}</InfoNote>}
              {hireError && <ErrorNote>{hireError}</ErrorNote>}
              <Button size="lg" icon={CreditCard} loading={busy} className="w-full" onClick={() => void startHire()}>
                {t('continue_to_payment')}
              </Button>
              <p className="text-xs leading-relaxed text-ink-500">{t('payment_note')}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
