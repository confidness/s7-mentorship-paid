import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, ExternalLink, RefreshCw } from 'lucide-react'
import { useApp } from '../../lib/store'
import { PLATFORM_FEE_BPS } from '../../lib/money'
import { payoutStatus, startOnboarding, type PayoutStatus } from '../../lib/api'
import { errorMessage } from '../../lib/hooks'
import { Button, Card, SectionHeading } from '../../components/ui'
import { ErrorNote, InfoNote, PageHeader } from '../../components/kit'
import { t } from '../../i18n'

/**
 * Connecting a payout account.
 *
 * Stripe does the parts we should not: identity checks, tax details, bank numbers. We keep an
 * account id and a yes/no on whether Stripe will transfer to it — nothing that would make
 * that table worth stealing. The yes/no is re-read from Stripe on every visit, because it
 * changes without telling us when a document expires or a verification stalls.
 */
export default function Payouts() {
  const { refreshMe } = useApp()
  const [params] = useSearchParams()
  const [status, setStatus] = useState<PayoutStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setStatus(await payoutStatus())
      // The directory badge and the "connect payouts" notices read the profile's copy.
      await refreshMe()
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [refreshMe])

  // Stripe sends people back here after onboarding, so the first thing to do on arrival is
  // ask what actually changed rather than assume it succeeded.
  useEffect(() => {
    void load()
  }, [load, params])

  async function connect() {
    setBusy(true)
    setError('')
    try {
      const { url } = await startOnboarding()
      window.location.href = url
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const ready = Boolean(status?.transfersActive)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t('payouts')} subtitle={t('payouts_subtitle')} />

      <Card className="space-y-4 p-6">
        <SectionHeading title={ready ? t('ready_to_be_hired') : t('not_ready_yet')} subtitle={t('you_keep_n_percent', { n: 100 - PLATFORM_FEE_BPS / 100 })} icon={ready ? BadgeCheck : AlertTriangle} />

        {ready ? (
          <InfoNote tone="ok">{t('stripe_will_pay_you')}</InfoNote>
        ) : (
          <InfoNote tone="warn">{status?.connected ? t('stripe_still_needs_something') : t('no_payout_account_yet')}</InfoNote>
        )}

        {/* Stripe's own words for what is missing. Vague is worse than technical here: the
            freelancer has to go and fix exactly this. */}
        {status?.requirements?.length ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-ink-600">
            {status.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void connect()} loading={busy} icon={ExternalLink}>
            {status?.connected ? t('continue_on_stripe') : t('connect_with_stripe')}
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={() => void load()}>
            {t('check_again')}
          </Button>
        </div>

        <p className="border-t edge pt-4 text-xs leading-relaxed text-ink-500">{t('stripe_handles_identity')}</p>
      </Card>
    </div>
  )
}
