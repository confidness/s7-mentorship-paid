import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, Lock, Send, Undo2 } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { availableActions, isActive, type ContractAction } from '../../lib/bazaar'
import { actOnContract, getContract, getKit } from '../../lib/api'
import { errorMessage, formatDate, useAsync } from '../../lib/hooks'
import { Button, Card, Field, SectionHeading, SkeletonCard, inputClass } from '../../components/ui'
import { ErrorNote, InfoNote, KitPreview, PageHeader } from '../../components/kit'
import { StatusBadge, usd } from '../../components/contract'
import { t } from '../../i18n'

/** How many times to re-read a just-paid contract while the webhook catches up. */
const FUNDING_POLLS = 6

export default function ContractDetail() {
  const { contractId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useApp()
  const toast = useToast()
  const { data: contract, error, loading, reload } = useAsync(() => getContract(contractId), [contractId])
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<ContractAction | null>(null)

  /**
   * Back from Stripe with ?funded=1, the contract is usually still pending: the redirect
   * races the webhook, and the webhook is the only thing allowed to fund it. A few quiet
   * re-reads cover the gap instead of telling somebody who just paid that they have not.
   */
  const [polls, setPolls] = useState(0)
  useEffect(() => {
    if (!params.get('funded') || contract?.status !== 'pending' || polls >= FUNDING_POLLS) return
    const timer = setTimeout(() => {
      setPolls((n) => n + 1)
      void reload()
    }, 2000)
    return () => clearTimeout(timer)
  }, [params, contract?.status, polls, reload])

  // The kit is read under RLS: it comes back only while this person may see it.
  const kitId = contract?.brand_kit_id ?? null
  const freelancerView = Boolean(contract && user && contract.freelancer_id === user.id)
  const { data: kit } = useAsync(async () => (kitId && freelancerView && contract && isActive(contract.status) ? getKit(kitId) : null), [kitId, freelancerView, contract?.status])

  if (loading && !contract) return <SkeletonCard />
  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!contract || !user) return <ErrorNote>{t('contract_not_found')}</ErrorNote>

  const actions = availableActions({ status: contract.status, clientId: contract.client_id, freelancerId: contract.freelancer_id }, user.id)
  const isClient = contract.client_id === user.id
  const other = isClient ? contract.freelancer : contract.client

  async function act(action: ContractAction) {
    setBusy(action)
    try {
      await actOnContract(contract!.id, action, action === 'deliver' ? { note: note.trim(), url: url.trim() } : {})
      toast({ title: t(`done_${action}`), tone: 'success' })
      setNote('')
      setUrl('')
      await reload()
    } catch (err) {
      toast({ title: t('could_not_update_contract'), body: errorMessage(err), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/contracts" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
        <ArrowLeft size={15} aria-hidden="true" />
        {t('nav_contracts')}
      </Link>

      <PageHeader title={contract.service_title} subtitle={t(isClient ? 'you_hired_name' : 'name_hired_you', { name: other?.name ?? '' })} action={<StatusBadge status={contract.status} />} />

      {params.get('funded') && contract.status === 'pending' && <InfoNote>{polls >= FUNDING_POLLS ? t('payment_still_confirming') : t('payment_confirming')}</InfoNote>}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(18rem,22rem)]">
        <div className="space-y-6">
          <Card className="space-y-3 p-5 sm:p-6">
            <SectionHeading title={t('the_brief')} />
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-800">{contract.brief || t('no_brief_given')}</p>
          </Card>

          {(contract.delivery_note || contract.delivery_url) && (
            <Card className="space-y-3 p-5 sm:p-6">
              <SectionHeading title={t('the_delivery')} subtitle={contract.delivered_at ? formatDate(contract.delivered_at) : undefined} />
              {contract.delivery_note && <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-800">{contract.delivery_note}</p>}
              {contract.delivery_url && (
                <a href={contract.delivery_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm font-semibold break-all text-brand-600 hover:text-brand-700">
                  <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                  {contract.delivery_url.replace(/^https:\/\//, '')}
                </a>
              )}
            </Card>
          )}

          {actions.includes('deliver') && (
            <Card className="space-y-4 p-5 sm:p-6">
              <SectionHeading title={t('hand_in_the_work')} subtitle={t('hand_in_the_work_hint')} />
              <Field label={t('a_note_for_the_client')}>
                <textarea className={`${inputClass} min-h-24`} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Field label={t('link_to_the_files')} hint={t('link_to_the_files_hint')}>
                <input className={inputClass} value={url} maxLength={1000} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </Field>
              <Button icon={Send} loading={busy === 'deliver'} disabled={!note.trim() && !url.trim()} onClick={() => void act('deliver')}>
                {t('action_deliver')}
              </Button>
            </Card>
          )}

          {(actions.includes('accept') || actions.includes('request_changes')) && (
            <Card className="flex flex-wrap gap-3 p-5 sm:p-6">
              <Button icon={Check} loading={busy === 'accept'} onClick={() => void act('accept')}>
                {t('action_accept')}
              </Button>
              <Button variant="secondary" icon={Undo2} loading={busy === 'request_changes'} onClick={() => void act('request_changes')}>
                {t('action_request_changes')}
              </Button>
            </Card>
          )}

          {freelancerView && contract.brand_kit_id && (
            <section className="space-y-4">
              <SectionHeading title={t('the_clients_brand_kit')} />
              {kit ? (
                <>
                  <KitPreview kit={kit} />
                  <Link to={`/studio/${kit.id}`} className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
                    {t('write_and_draw_in_this_brand')}
                  </Link>
                </>
              ) : (
                <InfoNote>
                  <Lock size={14} className="mr-1.5 inline" aria-hidden="true" />
                  {contract.status === 'pending' ? t('kit_opens_when_paid') : t('kit_closed')}
                </InfoNote>
              )}
            </section>
          )}
        </div>

        <Card className="h-fit space-y-3 p-5 sm:p-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('total')}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{usd(contract.total_amount_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('freelancer_receives')}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{usd(contract.freelancer_payout_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('brandyzer_fee')}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{usd(contract.platform_fee_cents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t edge pt-2">
              <dt className="text-ink-500">{t('delivery_time')}</dt>
              <dd className="font-semibold text-ink-900">{t('n_days', { n: contract.delivery_days })}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">{t('started')}</dt>
              <dd className="font-semibold text-ink-900">{formatDate(contract.created_at)}</dd>
            </div>
            {contract.funded_at && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">{t('paid')}</dt>
                <dd className="font-semibold text-ink-900">{formatDate(contract.funded_at)}</dd>
              </div>
            )}
            {contract.completed_at && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">{t('completed')}</dt>
                <dd className="font-semibold text-ink-900">{formatDate(contract.completed_at)}</dd>
              </div>
            )}
          </dl>
          <p className="border-t edge pt-3 text-xs leading-relaxed text-ink-500">{t(`status_${contract.status}_note`)}</p>
        </Card>
      </div>
    </div>
  )
}
