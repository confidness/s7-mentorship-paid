import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Role } from './bazaar'
import type { Me } from './types'
import { backendConfigured, supabase } from './supabase'
import * as api from './api'
import { t as translate } from '../i18n'

/**
 * Who is signed in, and the toasts. Nothing else.
 *
 * The codebase this grew out of kept a whole learning platform in one localStorage blob and
 * mirrored it to the server. Brandyzer has nothing worth keeping in a browser: every kit,
 * service and contract is a row somebody else may need to read, so each page reads what it
 * needs from the database, and this provider holds only the session those reads run as.
 */

export interface Toast {
  id: string
  title: string
  body?: string
  tone: 'success' | 'info' | 'error'
}

interface Ctx {
  /** False until the stored session has been checked, so a reload does not flash the sign-in page. */
  ready: boolean
  user: Me | null
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  /** `notice` is not a failure: the account exists and is waiting on the emailed link. */
  register: (input: { name: string; email: string; password: string; role: Role }) => Promise<{ ok: boolean; error?: string; notice?: string }>
  logout: () => Promise<void>
  /** Re-read the profile after a change made elsewhere — a role switch, a payout account. */
  refreshMe: () => Promise<void>
}

const AppCtx = createContext<Ctx | null>(null)
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
export const useToast = () => useContext(ToastCtx)

let toastSeq = 0

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!backendConfigured)
  const [user, setUser] = useState<Me | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const refreshMe = useCallback(async () => {
    try {
      setUser(await api.getMe())
    } catch {
      // Unreadable is signed out, for the interface's purposes. Every request would fail anyway.
      setUser(null)
    }
  }, [])

  /**
   * Follows Supabase's own idea of the session — on load, on sign-in elsewhere, on a refresh
   * token running out. The profile read is deferred out of the callback: supabase-js holds a
   * lock while it runs, and a query made inside it waits on that same lock forever.
   */
  useEffect(() => {
    if (!backendConfigured) return
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        void (session ? refreshMe() : Promise.resolve(setUser(null))).finally(() => setReady(true))
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [refreshMe])

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const entry = { ...toast, id: `t${++toastSeq}` }
    setToasts((all) => [...all, entry])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== entry.id)), 4200)
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      ready,
      user,
      refreshMe,

      async login(email, password) {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
        if (error) return { ok: false, error: translate('incorrect_email_or_password') }
        await refreshMe()
        return { ok: true }
      },

      /**
       * The role asked for at signup is honoured — the trigger in the schema reads it — because
       * here a role is a choice of tools, not a permission. Selling still waits on Stripe.
       */
      async register(input) {
        const { data, error } = await supabase().auth.signUp({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          // The confirmation link returns to the site the person signed up on — localhost, a
          // preview or production — provided Supabase lists that origin among its redirect URLs.
          options: { data: { name: input.name.trim(), role: input.role }, emailRedirectTo: window.location.origin },
        })
        if (error || !data.user) return { ok: false, error: error?.message ?? translate('something_went_wrong_try_again') }
        // With email confirmation on, signUp succeeds and hands back no session. Carrying on
        // would mark the person signed in while every request answers 401.
        if (!data.session) return { ok: false, notice: translate('confirm_email_then_sign_in') }
        await refreshMe()
        return { ok: true }
      },

      async logout() {
        await supabase().auth.signOut()
        setUser(null)
      },
    }),
    [ready, user, refreshMe],
  )

  return (
    <AppCtx.Provider value={value}>
      <ToastCtx.Provider value={pushToast}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} />
      </ToastCtx.Provider>
    </AppCtx.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const tone = {
    success: 'ring-emerald-200/70',
    info: 'ring-brand-200/70',
    error: 'ring-rose-200/70',
  }
  const dot = { success: 'bg-emerald-500', info: 'bg-brand-600', error: 'bg-rose-500' }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:top-24 sm:right-6 sm:items-end" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`animate-toast chrome specular pointer-events-auto flex w-full max-w-sm items-start gap-3 p-4 ring-1 ${tone[t.tone]}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 ${dot[t.tone]}`} />
          <div className="relative min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{t.title}</p>
            {t.body && <p className="mt-0.5 text-sm text-ink-600">{t.body}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="relative grid h-6 w-6 shrink-0 place-items-center text-ink-400 transition hover:bg-white/80 hover:text-ink-700" aria-label={translate('dismiss_notification')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
