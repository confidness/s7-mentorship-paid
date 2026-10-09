import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, BookOpen, CalendarClock, ChevronDown, FilePlus2, LogOut, Sparkles, User as UserIcon } from 'lucide-react'
import { useApp } from '../lib/store'
import { notificationsFor, profileOf, resolveVars } from '../lib/selectors'
import { levelFor } from '../lib/gamification'
import { Avatar, Badge, ProgressBar, Ring } from './ui'
import LocaleToggle from './LocaleToggle'
import { t, formatDate, useLocale } from '../i18n'
import { AnimatedNumber, useSlidingIndicator } from './motion'
import { localizeLevelName } from '../i18n/content'
import { isNavActive, type NavItem } from './nav'

/**
 * The pieces of the menu bar. Layout.tsx arranges them; this file is what they are.
 *
 * One bar across the top replaces the old sidebar and header pair. Five sections do not need
 * a column of their own, and a column cost every page 280 pixels of width to hold five words.
 */

/** Escape closes it — the one way out a keyboard always has. */
export function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])
}

/**
 * A press anywhere outside closes a popover, and Escape does too.
 *
 * This used to be a transparent full-screen button behind each panel. The bar's glass is a
 * `backdrop-filter`, which traps `position: fixed` descendants inside it, so that button would
 * now only cover the bar — and a listener on the document is simpler than a portal anyway.
 */
function useDismiss(root: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEscape(open, close)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [root, open, close])
}

function usePopover() {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(root, open, close)
  return { root, open, setOpen, close }
}

/* ------------------------------------------------------------------ the rail */

/**
 * The five sections, with a marker that travels to the one you are in.
 *
 * A second, fainter marker follows the pointer, so the bar answers a hover before a click —
 * the same move as the selection, at a quarter of the strength.
 */
export function NavRail({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  const { locale } = useLocale()
  const rail = useRef<HTMLElement>(null)
  const active = items.findIndex((item) => isNavActive(item, pathname))
  const [hover, setHover] = useState(-1)
  const version = `${items.map((i) => i.to).join('|')}:${locale}`
  const pill = useSlidingIndicator(rail, '[data-nav-item]', active, version)
  const ghost = useSlidingIndicator(rail, '[data-nav-item]', hover, version)

  return (
    <nav ref={rail} aria-label={t('main')} className="nav-track relative hidden h-12 shrink-0 items-center gap-0.5 p-1 lg:flex" onMouseLeave={() => setHover(-1)}>
      {ghost.box && hover !== active && (
        <span aria-hidden="true" className={`nav-hover pointer-events-none absolute top-1 bottom-1 left-0 ${ghost.ready ? 'slide' : ''}`} style={{ width: ghost.box.w, transform: `translateX(${ghost.box.x}px)` }} />
      )}
      {pill.box && <span aria-hidden="true" className={`nav-pill pointer-events-none absolute top-1 bottom-1 left-0 ${pill.ready ? 'slide' : ''}`} style={{ width: pill.box.w, transform: `translateX(${pill.box.x}px)` }} />}
      {items.map((item, i) => {
        const on = i === active
        return (
          <Link
            key={item.to}
            to={item.to}
            data-nav-item
            aria-current={on ? (pathname === item.to ? 'page' : 'true') : undefined}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(-1)}
            className={`relative z-10 flex h-10 items-center gap-1.5 rounded-[var(--ui-radius-sm)] px-3 text-sm font-semibold whitespace-nowrap transition-colors ${on ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900'}`}
          >
            <item.icon size={17} className={`transition-colors ${on ? 'text-brand-500' : 'text-ink-400'}`} aria-hidden="true" />
            {t(item.label)}
          </Link>
        )
      })}
    </nav>
  )
}

/* ------------------------------------------------------------------ status */

/** Level and XP, folded into a ring: the number is the level, the arc is the way to the next. */
export function XpChip() {
  const { state, user } = useApp()
  const profile = user ? profileOf(state, user.id) : undefined
  if (!profile) return null
  const lv = levelFor(profile.xp)
  return (
    <Link
      to="/achievements"
      className="tool hidden h-10 items-center gap-2.5 rounded-[var(--ui-radius-sm)] fill py-1 pr-1 pl-1 ring-1 rim transition hover:fill-raised sm:flex xl:pr-3.5"
      aria-label={t('level_and_xp', { n: lv.level.index, xp: profile.xp })}
      title={t('level_and_xp', { n: lv.level.index, xp: profile.xp })}
    >
      <Ring value={lv.percent} size={32} stroke={3.5}>
        <span className="text-[11px] font-bold text-ink-900 tabular-nums">{lv.level.index}</span>
      </Ring>
      <span className="hidden leading-tight xl:block">
        <span className="block text-xs font-bold text-ink-900 tabular-nums">
          <AnimatedNumber value={profile.xp} /> XP
        </span>
        <span className="block text-[11px] text-ink-500">{localizeLevelName(lv.level.name)}</span>
      </span>
    </Link>
  )
}

/**
 * What the old sidebar carried at its foot: the learner's level, or the mentor's next session.
 * It now sits in the account menu and the mobile sheet, one tap from anywhere.
 */
