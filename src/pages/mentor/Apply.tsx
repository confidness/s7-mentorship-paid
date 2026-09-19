import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, FileText, ShieldCheck, Upload, X, XCircle } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { Button, Card, Field, SectionHeading, inputClass } from '../../components/ui'
import { ApiError, applyToTeach, getMentorStanding } from '../../lib/api'
import { backendConfigured, uploadPrivate } from '../../lib/supabase'
import type { MentorStatus } from '../../lib/types'
import { t } from '../../i18n'

/**
 * Applying to teach — what replaced the shared mentor PIN.
 *
 * The PIN asked whether someone knew a number. This asks who they are, and a named reviewer
 * answers. That is slower by design: the person approved here will handle children's work and
 * take their families' money, and a number passed around a staff room says nothing about them.
 *
 * Documents go straight to a private bucket from the browser. This page only ever holds the
 * storage path, never the file's contents, so nothing sensitive passes through app state.
 */

const MAX_DOC_BYTES = 8 * 1024 * 1024
const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

interface Upload {
  path: string
  name: string
}

function DocField({
  label,
  hint,
  value,
  error,
  busy,
  onPick,
  onClear,
}: {
  label: string
  hint: string
  value: Upload | null
  error?: string
  busy: boolean
  onPick: (file: File) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Field label={label} hint={hint} error={error}>
      {value ? (
        <div className="flex items-center gap-3 rounded-[14px] fill-soft px-3.5 py-3">
          <FileText size={16} className="shrink-0 text-ink-500" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{value.name}</span>
          <button type="button" onClick={onClear} className="rounded-full p-1 text-ink-500 transition hover:text-ink-900" aria-label={t('remove')}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <input
            ref={ref}
            type="file"
            className="sr-only"
            accept={DOC_ACCEPT}
            aria-label={label}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPick(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => ref.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed edge fill-soft px-4 py-6 text-sm font-semibold text-ink-600 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
          >
            <Upload size={16} aria-hidden="true" />
            {busy ? t('uploading') : t('upload_a_document')}
          </button>
        </>
      )}
    </Field>
  )
}

/** Where the application stands, once there is one. */
function Verdict({ status, reason }: { status: MentorStatus; reason?: string }) {
  if (status === 'approved') {
    return (
      <Card className="space-y-3 p-6">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <CheckCircle2 size={16} aria-hidden="true" />
          {t('you_are_approved_to_teach')}
        </span>
        <p className="text-sm text-ink-600">{t('set_up_payouts_to_start_selling_lessons')}</p>
        <Link to="/m/payouts" className="inline-flex text-sm font-semibold text-brand-600 underline underline-offset-2">
          {t('set_up_payouts')}
        </Link>
      </Card>
    )
  }

  if (status === 'pending') {
    return (
      <Card className="space-y-2 p-6">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
          <Clock size={16} aria-hidden="true" />
          {t('your_application_is_being_reviewed')}
        </span>
        <p className="text-sm text-ink-600">{t('we_will_let_you_know_when_a_reviewer_has_looked')}</p>
      </Card>
    )
  }

  return (
    <Card className="space-y-2 p-6">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700">
        <XCircle size={16} aria-hidden="true" />
        {t('your_application_was_not_approved')}
      </span>
      {reason && <p className="text-sm text-ink-600">{reason}</p>}
      <p className="text-sm text-ink-500">{t('you_can_apply_again_with_the_details_corrected')}</p>
    </Card>
  )
}

export default function MentorApply() {
  const { user, refreshStanding } = useApp()
  const toast = useToast()

  const [status, setStatus] = useState<MentorStatus | 'loading'>('loading')
  const [reason, setReason] = useState<string>()
  const [legalName, setLegalName] = useState(user?.name ?? '')
  const [bio, setBio] = useState('')
  const [credential, setCredential] = useState<Upload | null>(null)
  const [identity, setIdentity] = useState<Upload | null>(null)
  const [uploading, setUploading] = useState<'credential' | 'identity' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!backendConfigured) return setStatus('none')
    let alive = true
    void getMentorStanding()
      .then((data) => {
        if (!alive) return
        setStatus(data.status)
        setReason(data.application?.rejectionReason)
      })
      .catch(() => alive && setStatus('none'))
    return () => {
      alive = false
    }
  }, [])

  async function pick(which: 'credential' | 'identity', file: File) {
    if (file.size > MAX_DOC_BYTES) {
      setErrors((e) => ({ ...e, [which]: t('file_too_large', { name: file.name, mb: 8 }) }))
      return
    }
    setUploading(which)
    setErrors((e) => ({ ...e, [which]: '' }))
    try {
      const path = await uploadPrivate('mentor-docs', file)
      const value = { path, name: file.name }
      if (which === 'credential') setCredential(value)
      else setIdentity(value)
    } catch (error) {
      setErrors((e) => ({ ...e, [which]: error instanceof Error ? error.message : t('file_could_not_be_read', { name: file.name }) }))
    } finally {
      setUploading(null)
    }
  }

  async function submit() {
    const next: Record<string, string> = {}
    if (legalName.trim().length < 2) next.legalName = t('tell_us_your_name')
    if (bio.trim().length < 40) next.bio = t('write_at_least_40_characters_about_your_teaching')
    if (!credential && !identity) next.credential = t('attach_at_least_one_document')
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    try {
      await applyToTeach({ legalName: legalName.trim(), bio: bio.trim(), credentialDocPath: credential?.path ?? null, idDocPath: identity?.path ?? null })
      setStatus('pending')
      await refreshStanding()
      toast({ title: t('application_sent'), body: t('we_will_let_you_know_when_a_reviewer_has_looked'), tone: 'success' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('something_went_wrong_try_again')
      setErrors({ form: message })
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('teach_on_s7')}</h1>
        <p className="mt-1.5 text-sm text-ink-600">{t('mentors_are_verified_before_they_can_publish')}</p>
      </header>

      {status !== 'none' && <Verdict status={status} reason={reason} />}

      {(status === 'none' || status === 'rejected') && (
        <Card className="space-y-5 p-6">
          <SectionHeading title={t('your_details')} subtitle={t('a_reviewer_reads_this_before_deciding')} icon={ShieldCheck} />

          <Field label={t('legal_name')} required error={errors.legalName} hint={t('as_it_appears_on_your_documents')}>
            <input className={inputClass} value={legalName} onChange={(e) => setLegalName(e.target.value)} autoComplete="name" />
          </Field>

          <Field label={t('about_your_teaching')} required error={errors.bio} hint={t('what_you_teach_and_where_you_have_taught')}>
            <textarea className={`${inputClass} min-h-[8rem] resize-y`} value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>

          <DocField
            label={t('teaching_credential')}
            hint={t('a_certificate_or_proof_of_employment')}
            value={credential}
            error={errors.credential}
            busy={uploading === 'credential'}
            onPick={(file) => void pick('credential', file)}
            onClear={() => setCredential(null)}
          />

          <DocField
            label={t('identity_document')}
            hint={t('only_a_reviewer_sees_this_and_only_briefly')}
            value={identity}
            error={errors.identity}
            busy={uploading === 'identity'}
            onPick={(file) => void pick('identity', file)}
            onClear={() => setIdentity(null)}
          />

          {/* Said plainly, because the request is unusual and the answer should not be buried
              in a policy page nobody opens. */}
          <p className="rounded-[14px] fill-soft px-3.5 py-3 text-xs leading-relaxed text-ink-600">{t('documents_are_stored_privately_and_shown_only_to_reviewers')}</p>

          {errors.form && (
            <p role="alert" className="rounded-[14px] border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
              {errors.form}
            </p>
          )}

          <Button onClick={() => void submit()} loading={busy} disabled={Boolean(uploading)} size="lg">
            {t('send_application')}
          </Button>
        </Card>
      )}
    </div>
  )
}
