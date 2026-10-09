import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Database, GraduationCap, Lock, Presentation, Receipt, type LucideIcon } from 'lucide-react'
import { btn } from '../components/ui'
import { AnimatedGroup, AnimatedItem } from '../components/motion'
import { Mark } from '../components/Mark'
import LocaleToggle from '../components/LocaleToggle'
import LiquidMetalBackground from '../components/LiquidMetalBackground'
import { DEFAULT_PLATFORM_FEE_BPS } from '../lib/money'
import { t, useLocale } from '../i18n'

const REPO_URL = 'https://github.com/confidness/s7-mentorship-paid'

/** README "The loop", in order. An ordered list, because the order is the whole point. */
const STEPS = [
  { title: 'landing_step_publish_title', body: 'landing_step_publish_body' },
  { title: 'landing_step_open_title', body: 'landing_step_open_body' },
  { title: 'landing_step_submit_title', body: 'landing_step_submit_body' },
  { title: 'landing_step_review_title', body: 'landing_step_review_body' },
  { title: 'landing_step_decide_title', body: 'landing_step_decide_body' },
]

/**
 * Each of these is a sentence a file in api/ makes true — lesson-content.ts, checkout.ts and
 * webhook.ts in that order. Only what the server holds belongs under this heading: who reviews
 * a hand-in is real but decided in the browser today, so it is said in the students column.
 */
const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Lock, title: 'landing_trust_paywall_title', body: 'landing_trust_paywall_body' },
  { icon: Database, title: 'landing_trust_price_title', body: 'landing_trust_price_body' },
  { icon: Receipt, title: 'landing_trust_access_title', body: 'landing_trust_access_body' },
]

/**
 * The public front door.
 *
 * Every route but sign-in asks who you are before it says what this is, so somebody arriving from
 * a search or a shared link used to meet a password field and nothing else. This page answers
 * the first three questions — what is it, who is it for, how does it work — and only then asks
 * for an account.
 *
 * What it does not do is count anything. A marketplace this young has no number worth showing,
 * and an invented one would be the first thing a visitor read here that was not true.
 */
