import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Settings, Sparkles } from 'lucide-react'
import { useApp } from '../lib/store'
import { Avatar, Badge } from './ui'
import ThemeToggle from './ThemeToggle'
import LocaleToggle from './LocaleToggle'
import { t, useLocale } from '../i18n'
import { useSlidingIndicator } from './motion'
import { isNavActive, type NavItem } from './nav'

/**
 * The pieces of the menu bar. Layout.tsx arranges them; this file is what they are.
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
 * A press anywhere outside closes a popover, and Escape does too. A document listener rather
 * than a full-screen button behind the panel: the bar's glass is a `backdrop-filter`, which
 * traps `position: fixed` descendants inside it.
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
 * The sections, with a marker that travels to the one you are in, and a fainter one that
 * follows the pointer — the bar answers a hover before a click.
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

/* ------------------------------------------------------------------ the account menu */

const MENU_ROW = 'flex w-full items-center gap-2.5 rounded-[var(--ui-radius-sm)] px-3 py-2.5 text-sm font-medium transition'

export function UserMenu() {
  const { user, logout } = useApp()
  const navigate = useNavigate()
  const { root, open, setOpen, close } = usePopover()
  if (!user) return null

  return (
    <div ref={root} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="tool flex h-10 items-center gap-1.5 rounded-[var(--ui-radius-sm)] p-1 transition hover:fill sm:pr-2" aria-expanded={open} aria-haspopup="menu" aria-label={t('account_menu')}>
        <Avatar name={user.name} initials={user.avatar || undefined} size={32} />
        <ChevronDown size={14} className={`hidden text-ink-500 transition-transform sm:block ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="animate-rise chrome absolute top-full right-0 z-50 mt-3 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden">
          <div className="flex items-center gap-3 border-b edge px-4 py-4">
            <Avatar name={user.name} initials={user.avatar || undefined} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{user.email}</p>
              <span className="mt-2 inline-flex">
                <Badge tone="brand" icon={Sparkles}>
                  {t(`role_${user.role}`)}
                </Badge>
              </span>
            </div>
          </div>

          <div className="space-y-2 p-2">
            <Link to="/settings" onClick={close} className={`${MENU_ROW} text-ink-700 hover:fill-strong`}>
              <Settings size={16} aria-hidden="true" />
              {t('nav_settings')}
            </Link>
            {/* Renders nothing while the interface has one language; the row hides with it. */}
            <div className="border-t edge px-3 pt-2 empty:hidden">
              <LocaleToggle compact />
            </div>
            {/* The bar carries the theme switch from xl up; below that it lives here. */}
            <div className="flex items-center justify-between gap-2 border-t edge px-3 pt-3 pb-1.5 xl:hidden">
              <span className="text-sm font-medium text-ink-700">{t('theme')}</span>
              <ThemeToggle compact />
            </div>
            <div className="border-t edge pt-2">
              <button
                className={`${MENU_ROW} text-rose-600 hover:bg-rose-50/80`}
                onClick={() => {
                  void logout().then(() => navigate('/login'))
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
