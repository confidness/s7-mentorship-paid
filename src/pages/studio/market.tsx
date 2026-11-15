import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Search } from 'lucide-react'
import { Button, Card, SectionHeading } from '../../components/ui'
import { ErrorNote } from '../../components/kit'
import { findSimilar, getPlan, type WebHit } from '../../lib/api'
import { errorMessage, useAsync } from '../../lib/hooks'
import { useApp } from '../../lib/store'
import { t } from '../../i18n'

function Hits({ title, hits }: { title: string; hits: WebHit[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {hits.length === 0 && <p className="text-sm text-ink-500">{t('similar_none')}</p>}
      {hits.map((h) => (
        <a key={h.url} href={h.url} target="_blank" rel="noopener noreferrer" className="block rounded-[var(--ui-radius-sm)] border edge fill-soft p-3 transition hover:fill">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            {h.title || h.url}
            <ExternalLink size={13} aria-hidden="true" className="shrink-0 text-ink-400" />
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-400">{h.url}</span>
          {h.snippet && <span className="mt-1 block text-sm text-ink-600">{h.snippet}</span>}
        </a>
      ))}
    </div>
  )
}

/** Pro: who already runs a business like this nearby, and who already uses the name. */
export function MarketPanel({ kitId }: { kitId: string }) {
  const { user } = useApp()
  const { data: plan } = useAsync(() => (user ? getPlan(user.id) : Promise.resolve(null)), [user?.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<{ similar: WebHit[]; sameName: WebHit[] } | null>(null)
  const pro = plan?.plan === 'pro'

  async function run() {
    setBusy(true)
    setError('')
    try {
      setFound(await findSimilar({ brandKitId: kitId }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <SectionHeading title={t('similar_title')} subtitle={t('similar_note')} icon={Search} />
      {pro ? (
        <Button icon={Search} loading={busy} onClick={() => void run()}>
          {t('search_web')}
        </Button>
      ) : (
        <p className="text-sm text-ink-600">
          {t('pro_only_feature')}{' '}
          <Link to="/settings" className="font-semibold underline underline-offset-2">
            {t('see_pro')}
          </Link>
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {found && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Hits title={t('similar_like_you')} hits={found.similar} />
          <Hits title={t('similar_same_name')} hits={found.sameName} />
        </div>
      )}
    </Card>
  )
}
