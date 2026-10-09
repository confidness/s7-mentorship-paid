import { AlertTriangle, CheckCircle2, RefreshCw, ServerCog } from 'lucide-react'
import { getHealth } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Button, SectionHeading } from './ui'
import { t } from '../i18n'

/**
 * Says which server features have their keys, which is otherwise invisible from the outside.
 *
 * /api/health answers with configuration state and never with a secret. Anything that is not
 * JSON means the functions are not deployed at all — usually a static preview, or a rewrite
 * swallowing /api/.
 */

function Row({ ok, label, detail, keyName }: { ok: boolean; label: string; detail?: string; keyName: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle
  return (
    <li className="border edge fill-soft p-4">
      <p className={`flex items-center gap-2 text-sm font-bold ${ok ? 'text-emerald-700' : 'text-amber-800'}`}>
        <Icon size={15} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-sm text-ink-600">{ok ? t('configured') : t('set_key_then_redeploy', { key: keyName })}</p>
      {detail && <p className="mt-1 font-mono text-xs text-ink-500">{detail}</p>}
    </li>
  )
}

export default function ServerStatus() {
  const { data, error, loading, reload } = useAsync(getHealth, [])

  return (
    <>
      <SectionHeading title={t('server_features')} subtitle={t('what_needs_a_key')} icon={ServerCog} />
      {error ? (
        <p className="mt-4 border edge fill-soft p-4 text-sm text-rose-700">{t('functions_not_deployed')}</p>
      ) : data ? (
        <ul className="mt-4 space-y-3">
          <Row ok={data.text.configured} label={t('feature_text')} keyName="GEMINI_API_KEY" detail={data.text.models.join(' → ')} />
          {/* The anonymous Pollinations fallback is always last, so "configured" means a keyed provider is there too. */}
          <Row ok={data.images.providers.some((p) => p !== 'pollinations-legacy')} label={t('feature_images')} keyName="POLLINATIONS_API_KEY / HF_TOKEN" detail={data.images.providers.join(' → ') || '—'} />
          <Row ok={data.payments.configured} label={t('feature_payments')} keyName="STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET" />
          <Row ok={data.payments.connectEvents} label={t('feature_connect_events')} keyName="STRIPE_CONNECT_WEBHOOK_SECRET" />
        </ul>
      ) : null}
      <div className="mt-4">
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={() => void reload()}>
          {t('check_again')}
        </Button>
      </div>
    </>
  )
}
