import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Banknote, ExternalLink, RefreshCw } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Button, Card, SectionHeading } from '../../components/ui'
import { ApiError, payoutStatus, startOnboarding } from '../../lib/api'
import { backendConfigured } from '../../lib/supabase'
import { DEFAULT_PLATFORM_FEE_BPS } from '../../lib/money'
import { t } from '../../i18n'

/**
 * Connecting a payout account.
 *
 * Stripe Express does the parts we should not: identity checks, tax details, bank numbers.
 * We keep an account id and a yes/no on whether Stripe will accept charges — nothing that
 * would make this table worth stealing.
 *
 * charges_enabled is re-read from Stripe rather than remembered, because it changes without
 * telling us when a document expires or a verification stalls.
 */

interface Status {
  connected: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  requirements?: string[]
}

export default function Payouts() {
  const { standing, refreshStanding } = useApp()
  const [params] = useSearchParams()

  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!backendConfigured) return
    try {
      setStatus(await payoutStatus())
      await refreshStanding()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('something_went_wrong_try_again'))
    }
  }, [refreshStanding])

  // Stripe sends people back here after onboarding, so the first thing to do on arrival is
  // ask Stripe what actually changed rather than assume it succeeded.
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
      setError(err instanceof ApiError ? err.message : t('something_went_wrong_try_again'))
      setBusy(false)
    }
  }

  if (standing.mentorStatus !== 'approved') {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="space-y-3 p-6">
          <SectionHeading title={t('payouts')} subtitle={t('selling_needs_an_approved_mentor_account')} icon={Banknote} />
          <p className="text-sm text-ink-600">{t('paid_lessons_need_an_approved_mentor_account')}</p>
          <Link to="/m/apply" className="inline-flex text-sm font-semibold text-brand-600 underline underline-offset-2">
            {t('teach_on_s7')}
          </Link>
        </Card>
      </div>
    )
  }

  const ready = Boolean(status?.chargesEnabled)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('payouts')}</h1>
        <p className="mt-1.5 text-sm text-ink-600">{t('connect_an_account_to_receive_what_you_earn')}</p>
      </header>

      <Card className="space-y-4 p-6">
        <SectionHeading
          title={ready ? t('ready_to_sell') : t('not_ready_yet')}
          subtitle={t('you_keep_n_percent_of_every_sale', { n: 100 - DEFAULT_PLATFORM_FEE_BPS / 100 })}
          icon={ready ? BadgeCheck : AlertTriangle}
        />

        {ready ? (
          <p className="border border-emerald-300/60 bg-emerald-100/50 px-3.5 py-3 text-sm font-medium text-emerald-800">
            {t('stripe_is_accepting_charges_for_your_account')}
          </p>
        ) : (
          <p className="border border-amber-300/60 bg-amber-100/60 px-3.5 py-3 text-sm font-medium text-amber-800">
            {status?.connected ? t('stripe_still_needs_something_from_you') : t('you_have_not_connected_an_account_yet')}
          </p>
        )}

        {/* Stripe's own words for what is missing. Vague is worse than technical here: the
            mentor has to go and fix exactly this. */}
        {status?.requirements?.length ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-ink-600">
            {status.requirements.slice(0, 8).map((item) => (
              <li key={item}>{item.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        ) : null}

        {error && (
          <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void connect()} loading={busy} icon={ExternalLink}>
            {status?.connected ? t('continue_on_stripe') : t('connect_with_stripe')}
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={() => void load()}>
            {t('check_again')}
          </Button>
        </div>
      </Card>

      <p className="text-xs leading-relaxed text-ink-500">{t('stripe_handles_identity_and_bank_details_we_never_see_them')}</p>
    </div>
  )
}
