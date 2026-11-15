import { Link } from 'react-router-dom'
import { ArrowRight, Globe, ImagePlus, Palette, PenLine, Search } from 'lucide-react'
import { IMAGE_PACK, ONE_TIME_PRICE_USD, PLAN_LIMITS, PRO_PRICE_USD } from '../lib/plans'
import { LegalLinks } from './Legal'
import LocaleToggle from '../components/LocaleToggle'
import { t } from '../i18n'

/**
 * The front door for anyone not signed in. Layout language after ventorme.ai: a saturated blue
 * hero with a white "two minutes, free" card, features, numbered steps, prices and a pink
 * call-to-action band. Colours are fixed here on purpose — the landing is the same page in
 * every skin.
 */
const BLUE = '#3B47FF'
const PINK = '#F74F9E'
const HEAD = { fontFamily: "Manrope, 'Onest', system-ui, sans-serif" }

const FEATURES = [
  { icon: Palette, title: 'landing_f_kit', body: 'landing_f_kit_body' },
  { icon: PenLine, title: 'landing_f_copy', body: 'landing_f_copy_body' },
  { icon: ImagePlus, title: 'landing_f_images', body: 'landing_f_images_body' },
  { icon: Globe, title: 'landing_f_site', body: 'landing_f_site_body' },
  { icon: Search, title: 'landing_f_market', body: 'landing_f_market_body' },
] as const

const STEPS = ['landing_step_1', 'landing_step_2', 'landing_step_3', 'landing_step_4'] as const

const cta = 'inline-flex items-center gap-2 rounded-[18px] px-6 py-3.5 text-base font-semibold transition hover:opacity-90'

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#FAFBFC] text-[#0f1222]" style={{ fontFamily: "Onest, system-ui, sans-serif" }}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <span className="text-lg font-bold tracking-tight" style={HEAD}>
          Brandyzer
        </span>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <a href="#features" className="hidden px-2 sm:inline">{t('landing_nav_features')}</a>
          <a href="#pricing" className="hidden px-2 sm:inline">{t('landing_nav_pricing')}</a>
          <LocaleToggle />
          <Link to="/login" className="px-3 py-2">{t('sign_in')}</Link>
        </nav>
      </header>

      <section className="mx-3 rounded-[28px] px-4 py-16 text-center text-white sm:mx-6 sm:py-24" style={{ background: BLUE }}>
        <h1 className="mx-auto max-w-3xl text-[32px] leading-tight font-semibold sm:text-5xl" style={HEAD}>
          {t('landing_title')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-white/85 sm:text-lg">{t('landing_subtitle')}</p>
        <div className="mx-auto mt-10 max-w-md rounded-[22px] bg-white p-6 text-left text-[#0f1222] shadow-xl">
          <div className="flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#EEF0FF] px-2.5 py-1" style={{ color: BLUE }}>{t('landing_badge_time')}</span>
            <span className="rounded-full bg-[#FFEAF4] px-2.5 py-1" style={{ color: PINK }}>{t('landing_badge_free')}</span>
          </div>
          <p className="mt-3 text-lg font-semibold" style={HEAD}>{t('landing_card')}</p>
          <Link to="/register" className={`${cta} mt-5 w-full justify-center text-white`} style={{ background: BLUE }}>
            {t('landing_start')}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold sm:text-4xl" style={HEAD}>{t('landing_features_title')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[#5a6072]">{t('landing_features_subtitle')}</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-[22px] border border-[#E6E8EF] bg-white p-6">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#EEF0FF]" style={{ color: BLUE }}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold" style={HEAD}>{t(title)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#5a6072]">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold sm:text-4xl" style={HEAD}>{t('landing_steps_title')}</h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step} className="rounded-[22px] border border-[#E6E8EF] bg-white p-6">
              <span className="text-3xl font-bold" style={{ ...HEAD, color: BLUE }}>{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-3 text-sm leading-relaxed text-[#2a2f40]">{t(step)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing" className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold sm:text-4xl" style={HEAD}>{t('landing_nav_pricing')}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[22px] border border-[#E6E8EF] bg-white p-6">
            <p className="text-lg font-semibold" style={HEAD}>{t('plan_free')}</p>
            <p className="mt-1 text-3xl font-bold" style={HEAD}>$0</p>
            <p className="mt-3 text-sm text-[#5a6072]">{t('landing_free_includes', { kit: PLAN_LIMITS.free.kit, copy: PLAN_LIMITS.free.copy, image: PLAN_LIMITS.free.image })}</p>
          </div>
          <div className="rounded-[22px] p-6 text-white" style={{ background: BLUE }}>
            <p className="text-lg font-semibold" style={HEAD}>Pro</p>
            <p className="mt-1 text-3xl font-bold" style={HEAD}>
              ${PRO_PRICE_USD}
              <span className="text-base font-medium text-white/80">{t('landing_per_month')}</span>
            </p>
            <p className="mt-3 text-sm text-white/85">{t('landing_pro_includes', { kit: PLAN_LIMITS.pro.kit, copy: PLAN_LIMITS.pro.copy, image: PLAN_LIMITS.pro.image })}</p>
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-[#5a6072]">{t('landing_one_time', { price: ONE_TIME_PRICE_USD, n: IMAGE_PACK })}</p>
      </section>

      <section className="mx-3 rounded-[28px] px-4 py-14 text-center text-white sm:mx-6" style={{ background: PINK }}>
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold sm:text-4xl" style={HEAD}>{t('landing_cta_title')}</h2>
        <p className="mx-auto mt-3 max-w-lg text-white/90">{t('landing_card')}</p>
        <Link to="/register" className={`${cta} mt-7 bg-white`} style={{ color: PINK }}>
          {t('landing_start')}
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-[#5a6072] sm:px-6">
        <span>© {new Date().getFullYear()} Brandyzer</span>
        <LegalLinks />
      </footer>
    </div>
  )
}
