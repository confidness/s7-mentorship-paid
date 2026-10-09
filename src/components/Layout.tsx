import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { MoreHorizontal, X } from 'lucide-react'
import { useApp } from '../lib/store'
import ThemeToggle from './ThemeToggle'
import { t } from '../i18n'
import { Mark } from './Mark'
import LiquidMetalBackground from './LiquidMetalBackground'
import { PageTransition } from './motion'
import { SectionTabs, tabsForPath } from './sections'
import { isNavActive, navFor, type NavItem } from './nav'
import { NavRail, UserMenu, useEscape } from './menubar'

/** The mark on its disc. Under the orbit skin a slow ring of light turns behind it. */
function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <span className="brand-mark relative grid shrink-0 place-items-center rounded-full">
      <Mark size={size} className="relative rounded-full shadow-[0_8px_18px_-8px_rgb(228_87_46/0.7)]" />
    </span>
  )
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={40} />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('brand')}</span>
          <span className="block text-xs text-ink-500">{t('brand_tagline')}</span>
        </span>
      )}
    </span>
  )
}

function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > threshold)
    sync()
    window.addEventListener('scroll', sync, { passive: true })
    return () => window.removeEventListener('scroll', sync)
  }, [threshold])
  return scrolled
}

/**
 * The phone's menu: a dock at the thumb, four sections and "more". A section that is not in
 * the dock lights "more", because that is where it is reached from.
 */
function MobileDock({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const { pathname } = useLocation()
  const dock = items.filter((n) => n.primary).slice(0, 4)
  const at = dock.findIndex((item) => isNavActive(item, pathname))
  const elsewhere = at < 0 && items.some((item) => isNavActive(item, pathname))
  const slots = dock.length + 1
  const slot = at >= 0 ? at : elsewhere ? dock.length : -1

  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:hidden" aria-label={t('primary')}>
      <div className="dock relative mx-auto max-w-md">
        <div aria-hidden="true" className="menubar-slab chrome absolute inset-0" />
        <div className="relative grid p-1.5" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {slot >= 0 && (
            <span
              aria-hidden="true"
              className="nav-pill slide pointer-events-none absolute top-1.5 bottom-1.5 left-1.5"
              style={{ width: `calc((100% - 0.75rem) / ${slots})`, transform: `translateX(${slot * 100}%)` }}
            />
          )}
          {dock.map((item, i) => {
            const on = i === at
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={on ? 'page' : undefined}
                className={`relative z-10 flex min-w-0 flex-col items-center gap-1 px-0.5 py-2 text-[11px] font-semibold transition-colors ${on ? 'text-ink-900' : 'text-ink-500'}`}
              >
                <item.icon size={19} className={on ? 'text-brand-500' : ''} aria-hidden="true" />
                <span className="max-w-full truncate">{t(item.short ?? item.label)}</span>
              </Link>
            )
          })}
          <button onClick={onMore} className={`relative z-10 flex min-w-0 flex-col items-center gap-1 px-0.5 py-2 text-[11px] font-semibold ${slot === dock.length ? 'text-ink-900' : 'text-ink-500'}`} aria-haspopup="dialog">
            <MoreHorizontal size={19} className={slot === dock.length ? 'text-brand-500' : ''} aria-hidden="true" />
            <span className="max-w-full truncate">{t('more')}</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

/** Everything the dock has no room for, in a sheet that rises from where the thumb already is. */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { pathname } = useLocation()
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => closeButton.current?.focus(), [])

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button className="absolute inset-0 bg-ink-950/30 backdrop-blur-md" onClick={onClose} aria-label={t('close_navigation')} tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-label={t('main')} className="animate-sheet chrome absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[85vh] max-w-md overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <Logo />
          <button ref={closeButton} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[var(--ui-radius-sm)] fill text-ink-500 hover:fill-raised hover:text-ink-900" aria-label={t('close_navigation')}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <nav className="grid grid-cols-2 gap-2" aria-label={t('main')}>
          {items.map((item) => {
            const on = isNavActive(item, pathname)
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-[var(--ui-radius-sm)] px-3.5 py-3 text-sm font-semibold transition ${on ? 'nav-pill text-ink-900' : 'fill text-ink-700 hover:fill-raised'}`}
              >
                <item.icon size={18} className={on ? 'text-brand-500' : 'text-ink-400'} aria-hidden="true" />
                <span className="truncate">{t(item.label)}</span>
              </Link>
            )
          })}
        </nav>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t edge pt-4">
          <ThemeToggle compact />
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user } = useApp()
  const location = useLocation()
  const [sheet, setSheet] = useState(false)
  const closeSheet = useCallback(() => setSheet(false), [])
  const scrolled = useScrolled()
  const sectionTabs = tabsForPath(location.pathname)
  const nav = navFor(user?.role)
  useEscape(sheet, closeSheet)

  useEffect(() => {
    setSheet(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-screen">
      {/* Each self-gates by skin: the metal under `brutal`; the orbit scene is mounted once in
          App.tsx so it survives navigation. */}
      <LiquidMetalBackground depth="app" />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* The glass is a sibling of the content, not its parent: a backdrop-filter would
            otherwise become the containing block of the popovers and clip their blur. */}
        <div className="menubar relative mx-auto max-w-7xl" data-scrolled={scrolled || undefined}>
          <div aria-hidden="true" className="menubar-slab chrome absolute inset-0" />
          <div className="relative flex h-16 items-center gap-2 px-2 sm:px-3">
            <div className="flex min-w-0 flex-1 basis-0">
              <Link to="/" aria-label={t('brand')} className="flex min-w-0 items-center gap-2.5 rounded-[var(--ui-radius-sm)] pr-2">
                <BrandMark />
                <span className="min-w-0 leading-tight lg:hidden xl:block">
                  <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('brand')}</span>
                  <span className="block truncate text-[11px] text-ink-500">{user ? t(`role_${user.role}`) : t('brand_tagline')}</span>
                </span>
              </Link>
            </div>

            <NavRail items={nav} />

            <div className="flex min-w-max flex-1 basis-0 items-center justify-end gap-1.5">
              <span className="hidden xl:inline-flex">
                <ThemeToggle compact />
              </span>
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-7 pb-36 sm:px-6 lg:pb-16">
        {sectionTabs && <SectionTabs tabs={sectionTabs} />}
        <PageTransition routeKey={location.pathname}>
          <Outlet />
        </PageTransition>
      </main>

      {sheet && <MoreSheet items={nav} onClose={closeSheet} />}
      <MobileDock items={nav} onMore={() => setSheet(true)} />
    </div>
  )
}
