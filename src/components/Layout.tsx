import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, BookOpen, CalendarClock, ChevronRight, Compass, ClipboardCheck, FilePlus2, FolderKanban, GraduationCap, LayoutDashboard, LogOut, Menu,
  Settings, Sparkles, User as UserIcon, Users, X, Zap,
} from 'lucide-react'
import { useApp } from '../lib/store'
import { notificationsFor, profileOf, resolveVars } from '../lib/selectors'
import { levelFor } from '../lib/gamification'
import { Avatar, Badge, ProgressBar, Skeleton } from './ui'
import ThemeToggle from './ThemeToggle'
import LocaleToggle from './LocaleToggle'
import type { LucideIcon } from 'lucide-react'
import { t, formatDate, useLocale } from '../i18n'
import { Mark } from './Mark'
import LiquidMetalBackground from './LiquidMetalBackground'
import { AnimatedNumber, PageTransition } from './motion'
import { SectionTabs, tabsForPath, type SectionTab } from './sections'
import { localizeLevelName } from '../i18n/content'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  primary?: boolean
  /** Label for the mobile bottom bar, where there is room for one short word. */
  short?: string
  /**
   * The other paths this entry covers.
   *
   * A section is one sidebar entry over several pages — "Work" is projects, the gallery and
   * competitions — so the link has to stay lit while the reader moves between them with the
   * tabs. Without this the sidebar would go dark the moment they did, and look like they had
   * left the section they are plainly still in.
   */
  covers?: string[]
}

/**
 * Five entries, not eleven.
 *
 * The catalogue is the home page: what a person can learn here is the first thing the
 * platform has to show, and the old dashboard opened on a progress summary that a new
 * account had nothing to put in. Progress moved one level down, into the section it belongs
 * to, where it is the first tab.
 *
 * Everything else is grouped by what someone is trying to do rather than by which screen it
 * happens to live on: Learning is the track, the assignments and the badges; Work is
 * projects, the gallery they end up in and the competitions they are entered into.
 */
const STUDENT_NAV: NavItem[] = [
  { to: '/', label: 'courses', icon: BookOpen, end: true, primary: true, short: 'courses', covers: ['/requests'] },
  { to: '/learning', label: 'section_learning', icon: GraduationCap, primary: true, short: 'learning_short', covers: ['/assigned', '/achievements'] },
  { to: '/projects', label: 'section_work', icon: FolderKanban, primary: true, covers: ['/gallery', '/competition'] },
  { to: '/ai', label: 'ai_advisor', icon: Compass, primary: true, short: 'ai_mentor' },
  { to: '/profile', label: 'section_account', icon: UserIcon, covers: ['/settings'] },
]

const MENTOR_NAV: NavItem[] = [
  { to: '/m', label: 'section_overview', icon: LayoutDashboard, end: true, primary: true, short: 'dashboard', covers: ['/m/analytics'] },
  { to: '/m/lessons', label: 'section_materials', icon: FilePlus2, primary: true, short: 'my_lessons', covers: ['/m/requests', '/m/courses', '/m/competition'] },
  { to: '/m/reviews', label: 'section_review', icon: ClipboardCheck, primary: true, short: 'reviews', covers: ['/m/projects'] },
  { to: '/m/students', label: 'section_people', icon: Users, primary: true, short: 'students', covers: ['/m/groups'] },
  { to: '/m/settings', label: 'section_account', icon: Settings, covers: ['/m/payouts'] },
]

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={40} className="shrink-0 rounded-full shadow-[0_8px_18px_-8px_rgb(21_96_236/0.7)]" />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-[-0.02em] text-ink-900">{t('s7_brand')}</span>
          <span className="block text-xs text-ink-500">{t('learning_platform')}</span>
        </span>
      )}
    </span>
  )
}

/** True when the reader is anywhere inside this entry's section, not only on its own page. */
function covers(item: NavItem, pathname: string) {
  return (item.covers ?? []).some((path) => pathname === path || pathname.startsWith(path + '/'))
}

/**
 * The name of the page for the browser tab: its own tab in the section strip if it has one,
 * otherwise the sidebar entry it sits under.
 *
 * Derived from the navigation rather than set by each screen, so there is one place that
 * decides it and no page can forget to. A page outside every section — a single lesson, a
 * course — gets the brand alone, which is what every page used to get.
 */