export function LevelCard() {
  const { state, user } = useApp()
  const profile = user ? profileOf(state, user.id) : undefined
  if (user?.role === 'mentor') {
    // Only a real group produces a real next session; otherwise the card stays away.
    const group = state.groups.find((g) => g.mentorId === user.id)
    if (!group) return null
    return (
      <div className="rounded-[var(--ui-radius-sm)] fill p-4 ring-1 rim">
        <p className="flex items-center gap-2 text-xs font-bold text-ink-900">
          <CalendarClock size={14} className="text-brand-500" aria-hidden="true" />
          {t('next_session')}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
          {group.name} · {group.schedule} · {group.room}
        </p>
      </div>
    )
  }
  if (!profile) return null
  const lv = levelFor(profile.xp)
  return (
    <div className="rounded-[var(--ui-radius-sm)] fill p-4 ring-1 rim">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">{localizeLevelName(lv.level.name)}</p>
        <p className="text-xs font-semibold text-brand-600 tabular-nums">
          <AnimatedNumber value={profile.xp} /> XP
        </p>
      </div>
      <div className="mt-2.5">
        <ProgressBar value={lv.percent} size="sm" tone="amber" label={t('level_progress')} />
      </div>
      <p className="mt-2 text-[11px] text-ink-500">{lv.next ? t('xp_to_level', { n: lv.xpToNext, level: localizeLevelName(lv.next.name) }) : t('highest_level_reached')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ popovers */

export function NotificationBell() {
  const { state, user, readNotifications } = useApp()
  const { root, open, setOpen } = usePopover()
  const navigate = useNavigate()
  const items = useMemo(() => (user ? notificationsFor(state, user.id) : []), [state, user])
  const unread = items.filter((n) => !n.read).length

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tool relative grid h-10 w-10 place-items-center rounded-[var(--ui-radius-sm)] fill text-ink-600 ring-1 rim transition hover:fill-raised hover:text-ink-900"
        aria-label={unread ? t('notifications_n_unread', { n: unread }) : t('notifications')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="unread absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger-solid px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </button>

      {open && (
        <div className="animate-rise chrome absolute top-full right-0 z-50 mt-3 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden">
          <div className="flex items-center justify-between border-b edge px-4 py-3">
            <p className="text-sm font-bold text-ink-900">{t('notifications')}</p>
            {unread > 0 && (
              <button className="text-xs font-semibold text-brand-600 hover:text-brand-700" onClick={() => readNotifications()}>
                {t('mark_all_read')}
              </button>
            )}
          </div>
          <ul className="max-h-[22rem] divide-y divider overflow-y-auto">
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
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-ink-300' : 'bg-brand-500'}`} />
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
      )}
    </div>
  )
}

const MENU_ROW = 'flex w-full items-center gap-2.5 rounded-[var(--ui-radius-sm)] px-3 py-2.5 text-sm font-medium transition'

export function UserMenu() {
  const { user, standing, logout } = useApp()
  const navigate = useNavigate()
  const { root, open, setOpen, close } = usePopover()
  if (!user) return null

  return (
    <div ref={root} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="tool flex h-10 items-center gap-1.5 rounded-[var(--ui-radius-sm)] p-1 transition hover:fill sm:pr-2" aria-expanded={open} aria-haspopup="menu" aria-label={t('account_menu')}>
        <Avatar name={user.name} initials={user.avatar} size={32} />
        <ChevronDown size={14} className={`hidden text-ink-500 transition-transform sm:block ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="animate-rise chrome absolute top-full right-0 z-50 mt-3 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden">
          <div className="flex items-center gap-3 border-b edge px-4 py-4">
            <Avatar name={user.name} initials={user.avatar} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{user.email}</p>
              <span className="mt-2 inline-flex">
                <Badge tone="brand" icon={Sparkles}>
                  {user.role === 'mentor' ? t('mentor_workspace') : t('student_workspace')}
                </Badge>
              </span>
            </div>
          </div>

          <div className="space-y-2 p-2">
            <div className="px-1 pt-1 empty:hidden">
              <LevelCard />
            </div>
            <div>
              <Link to={user.role === 'mentor' ? '/m/settings' : '/profile'} onClick={close} className={`${MENU_ROW} text-ink-700 hover:fill-strong`}>
                <UserIcon size={16} aria-hidden="true" />
                {t('profile')}
              </Link>
              {/* Teaching is a thing someone does, not a kind of person they are. A mentor is
                  still learning something, so both halves of the app stay reachable from here. */}
              {user.role === 'mentor' && (
                <Link to="/" onClick={close} className={`${MENU_ROW} text-ink-700 hover:fill-strong`}>
                  <BookOpen size={16} aria-hidden="true" />
                  {t('switch_to_learning')}
                </Link>
              )}
              {user.role === 'student' && standing.isMentor && (
                <Link to="/m" onClick={close} className={`${MENU_ROW} text-ink-700 hover:fill-strong`}>
                  <FilePlus2 size={16} aria-hidden="true" />
                  {t('switch_to_teaching')}
                </Link>
              )}
            </div>
            {/* Language only. Light and dark are the device's setting, and the site keeps no
                copy of it, so there is nothing here to switch. */}
            <div className="border-t edge pt-2">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-sm font-medium text-ink-700">{t('language')}</span>
                <LocaleToggle compact />
              </div>
            </div>
            <div className="border-t edge pt-2">
              <button
                className={`${MENU_ROW} text-rose-600 hover:bg-rose-50/80`}
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                {t('sign_out')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
