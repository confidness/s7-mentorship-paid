import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useApp, useToast } from '../lib/store'
import type { Role } from '../lib/bazaar'
import { Button, Field, inputClass } from '../components/ui'
import { Logo } from '../components/Layout'
import ThemeToggle from '../components/ThemeToggle'
import { t } from '../i18n'
import { Mark } from '../components/Mark'
import LiquidMetalBackground from '../components/LiquidMetalBackground'
import AtelierSceneGate from '../components/AtelierSceneGate'
import { RolePicker } from './Settings'

export default function Login({ register: startOnRegister }: { register?: boolean }) {
  const { login, register } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'login' | 'register'>(startOnRegister ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('client')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = t('enter_a_valid_email_address')
    if (password.length < 8) next.password = t('use_at_least_8_characters')
    if (mode === 'register' && name.trim().length < 2) next.name = t('tell_us_your_name')
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    const result = await (mode === 'login' ? login(email, password) : register({ name, email, password, role }))
    setBusy(false)

    if (!result.ok) {
      setErrors({ form: result.error ?? t('something_went_wrong_try_again') })
      return
    }
    toast({ title: mode === 'login' ? t('welcome_back') : t('account_created'), tone: 'success' })
    navigate(mode === 'register' && role === 'freelancer' ? '/sell' : '/', { replace: true })
  }

  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[1fr_minmax(26rem,32rem)]">
      <LiquidMetalBackground depth="hero" />
      <section className="relative hidden flex-col justify-center px-12 py-16 lg:flex xl:px-20">
        <AtelierSceneGate />
        <Logo />
        <h1 className="mt-14 max-w-xl text-[46px] leading-[1.05] font-bold tracking-[-0.035em] text-ink-900 xl:text-[58px]">
          {t('hero_line_one')} <span className="bg-gradient-to-r from-brand-500 to-accent-500 bg-clip-text text-transparent">{t('hero_line_two')}</span>
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-600">{t('hero_body')}</p>
        <ul className="mt-12 max-w-md space-y-2.5 text-sm text-ink-600">
          {['how_it_works_kit', 'how_it_works_create', 'how_it_works_hire'].map((key, i) => (
            <li key={key} className="flex gap-3">
              <span className="font-bold text-ink-900 tabular-nums">0{i + 1}</span>
              {t(key)}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-h-screen flex-col px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex shrink-0 items-center justify-end gap-2">
          <ThemeToggle compact />
        </div>

        <div className="flex flex-1 items-center justify-center py-6">
          <div className="card specular relative w-full max-w-md p-6 sm:p-8">
            <div className="relative mb-7 lg:hidden">
              <span className="inline-flex items-center gap-2.5">
                <Mark size={40} className="rounded-full" />
                <span className="text-lg font-bold tracking-[-0.02em] text-ink-900">{t('brand')}</span>
              </span>
            </div>

            <h2 className="relative text-[26px] font-bold tracking-[-0.03em] text-ink-900">{mode === 'login' ? t('sign_in') : t('create_your_account')}</h2>
            <p className="relative mt-1.5 text-sm text-ink-500">{mode === 'login' ? t('use_the_email_and_password_you_registered_with') : t('register_subtitle')}</p>

            <div className="chrome relative mt-6 mb-6 inline-flex w-full p-1" role="tablist">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m)
                    setErrors({})
                  }}
                  className={`relative flex-1 px-4 py-2 text-sm font-semibold transition ${mode === m ? 'fill-strong text-ink-900 shadow-[0_1px_2px_rgb(11_18_32/0.12)]' : 'text-ink-600'}`}
                >
                  {m === 'login' ? t('sign_in') : t('register')}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} noValidate className="relative space-y-4">
              {mode === 'register' && (
                <Field label={t('your_name')} required error={errors.name}>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </Field>
              )}

              <Field label={t('email')} required error={errors.email}>
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.com" autoComplete="email" />
              </Field>

              <Field label={t('password')} required error={errors.password} hint={mode === 'register' ? t('at_least_8_characters') : undefined}>
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </Field>

              {mode === 'register' && (
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink-800">{t('what_brings_you_here')}</legend>
                  <RolePicker value={role} onChange={setRole} compact />
                </fieldset>
              )}

              {errors.form && (
                <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
                  {errors.form}
                </p>
              )}

              <Button type="submit" size="lg" loading={busy} iconRight={ArrowRight} className="w-full">
                {mode === 'login' ? t('sign_in') : t('create_account')}
              </Button>
            </form>

            <p className="relative mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <ShieldCheck size={13} aria-hidden="true" />
              {t('payments_are_handled_by_stripe')}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
