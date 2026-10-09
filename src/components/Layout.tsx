import { Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { MoreHorizontal, X } from 'lucide-react'
import { useApp } from '../lib/store'
import LocaleToggle from './LocaleToggle'
import { t, useLocale } from '../i18n'
import { Mark } from './Mark'
import LiquidMetalBackground from './LiquidMetalBackground'
import { PageTransition } from './motion'
import { Skeleton } from './ui'
import { SectionTabs, tabsForPath, type SectionTab } from './sections'
import { isNavActive, navFor, type NavItem } from './nav'
import { LevelCard, NavRail, NotificationBell, UserMenu, XpChip, useEscape } from './menubar'

/** The mark on its disc. Under the orbit skin a slow ring of light turns behind it. */
function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <span className="brand-mark relative grid shrink-0 place-items-center rounded-full">
      <Mark size={size} className="relative rounded-full shadow-[0_8px_18px_-8px_rgb(21_96_236/0.7)]" />
    </span>
  )
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={40} />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('s7_brand')}</span>
          <span className="block text-xs text-ink-500">{t('learning_platform')}</span>
        </span>
      )}
    </span>
  )
}

/**
 * The name of the page for the browser tab: its own tab in the section strip if it has one,
 * otherwise the menu entry it sits under.
 *
 * Derived from the navigation rather than set by each screen, so there is one place that
 * decides it and no page can forget to. A page outside every section — a single lesson, a
 * course — gets the brand alone, which is what every page used to get.
 */
function pageLabel(pathname: string, nav: NavItem[], tabs: SectionTab[] | null): string | undefined {
  const tab = tabs?.find((tab) => tab.to === pathname)
  if (tab) return tab.label
  return nav.find((item) => isNavActive(item, pathname))?.label
}

/**
 * What stands in for a screen while its code is on its way.
 *
 * Screens load on first visit now, so there is a moment with chrome and no page. The shapes
 * say "a page goes here" without words, and the short delay keeps them from flickering on a
 * fast connection, where the code usually arrives before anyone could read them.
 */