export default function Landing() {
  const { locale } = useLocale()

  /**
   * Nothing else in the app names its tab, so the title is put back on the way out — otherwise
   * this page's would go on labelling /login and every screen after it.
   */
  useEffect(() => {
    const before = document.title
    document.title = t('landing_document_title', { brand: t('s7_brand') })
    return () => {
      document.title = before
    }
  }, [locale])

  /**
   * Computed from the constant the server falls back to, the same way the payouts screen does,
   * so the two cannot quote different splits. A deployment that sets PLATFORM_FEE_BPS changes
   * the real fee and not this sentence — the browser is never told what the server reads.
   */
  const fee = DEFAULT_PLATFORM_FEE_BPS / 100
  const share = 100 - fee

  const students = [
    { title: t('landing_students_pay_title'), body: t('landing_students_pay_body') },
    { title: t('landing_students_free_title'), body: t('landing_students_free_body') },
    { title: t('landing_students_mentor_title'), body: t('landing_students_mentor_body') },
    { title: t('landing_students_resubmit_title'), body: t('landing_students_resubmit_body') },
    { title: t('landing_students_ai_title'), body: t('landing_students_ai_body') },
  ]

  const mentors = [
    { title: t('landing_mentors_open_title'), body: t('landing_mentors_open_body') },
    { title: t('landing_mentors_price_title'), body: t('landing_mentors_price_body') },
    { title: t('landing_mentors_share_title', { n: share }), body: t('landing_mentors_share_body', { fee }) },
    { title: t('landing_mentors_gate_title'), body: t('landing_mentors_gate_body') },
  ]

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Renders only under the skin whose palette came out of it. `app` depth, not `hero`:
          headings and section text sit straight on the canvas here, not on a sheet. */}
      <LiquidMetalBackground />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <span className="flex min-w-0 items-center gap-2.5">
          <Mark size={36} className="shrink-0 rounded-full" />
          <span className="truncate text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('s7_brand')}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {/* In the header rather than the footer: a Kazakh speaker sent here in Russian should
              not have to scroll past four sections they cannot read to find the way out. */}
          <LocaleToggle compact />
          <span className="hidden sm:block">
            <Link to="/login" className={btn('secondary', 'sm')}>
              {t('sign_in')}
            </Link>
          </span>
        </div>
      </header>

      <main className="flex-1">
        <section aria-labelledby="landing-headline">
          {/* The backdrop is kept calm over the words of the hero and the column below them,
              measured off the text itself rather than the box it is allowed to grow to. */}
          <div data-backdrop-calm="text" className="mx-auto max-w-6xl px-4 pt-10 pb-2 sm:px-6 sm:pt-16 sm:pb-6 lg:px-8 lg:pt-20">
            <p className="text-sm font-semibold text-ink-600">{t('landing_kicker')}</p>
            <h1 id="landing-headline" className="mt-4 max-w-4xl text-[34px] leading-[1.08] font-bold tracking-[-0.035em] text-balance text-ink-900 sm:text-5xl sm:leading-[1.05] lg:text-[64px]">
              {t('landing_headline')}
            </h1>
            <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-600 sm:text-lg">{t('landing_lede')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {/* The one loud thing on the page. */}
              <Link to="/register" className={btn('primary', 'lg')}>
                {t('create_account')}
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <Link to="/login" className={btn('secondary', 'lg')}>
                {t('sign_in')}
              </Link>
            </div>
          </div>
        </section>

        <Section id="landing-how" title={t('landing_how_title')} lede={t('landing_how_lede')}>
          {/* The one staggered list on the page, because it is the one that is a sequence. */}
          <AnimatedGroup as="ol" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <AnimatedItem as="li" key={step.title} className="card flex gap-4 p-5 sm:last:col-span-2 lg:flex-col lg:gap-3 lg:last:col-span-1">
                {/* The list already says "1 of 5" to a screen reader; this is for the eye. Beside
                    the text on a phone, where five stacked cards would otherwise fill two screens. */}
                <span className="pt-0.5 text-sm font-bold text-ink-500 tabular-nums" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-base font-bold tracking-[-0.02em] text-ink-900">{t(step.title)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{t(step.body)}</p>
                </div>
              </AnimatedItem>
            ))}
          </AnimatedGroup>
        </Section>

        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:px-6 md:grid-cols-2 lg:px-8">
          <Audience id="landing-students" icon={GraduationCap} title={t('landing_students_title')} lede={t('landing_students_lede')} items={students} cta={t('create_account')} />
          <Audience
            id="landing-mentors"
            icon={Presentation}
            title={t('landing_mentors_title')}
            lede={t('landing_mentors_lede')}
            items={mentors}
            cta={t('teach_on_s7')}
            // Named with the labels the settings screen itself uses, so the directions match the screen.
            note={t('landing_mentors_cta_note', { settings: t('settings'), section: t('teach_on_s7') })}
          />
        </div>

        <Section id="landing-trust" title={t('landing_trust_title')} lede={t('landing_trust_lede')}>
          <ul className="mt-8 grid gap-3 md:grid-cols-3">
            {TRUST.map((item) => (
              <li key={item.title} className="card p-5 sm:p-6">
                <item.icon size={20} className="text-ink-700" aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold tracking-[-0.02em] text-ink-900">{t(item.title)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{t(item.body)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <section aria-labelledby="landing-languages" className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 lg:px-8">
          <div className="card flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 id="landing-languages" className="text-[22px] font-bold tracking-[-0.03em] text-ink-900 sm:text-2xl">
                {t('landing_languages_title')}
              </h2>
              <p className="mt-2 leading-relaxed text-ink-600">{t('landing_languages_body')}</p>
            </div>
            {/* The claim and the proof in the same place: switch it here and this card changes. */}
            <div className="shrink-0">
              <LocaleToggle />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t edge">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <span className="flex items-center gap-2.5">
            <Mark size={28} className="shrink-0 rounded-full" />
            <span className="text-sm font-bold tracking-[-0.02em] text-ink-900">{t('s7_brand')}</span>
          </span>
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
            <li>
              <a href={REPO_URL} className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                {t('landing_code_on_github')}
              </a>
            </li>
            <li>
              <Link to="/login" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                {t('sign_in')}
              </Link>
            </li>
            <li>
              <Link to="/register" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                {t('create_account')}
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  )
}

/** A titled band of the page. Heading and lede sit on the canvas; the content below brings its own sheets. */
function Section({ id, title, lede, children }: { id: string; title: string; lede: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <h2 id={id} className="text-[26px] font-bold tracking-[-0.03em] text-ink-900 sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl leading-relaxed text-ink-600">{lede}</p>
      {children}
    </section>
  )
}

/**
 * One side of the marketplace. Both lead to the same registration — everybody starts as a
 * student and teaching is switched on afterwards — so the two buttons differ only in wording,
 * and the mentors' side says where the switch is.
 */
function Audience({ id, icon: Icon, title, lede, items, cta, note }: { id: string; icon: LucideIcon; title: string; lede: string; items: { title: string; body: string }[]; cta: string; note?: string }) {
  return (
    <section aria-labelledby={id} className="card flex flex-col p-6 sm:p-8">
      <h2 id={id} className="flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.03em] text-ink-900 sm:text-2xl">
        <Icon size={22} className="shrink-0 text-ink-700" aria-hidden="true" />
        {title}
      </h2>
      <p className="mt-2 leading-relaxed text-ink-600">{lede}</p>
      <ul className="mt-6 flex-1 space-y-4">
        {items.map((item) => (
          <li key={item.title} className="border-l-2 edge pl-4">
            <p className="font-semibold text-ink-900">{item.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{item.body}</p>
          </li>
        ))}
      </ul>
      {/* `dark`, not `secondary`: the default skin draws a secondary button as white with no
          rule, which on a white card is a word floating in space. */}
      <div className="mt-8">
        {/* Above the button rather than under it, so both cards' buttons sit on the same line. */}
        {note && <p className="mb-4 text-sm leading-relaxed text-ink-500">{note}</p>}
        <Link to="/register" className={btn('dark', 'md')}>
          {cta}
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
