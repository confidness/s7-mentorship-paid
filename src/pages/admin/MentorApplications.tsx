import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, FileText, Inbox, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { Button, Card, Field, SectionHeading, inputClass } from '../../components/ui'
import { ApiError, decideApplication, listApplications, type PendingApplication } from '../../lib/api'
import { t } from '../../i18n'

/**
 * The review desk.
 *
 * This is the whole replacement for the admin PIN: instead of a secret that turns anyone who
 * has it into a mentor, a named person reads an application and decides. The decision is
 * recorded with who made it and when, and can be reversed later — none of which a PIN allows.
 *
 * Document links are signed and expire in minutes. They are requested fresh on each load
 * rather than held, so a link copied out of devtools stops working almost immediately.
 */

function Documents({ application }: { application: PendingApplication }) {
  const links = [
    { url: application.credentialUrl, label: t('teaching_credential') },
    { url: application.idUrl, label: t('identity_document') },
  ].filter((link) => link.url)

  if (!links.length) return <p className="text-sm text-ink-500">{t('no_documents_attached')}</p>

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.url as string}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 fill-soft px-3.5 py-2 text-sm font-semibold text-ink-700 transition hover:text-brand-700"
        >
          <FileText size={15} aria-hidden="true" />
          {link.label}
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      ))}
    </div>
  )
}

function Row({ application, onDecided }: { application: PendingApplication; onDecided: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState('')

  async function decide(decision: 'approved' | 'rejected') {
    // A rejection without a reason is one the applicant will simply refile unchanged.
    if (decision === 'rejected' && reason.trim().length < 4) {
      setRejecting(true)
      setError(t('give_a_reason_for_the_rejection'))
      return
    }
    setBusy(decision)
    setError('')
    try {
      await decideApplication(application.id, decision, reason.trim())
      toast({ title: decision === 'approved' ? t('mentor_approved') : t('application_rejected'), tone: 'success' })
      onDecided()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('something_went_wrong_try_again'))
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.02em] text-ink-900">{application.legal_name}</h2>
          <p className="text-sm text-ink-500">
            {application.profiles?.name ?? ''}
            {application.profiles?.city ? ` · ${application.profiles.city}` : ''}
          </p>
        </div>
        <time className="text-xs text-ink-500" dateTime={application.submitted_at}>
          {new Date(application.submitted_at).toLocaleDateString()}
        </time>
      </div>

      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-700">{application.bio}</p>

      <Documents application={application} />

      {rejecting && (
        <Field label={t('reason_for_rejection')} required>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('what_should_they_fix')} />
        </Field>
      )}

      {error && (
        <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button icon={CheckCircle2} loading={busy === 'approved'} onClick={() => void decide('approved')}>
          {t('approve')}
        </Button>
        <Button variant="secondary" icon={XCircle} loading={busy === 'rejected'} onClick={() => void decide('rejected')}>
          {t('reject')}
        </Button>
      </div>
    </Card>
  )
}

export default function MentorApplications() {
  const { standing } = useApp()
  const [applications, setApplications] = useState<PendingApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { applications: rows } = await listApplications('pending')
      setApplications(rows)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('something_went_wrong_try_again'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The server refuses a non-admin outright; this only avoids rendering a queue that would
  // come back empty with a 403.
  if (!standing.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-6">
          <SectionHeading title={t('admins_only')} subtitle={t('this_page_reviews_mentor_applications')} icon={ShieldCheck} />
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('mentor_applications')}</h1>
          <p className="mt-1.5 text-sm text-ink-600">{t('approve_the_people_who_may_teach_and_sell')}</p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
          {t('check_again')}
        </Button>
      </header>

      {error && (
        <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      {!loading && !applications.length && !error && (
        <Card className="p-10 text-center">
          <Inbox size={22} className="mx-auto text-ink-400" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink-600">{t('nothing_waiting_for_review')}</p>
        </Card>
      )}

      {applications.map((application) => (
        <Row key={application.id} application={application} onDecided={() => void load()} />
      ))}
    </div>
  )
}