function PageFallback() {
  return (
    <div aria-hidden="true" className="animate-rise space-y-4" style={{ animationDelay: '150ms' }}>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-48 w-full" />
    </div>
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
 * The phone's menu: a dock at the thumb, four sections and "more".
 *
 * The marker is one element translated by whole slots, so it glides between them the same way
 * the desktop rail does. A section that is not in the dock — the account — lights "more",
 * because that is where it is reached from.
 */
function MobileDock({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const { pathname } = useLocation()
  const dock = items.filter((n) => n.primary).slice(0, 4)
  const at = dock.findIndex((item) => isNavActive(item, pathname))
  const elsewhere = at < 0 && items.some((item) => isNavActive(item, pathname))
  const slot = at >= 0 ? at : elsewhere ? 4 : -1

  return (
    <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:hidden" aria-label={t('primary')}>
      <div className="dock relative mx-auto max-w-md">
        <div aria-hidden="true" className="menubar-slab chrome absolute inset-0" />
        <div className="relative grid grid-cols-5 p-1.5">
          {slot >= 0 && (
            <span
              aria-hidden="true"
              className="nav-pill slide pointer-events-none absolute top-1.5 bottom-1.5 left-1.5"
              style={{ width: 'calc((100% - 0.75rem) / 5)', transform: `translateX(${slot * 100}%)` }}
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
          <button onClick={onMore} className={`relative z-10 flex min-w-0 flex-col items-center gap-1 px-0.5 py-2 text-[11px] font-semibold ${slot === 4 ? 'text-ink-900' : 'text-ink-500'}`} aria-haspopup="dialog">
            <MoreHorizontal size={19} className={slot === 4 ? 'text-brand-500' : ''} aria-hidden="true" />
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

        <div className="mt-4 empty:hidden">
          <LevelCard />
        </div>

        {/* Language only: light and dark are the device's setting, and there is no switch. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t edge pt-4">
          <span className="text-sm font-medium text-ink-700">{t('language')}</span>
          <LocaleToggle compact />
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user } = useApp()
  const { locale } = useLocale()
  const location = useLocation()
  const [sheet, setSheet] = useState(false)
  const closeSheet = useCallback(() => setSheet(false), [])
  const scrolled = useScrolled()
  const sectionTabs = tabsForPath(location.pathname)
  const nav = navFor(location.pathname)
  const home = user?.role === 'mentor' ? '/m' : '/'
  const main = useRef<HTMLElement>(null)
  const lastPath = useRef(location.pathname)
  useEscape(sheet, closeSheet)

  useEffect(() => {
    setSheet(false)
    window.scrollTo({ top: 0 })
    // A client-side navigation leaves focus on the link that was used, which may not even
    // exist on the next page, so a screen reader announces nothing and the next Tab starts
    // from wherever that was. Moving it to the page says a new one has arrived. Compared
    // against the last path rather than skipped once, so a first load — and StrictMode's
    // second run of this effect — leaves focus where the browser put it.
    if (lastPath.current === location.pathname) return
    lastPath.current = location.pathname
    main.current?.focus({ preventScroll: true })
  }, [location.pathname])

  const page = pageLabel(location.pathname, nav, sectionTabs)
  useEffect(() => {
    document.title = page ? `${t(page)} · ${t('s7_brand')}` : t('s7_brand')
  }, [page, locale])

  const skipToMain = (e: MouseEvent) => {
    // Focus rather than follow the hash: `#main` in the address bar would sit there through
    // every later navigation, and the router would record it as a visit of its own.
    e.preventDefault()
    main.current?.focus()
  }

  return (
    <div className="min-h-screen">
      {/* First in the tab order, parked above the viewport until focused: without it a
          keyboard has to walk the whole menu bar on every page before reaching what changed.
          Moved off screen rather than hidden, so a screen reader still has it. */}
      <a
        href="#main"
        onClick={skipToMain}
        className="chrome fixed top-4 left-4 z-[70] -translate-y-[calc(100%+2rem)] px-4 py-2.5 text-sm font-semibold text-ink-900 focus:translate-y-0"
      >
        {t('skip_to_content')}
      </a>

      {/* Self-gates on the resolved background: the metal under `brutal` on Auto. The orbit
          world is mounted once in App.tsx, beside the routes, so it survives navigation. */}
      <LiquidMetalBackground depth="app" />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* The glass is a sibling of the content, not its parent: a backdrop-filter would
            otherwise become the containing block of the popovers and clip their blur. */}
        <div className="menubar relative mx-auto max-w-7xl" data-scrolled={scrolled || undefined}>
          <div aria-hidden="true" className="menubar-slab chrome absolute inset-0" />
          {/* Two equal flexible sides keep the rail centred; the right side never shrinks
              below its own width, so a long label pushes the rail over rather than under it. */}
          <div className="relative flex h-16 items-center gap-2 px-2 sm:px-3">
            <div className="flex min-w-0 flex-1 basis-0">
              <Link to={home} aria-label={t('s7_brand')} className="flex min-w-0 items-center gap-2.5 rounded-[var(--ui-radius-sm)] pr-2">
                <BrandMark />
                <span className="min-w-0 leading-tight lg:hidden xl:block">
                  <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('s7_brand')}</span>
                  <span className="block truncate text-[11px] text-ink-500">{user?.role === 'mentor' ? t('mentor_workspace') : t('student_workspace')}</span>
                </span>
              </Link>
            </div>

            <NavRail items={nav} />

            <div className="flex min-w-max flex-1 basis-0 items-center justify-end gap-1.5">
              {user?.role === 'student' && <XpChip />}
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* tabIndex -1 makes it a place focus can be sent to without making it a stop on the
          Tab key; the outline is dropped because it is a destination, not a control.
          The backdrop keeps its first 560 pixels calm: every page's heading, lede and
          section titles sit straight on the canvas there, and everything wider is a card. */}
      <main
        ref={main}
        id="main"
        tabIndex={-1}
        data-backdrop-calm="column"
        data-backdrop-measure="560"
        className="mx-auto max-w-7xl px-4 pt-7 pb-36 outline-none sm:px-6 lg:pb-16"
      >
        {/* The section strip sits outside the transition on purpose: it belongs to the
            section rather than to the page, so it should stay put while the page under it
            changes. Animating it would make moving between two tabs look like leaving. */}
        {sectionTabs && <SectionTabs tabs={sectionTabs} />}
        {/* Replaces `.animate-rise` on every page root: the same movement in one place, and
            the outgoing screen can leave rather than vanish. */}
        <PageTransition routeKey={location.pathname}>
          {/* Inside the chrome and inside the transition, so the menu bar stays put while a
              screen's code loads, and the screen still makes its one entrance. */}
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </PageTransition>
      </main>

      {sheet && <MoreSheet items={nav} onClose={closeSheet} />}
      <MobileDock items={nav} onMore={() => setSheet(true)} />
    </div>
  )
}
