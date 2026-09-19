import { useState } from 'react'
import { Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { Button, Card } from './ui'
import { ApiError, startCheckout } from '../lib/api'
import { formatMoney } from '../lib/money'
import { t, useLocale } from '../i18n'

/**
 * What a student sees instead of a lesson they have not bought.
 *
 * This component is a courtesy, not the paywall. The real one is /api/lesson-content, which
 * refuses to send tasks or a material URL without an entitlement row — so removing this from
 * the DOM, or flipping a flag in devtools, reveals nothing. That separation is deliberate:
 * a lock drawn in the client is a picture of a lock.
 */
export default function Paywall({ title, summary, priceCents, currency, lessonId }: { title: string; summary: string; priceCents: number; currency: string; lessonId: string }) {
  const { locale } = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function buy() {
    setBusy(true)
    setError('')
    try {
      const { url } = await startCheckout(lessonId)
      // Payment happens on Stripe's page. Card details never touch this origin.
      window.location.href = url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('something_went_wrong_try_again'))
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-xl space-y-5 p-8 text-center">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-brand-100/80 text-brand-700">
        <Lock size={20} aria-hidden="true" />
      </span>

      <div>
        <h1 className="text-[24px] font-bold tracking-[-0.03em] text-ink-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{summary}</p>
      </div>

      <p className="text-[32px] leading-none font-bold tracking-[-0.03em] text-ink-900 tabular-nums">{formatMoney(priceCents, currency, locale)}</p>

      <ul className="space-y-2 text-left text-sm text-ink-600">
        <li className="flex items-start gap-2">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
          {t('one_payment_and_the_lesson_stays_yours')}
        </li>
        <li className="flex items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
          {t('payment_is_handled_by_stripe')}
        </li>
      </ul>

      {error && (
        <p role="alert" className="rounded-[14px] border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      <Button size="lg" className="w-full" loading={busy} onClick={() => void buy()}>
        {t('buy_this_lesson')}
      </Button>
    </Card>
  )
}
