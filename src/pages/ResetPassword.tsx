import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp, useToast } from '../lib/store'
import { supabase } from '../lib/supabase'
import { Button, Field, inputClass } from '../components/ui'
import { ErrorNote } from '../components/kit'
import { t } from '../i18n'

/**
 * Where the emailed reset link lands.
 *
 * supabase-js reads the recovery token from the URL on load and signs the person in for this
 * purpose; all that is left is the new password. With no session — the link expired, was used
 * already, or was opened in another browser — there is nothing to update, so the page says so
 * rather than showing a form that cannot work.
 */
export default function ResetPassword() {
  const { user } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError(t('use_at_least_8_characters'))
    setBusy(true)
    const { error } = await supabase().auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    toast({ title: t('password_updated'), tone: 'success' })
    navigate('/', { replace: true })
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="card specular w-full max-w-md space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-ink-900">{t('set_new_password')}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{t('set_new_password_subtitle')}</p>
        </div>

        {user ? (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field label={t('new_password')} required hint={t('at_least_8_characters')}>
              <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" size="lg" loading={busy} className="w-full">
              {t('save_password')}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <ErrorNote>{t('reset_link_expired')}</ErrorNote>
            <Link to="/login" className="inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
              {t('back_to_sign_in')}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