function pageLabel(pathname: string, nav: NavItem[], tabs: SectionTab[] | null): string | undefined {
  const tab = tabs?.find((tab) => tab.to === pathname)
  if (tab) return tab.label
  return nav.find((item) => pathname === item.to || (!item.end && pathname.startsWith(item.to + '/')) || covers(item, pathname))?.label
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

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <nav className="flex flex-col gap-0.5" aria-label={t('main')}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition ${
              isActive || covers(item, pathname) ? 'fill-strong text-ink-900 shadow-[0_1px_2px_rgb(11_18_32/0.1),0_8px_18px_-10px_rgb(11_18_32/0.4)]' : 'text-ink-600 hover:fill-soft hover:text-ink-900'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon size={18} className={isActive || covers(item, pathname) ? 'text-brand-500' : 'text-ink-400 group-hover:text-ink-600'} aria-hidden="true" />
              {t(item.label)}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Escape closes it.
 *
 * All three overlays here — the bell, the account menu and the mobile drawer — dismiss by
 * clicking a transparent full-screen button behind them. That works with a mouse and is
 * invisible to a keyboard, which leaves anyone not using one with no way out except tabbing
 * through the whole panel. One listener on the window is cheaper than a focus trap and covers
 * the case a focus trap exists to make survivable.
 */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])
}

