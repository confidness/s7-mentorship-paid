import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Plus, Search, Store } from 'lucide-react'
import { useApp } from '../../lib/store'
import { sells } from '../../lib/bazaar'
import { listServices } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { Avatar, Badge, EmptyState, SkeletonCard, btn, inputClass } from '../../components/ui'
import { ErrorNote, PageHeader } from '../../components/kit'
import { usd } from '../../components/contract'
import { t } from '../../i18n'

/** Every active service, newest first, with a plain text filter. */
export default function Directory() {
  const { user } = useApp()
  const { data: services, error, loading } = useAsync(listServices, [])
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services ?? []
    return (services ?? []).filter((s) => `${s.title} ${s.description} ${s.freelancer?.name ?? ''}`.toLowerCase().includes(q))
  }, [services, query])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('bazaar_title')}
        subtitle={t('bazaar_subtitle')}
        action={
          sells(user?.role) ? (
            <Link to="/sell/new" className={btn('secondary', 'md')}>
              <Plus size={17} aria-hidden="true" />
              {t('list_a_service')}
            </Link>
          ) : undefined
        }
      />

      <label className="relative block max-w-md">
        <span className="sr-only">{t('search_services')}</span>
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
        <input className={`${inputClass} pl-10`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search_services_placeholder')} />
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !services ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Store} title={query ? t('no_matching_services') : t('no_services_yet')} body={query ? t('try_another_word') : t('no_services_yet_body')} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <li key={s.id}>
              <Link to={`/bazaar/${s.id}`} className="card flex h-full flex-col gap-3 p-5 transition hover:-translate-y-0.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={s.freelancer?.name ?? '?'} initials={s.freelancer?.avatar || undefined} size={32} />
                  <span className="truncate text-sm font-semibold text-ink-700">{s.freelancer?.name}</span>
                </div>
                <p className="text-[17px] font-bold tracking-[-0.02em] text-ink-900">{s.title}</p>
                {s.description && <p className="line-clamp-3 text-sm leading-relaxed text-ink-600">{s.description}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                  <span className="text-lg font-bold text-ink-900 tabular-nums">{usd(s.price_usd_cents)}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-500">
                    <Clock size={13} aria-hidden="true" />
                    {t('n_days', { n: s.delivery_days })}
                  </span>
                </div>
                {!s.freelancer?.stripe_transfers_active && <Badge tone="neutral">{t('not_taking_payments_yet')}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
