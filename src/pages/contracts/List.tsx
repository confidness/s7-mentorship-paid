import { Link } from 'react-router-dom'
import { Handshake } from 'lucide-react'
import { useApp } from '../../lib/store'
import { listContracts } from '../../lib/api'
import { relativeTime, useAsync } from '../../lib/hooks'
import type { ContractRow } from '../../lib/types'
import { Avatar, Card, EmptyState, SectionHeading, SkeletonCard } from '../../components/ui'
import { ErrorNote, PageHeader } from '../../components/kit'
import { StatusBadge, usd } from '../../components/contract'
import { t } from '../../i18n'

function Rows({ contracts, side }: { contracts: ContractRow[]; side: 'client' | 'freelancer' }) {
  return (
    <ul className="divide-y divider">
      {contracts.map((c) => {
        const other = side === 'client' ? c.freelancer : c.client
        return (
          <li key={c.id}>
            <Link to={`/contracts/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:fill sm:px-5">
              <Avatar name={other?.name ?? '?'} initials={other?.avatar || undefined} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-900">{c.service_title}</p>
                <p className="truncate text-xs text-ink-500">
                  {other?.name} · {relativeTime(c.created_at)}
                </p>
              </div>
              {/* Each side sees its own number: what the client paid, what the freelancer gets. */}
              <span className="text-sm font-semibold text-ink-900 tabular-nums">{usd(side === 'client' ? c.total_amount_cents : c.freelancer_payout_cents)}</span>
              <StatusBadge status={c.status} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export default function ContractList() {
  const { user } = useApp()
  const { data: contracts, error, loading } = useAsync(listContracts, [])

  const hired = (contracts ?? []).filter((c) => c.client_id === user?.id)
  const working = (contracts ?? []).filter((c) => c.freelancer_id === user?.id)

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav_contracts')} subtitle={t('contracts_subtitle')} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !contracts ? (
        <SkeletonCard />
      ) : !hired.length && !working.length ? (
        <EmptyState icon={Handshake} title={t('no_contracts_yet')} body={t('no_contracts_yet_body')} />
      ) : (
        <div className="space-y-6">
          {working.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 pt-4 sm:px-5">
                <SectionHeading title={t('work_for_clients')} />
              </div>
              <Rows contracts={working} side="freelancer" />
            </Card>
          )}
          {hired.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 pt-4 sm:px-5">
                <SectionHeading title={t('people_you_hired')} />
              </div>
              <Rows contracts={hired} side="client" />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
