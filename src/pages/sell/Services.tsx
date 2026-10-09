import { Link } from 'react-router-dom'
import { BriefcaseBusiness, Pause, PenLine, Play, Plus } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { sells } from '../../lib/bazaar'
import { myServices, saveService } from '../../lib/api'
import { errorMessage, useAsync } from '../../lib/hooks'
import { Badge, Button, Card, EmptyState, SkeletonCard, btn } from '../../components/ui'
import { ErrorNote, InfoNote, PageHeader } from '../../components/kit'
import { usd } from '../../components/contract'
import { t } from '../../i18n'

/** A freelancer's own listings, with the one thing that stops them being hired: payouts. */
export default function MyServices() {
  const { user } = useApp()
  const toast = useToast()
  const { data: services, error, loading, reload } = useAsync(myServices, [])

  if (!sells(user?.role)) {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title={t('my_services')} />
        <InfoNote>
          {t('switch_to_freelancer_first')}{' '}
          <Link to="/settings" className="font-semibold underline">
            {t('nav_settings')}
          </Link>
        </InfoNote>
      </div>
    )
  }

  async function toggle(id: string, active: boolean) {
    const s = services?.find((x) => x.id === id)
    if (!s) return
    try {
      await saveService({ title: s.title, description: s.description, price_usd_cents: s.price_usd_cents, delivery_days: s.delivery_days, portfolio_urls: s.portfolio_urls, active }, id)
      await reload()
    } catch (err) {
      toast({ title: t('could_not_save'), body: errorMessage(err), tone: 'error' })
    }
  }

  const create = (
    <Link to="/sell/new" className={btn('primary', 'md')}>
      <Plus size={17} aria-hidden="true" />
      {t('list_a_service')}
    </Link>
  )

  return (
    <div className="space-y-6">
      <PageHeader title={t('my_services')} subtitle={t('my_services_subtitle')} action={services?.length ? create : undefined} />

      {!user?.stripe_transfers_active && (
        <InfoNote tone="warn">
          {t('connect_payouts_to_be_hired')}{' '}
          <Link to="/sell/payouts" className="font-semibold underline">
            {t('payouts')}
          </Link>
        </InfoNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !services ? (
        <SkeletonCard />
      ) : services && services.length === 0 ? (
        <EmptyState icon={BriefcaseBusiness} title={t('no_listings_yet')} body={t('no_listings_yet_body')} action={create} />
      ) : (
        <ul className="space-y-3">
          {services?.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink-900">
                    <Link to={`/bazaar/${s.id}`} className="hover:underline">
                      {s.title}
                    </Link>
                    {!s.active && <Badge tone="neutral">{t('paused')}</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {usd(s.price_usd_cents)} · {t('n_days', { n: s.delivery_days })}
                  </p>
                </div>
                <Button variant="ghost" size="sm" icon={s.active ? Pause : Play} onClick={() => void toggle(s.id, !s.active)}>
                  {s.active ? t('pause') : t('resume')}
                </Button>
                <Link to={`/sell/${s.id}/edit`} className={btn('secondary', 'sm')}>
                  <PenLine size={15} aria-hidden="true" />
                  {t('edit')}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