function NotificationBell() {
  const { state, user, readNotifications } = useApp()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const items = useMemo(() => (user ? notificationsFor(state, user.id) : []), [state, user])
  const unread = items.filter((n) => !n.read).length
  useEscape(open, () => setOpen(false))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-10 w-10 place-items-center fill text-ink-600 ring-1 rim transition hover:fill-raised hover:text-ink-900"
        aria-label={unread ? t('notifications_n_unread', { n: unread }) : t('notifications')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center bg-danger-solid px-1 text-[10px] font-bold text-white ring-2 ring-white">{unread}</span>
        )}
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label={t('close_notifications')} onClick={() => setOpen(false)} />
          <div className="animate-rise chrome specular absolute right-0 z-50 mt-2.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden">
            <div className="relative flex items-center justify-between border-b edge px-4 py-3">
              <p className="text-sm font-bold text-ink-900">{t('notifications')}</p>
              {unread > 0 && (
                <button className="text-xs font-semibold text-brand-600 hover:text-brand-700" onClick={() => readNotifications()}>
                  {t('mark_all_read')}
                </button>
              )}
            </div>
            <ul className="relative max-h-[22rem] divide-y divider overflow-y-auto">
              {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-500">{t('nothing_yet_actions_you_take_will_show_up_here')}</li>}
              {items.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <button
                    className={`flex w-full gap-3 px-4 py-3 text-left transition hover:fill ${n.read ? '' : 'bg-brand-100/45'}`}
                    onClick={() => {
                      readNotifications(n.id)
                      setOpen(false)
                      if (n.href) navigate(n.href)
                    }}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 ${n.read ? 'bg-ink-300' : 'bg-brand-600'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{t(n.title)}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">{t(n.body, resolveVars(state, n.vars))}</span>
                      <span className="mt-1 block text-[11px] text-ink-500">{formatDate(n.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, standing, logout } = useApp()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  useEscape(open, () => setOpen(false))
  if (!user) return null

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 fill py-1.5 pr-3 pl-1.5 ring-1 rim transition hover:fill-raised" aria-expanded={open} aria-haspopup="menu" aria-label={t('account_menu')}>
        <Avatar name={user.name} initials={user.avatar} size={30} />
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-bold text-ink-900">{user.name.split(' ')[0]}</span>
          <span className="block text-[11px] text-ink-500">{t(user.role)}</span>
        </span>
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label={t('close_menu')} onClick={() => setOpen(false)} />
          <div className="animate-rise chrome specular absolute right-0 z-50 mt-2.5 w-64 overflow-hidden">
            <div className="relative border-b edge px-4 py-3">
              <p className="text-sm font-bold text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{user.email}</p>
            </div>
            <div className="relative p-2">
              <Link to={user.role === 'mentor' ? '/m/settings' : '/profile'} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink-700 transition hover:fill-strong">
                <UserIcon size={16} aria-hidden="true" />{t('profile')}</Link>
              {/* Teaching is a thing someone does, not a kind of person they are. A mentor is
                  still learning something, so both halves of the app stay reachable from here
                  rather than one of them replacing the other. */}
              {user.role === 'mentor' && (
                <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink-700 transition hover:fill-strong">
                  <BookOpen size={16} aria-hidden="true" />{t('switch_to_learning')}</Link>
              )}
              {user.role === 'student' && standing.isMentor && (
                <Link to="/m" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink-700 transition hover:fill-strong">
                  <FilePlus2 size={16} aria-hidden="true" />{t('switch_to_teaching')}</Link>
              )}
              <div className="flex items-center justify-between gap-2 px-3 py-2 md:hidden">
                <span className="text-sm font-medium text-ink-700">{t('language')}</span>
                <LocaleToggle compact />
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2 sm:hidden">
                <span className="text-sm font-medium text-ink-700">{t('theme')}</span>
                <ThemeToggle compact />
              </div>
              <button
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50/80"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
              >
                <LogOut size={16} aria-hidden="true" />{t('sign_out')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function XpPill() {
  const { state, user } = useApp()
  const profile = user ? profileOf(state, user.id) : undefined
  if (!profile) return null
  const lv = levelFor(profile.xp)
  return (
    <Link to="/achievements" className="hidden items-center gap-3 fill px-3 py-1.5 ring-1 rim transition hover:fill-raised md:flex" aria-label={t('level_and_xp', { n: lv.level.index, xp: profile.xp })}>
      <span className="grid h-8 w-8 place-items-center bg-gradient-to-b from-amber-400 to-orange-500 text-white shadow-[0_6px_14px_-6px_rgb(249_115_22/0.9)]">
        <Zap size={15} aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-xs font-bold text-ink-900 tabular-nums"><AnimatedNumber value={profile.xp} /> XP</span>
        <span className="block text-[11px] text-ink-500">{localizeLevelName(lv.level.name)}</span>
      </span>
      <span className="w-16">
        <ProgressBar value={lv.percent} size="sm" tone="amber" label={t('level_progress')} />
      </span>
    </Link>
  )
}

function SidebarFooter() {
  const { state, user } = useApp()
  const profile = user ? profileOf(state, user.id) : undefined
  if (user?.role === 'mentor') {
    // Only a real group produces a real next session; otherwise the rail stays quiet.
    const group = state.groups.find((g) => g.mentorId === user.id)
    if (!group) return null
    return (
      <div className="fill p-4 ring-1 rim">
        <p className="flex items-center gap-2 text-xs font-bold text-ink-900">
          <CalendarClock size={14} className="text-brand-500" aria-hidden="true" />{t('next_session')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
          {group.name} · {group.schedule} · {group.room}
        </p>
      </div>
    )
  }
  if (!profile) return null
  const lv = levelFor(profile.xp)
  return (
    <div className="fill p-4 ring-1 rim">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">{localizeLevelName(lv.level.name)}</p>
        <p className="text-xs font-semibold text-brand-600 tabular-nums"><AnimatedNumber value={profile.xp} /> XP</p>
      </div>
      <div className="mt-2.5">
        <ProgressBar value={lv.percent} size="sm" tone="amber" label={t('level_progress')} />
      </div>
      <p className="mt-2 text-[11px] text-ink-500">{lv.next ? t('xp_to_level', { n: lv.xpToNext, level: localizeLevelName(lv.next.name) }) : t('highest_level_reached')}</p>
    </div>
  )
}

export default function Layout() {
  const { user } = useApp()
  const { locale } = useLocale()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const sectionTabs = tabsForPath(location.pathname)
  useEscape(drawer, () => setDrawer(false))
  // The area decides the sidebar, not the role. A mentor browsing the catalogue is on the
  // learner side and should be given the learner's navigation while they are there.
  const nav = location.pathname.startsWith('/m') ? MENTOR_NAV : STUDENT_NAV
  const mobilePrimary = nav.filter((n) => n.primary).slice(0, 4)
  const main = useRef<HTMLElement>(null)
  const lastPath = useRef(location.pathname)

  useEffect(() => {
    setDrawer(false)
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
          keyboard has to walk the whole sidebar and header on every page before reaching
          what changed. Moved off screen rather than hidden, so a screen reader still has it. */}
      <a
        href="#main"
        onClick={skipToMain}
        className="chrome fixed top-4 left-4 z-[70] -translate-y-[calc(100%+2rem)] px-4 py-2.5 text-sm font-semibold text-ink-900 focus:translate-y-0"
      >
        {t('skip_to_content')}
      </a>

      {/* The metal sits under every surface here, heavily veiled: these screens are dense with
          text on glass, and the veil is what keeps their measured contrast. */}
      <LiquidMetalBackground depth="app" />

      {/* floating rail */}
      <aside className="chrome specular fixed top-4 bottom-4 left-4 z-40 hidden w-60 flex-col justify-between px-3.5 py-5 lg:flex">
        <div className="relative">
          <Link to={user?.role === 'mentor' ? '/m' : '/'} className="mb-7 block px-1">
            <Logo />
          </Link>
          <NavList items={nav} />
        </div>
        <div className="relative">
          <SidebarFooter />
        </div>
      </aside>

      <div className="lg:pl-[17.5rem]">
        <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
          <div className="chrome specular mx-auto flex h-16 max-w-7xl items-center gap-2.5 px-3 sm:px-4">
            <button className="grid h-10 w-10 place-items-center fill text-ink-700 ring-1 rim lg:hidden" onClick={() => setDrawer(true)} aria-label={t('open_navigation')}>
              <Menu size={18} aria-hidden="true" />
            </button>
            <Link to={user?.role === 'mentor' ? '/m' : '/'} className="lg:hidden">
              <Mark size={36} className="rounded-full" />
            </Link>
            <span className="relative hidden pl-2 lg:block">
              <Badge tone="brand" icon={Sparkles}>
                {user?.role === 'mentor' ? t('mentor_workspace') : t('student_workspace')}
              </Badge>
            </span>
            <div className="flex-1" />
            {user?.role === 'student' && <XpPill />}
            <span className="hidden md:inline-flex">
              <LocaleToggle compact />
            </span>
            <span className="hidden sm:inline-flex">
              <ThemeToggle compact />
            </span>
            <NotificationBell />
            <UserMenu />
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
          className="mx-auto max-w-7xl px-4 pt-6 pb-32 outline-none sm:px-6 lg:pb-12"
        >
          {/* The section strip sits outside the transition on purpose: it belongs to the
              section rather than to the page, so it should stay put while the page under it
              changes. Animating it would make moving between two tabs look like leaving. */}
          {sectionTabs && <SectionTabs tabs={sectionTabs} />}
          {/* Replaces `.animate-rise` on every page root: the same movement in one place, and
              the outgoing screen can leave rather than vanish. */}
          <PageTransition routeKey={location.pathname}>
            {/* Inside the chrome and inside the transition, so the sidebar and header stay
                put while a screen's code loads, and the screen still makes its one entrance. */}
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </PageTransition>
        </main>
      </div>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink-950/25 backdrop-blur-md" onClick={() => setDrawer(false)} aria-label={t('close_navigation')} />
          <div className="animate-rise chrome specular absolute top-3 bottom-3 left-3 flex w-[16.5rem] flex-col justify-between px-3.5 py-5">
            <div className="relative">
              <div className="mb-7 flex items-center justify-between px-1">
                <Logo />
                <button onClick={() => setDrawer(false)} className="grid h-8 w-8 place-items-center fill text-ink-500 hover:fill-raised hover:text-ink-900" aria-label={t('close_navigation')}>
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <NavList items={nav} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="relative">
              <SidebarFooter />
            </div>
          </div>
        </div>
      )}

      {/* mobile bottom bar */}
      <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:hidden" aria-label={t('primary')}>
        <div className="chrome specular grid grid-cols-5 px-1 py-1">
          {mobilePrimary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-1 py-2 text-[11px] font-semibold transition ${
                  isActive ? 'fill-strong text-brand-600 shadow-[0_1px_2px_rgb(11_18_32/0.1)]' : 'text-ink-500'
                }`
              }
            >
              <item.icon size={19} aria-hidden="true" />
              {t(item.short ?? item.label)}
            </NavLink>
          ))}
          <button className="relative flex flex-col items-center gap-1 py-2 text-[11px] font-semibold text-ink-500" onClick={() => setDrawer(true)}>
            <ChevronRight size={19} aria-hidden="true" />
            {t('more')}
          </button>
        </div>
      </nav>
    </div>
  )
}
