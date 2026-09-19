import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppState, Feedback, Project, User } from './types'
import { createInitialState } from './seed'
import { COURSES, LESSONS, MODULES } from './curriculum'
import { ACHIEVEMENTS } from './gamification'
import * as logic from './logic'
import type { ProjectDraft } from './logic'
import type { Competition, CompetitionTask, CustomLesson, Group, TaskAnswer, Team } from './types'
import { profileOf } from './selectors'
import type { Standing } from './types'
import { backendConfigured, supabase } from './supabase'
import * as api from './api'
import { t as translate, useLocale } from '../i18n'
import { localizeAchievement, localizeCourse, localizeLesson, localizeModule } from '../i18n/content'

const STORAGE_KEY = 's7-robotics-platform.v1'

/**
 * Clears state left by a build that stored passwords in the browser.
 *
 * Returning users have a User[] in localStorage with a cleartext `password` on every row.
 * Auth has moved to the server and nothing reads that field any more, but leaving it sitting
 * in the browser is a credential we chose not to delete. Anyone affected signs in again.
 */
function dropLegacyCredentials(saved: Partial<AppState>): boolean {
  const users = saved.users as Array<Record<string, unknown>> | undefined
  return Array.isArray(users) && users.some((u) => typeof u?.password === 'string')
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialState()
    const saved = JSON.parse(raw) as Partial<AppState>
    if (dropLegacyCredentials(saved)) {
      localStorage.removeItem(STORAGE_KEY)
      return createInitialState()
    }
    // Content (courses/lessons/achievements) always comes from code, never from storage,
    // so editing the curriculum never strands a returning user on stale data.
    const fresh = createInitialState()
    return {
      ...fresh,
      users: saved.users ?? fresh.users,
      profiles: saved.profiles ?? fresh.profiles,
      projects: saved.projects ?? fresh.projects,
      xp: saved.xp ?? fresh.xp,
      groups: saved.groups ?? fresh.groups,
      teams: saved.teams ?? fresh.teams,
      // Events are announced from inside the app, so they are user data like everything above.
      competitions: saved.competitions ?? fresh.competitions,
      competitionTasks: saved.competitionTasks ?? fresh.competitionTasks,
      notifications: saved.notifications ?? fresh.notifications,
      // Mentor-written lessons ARE user data, unlike the curriculum above, so they come back.
      customLessons: saved.customLessons ?? fresh.customLessons,
      lessonSubmissions: saved.lessonSubmissions ?? fresh.lessonSubmissions,
      sessionUserId: saved.sessionUserId ?? null,
    }
  } catch {
    return createInitialState()
  }
}

export interface Toast {
  id: string
  title: string
  body?: string
  tone: 'success' | 'info' | 'error'
}

interface Ctx {
  state: AppState
  user: User | null
  profile: ReturnType<typeof profileOf>
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; user?: User }>
  register: (input: { name: string; email: string; password: string; role: User['role'] }) => Promise<{ ok: boolean; error?: string; user?: User }>
  logout: () => void
  /** What the server says this person may do. Re-read after sign-in and after a purchase. */
  standing: Standing
  refreshStanding: () => Promise<void>
  completeLesson: (lessonId: string) => void
  completeChallenge: (lessonId: string) => void
  saveProject: (draft: ProjectDraft, status: 'draft' | 'submitted') => Project
  startReview: (projectId: string) => void
  reviewProject: (projectId: string, decision: 'approved' | 'needs_changes', message: string, rubric?: Feedback['rubric']) => void
  toggleLike: (projectId: string) => void
  enroll: (courseId: string) => void
  updateProfile: (patch: { name?: string; bio?: string; city?: string; goal?: string }) => void
  setCurrentCourse: (courseId: string) => void
  codeCheckPassed: (lessonId?: string) => void
  joinTeam: (teamId: string) => void
  setTaskStatus: (taskId: string, status: AppState['competitionTasks'][number]['status'], teamId?: string) => void
  readNotifications: (id?: string) => void
  saveCustomLesson: (lesson: CustomLesson) => void
  deleteCustomLesson: (lessonId: string) => void
  setLessonPublished: (lessonId: string, published: boolean) => void
  submitLessonAnswers: (lessonId: string, answers: TaskAnswer[]) => void
  reviewLessonSubmission: (submissionId: string, feedback: string, awardedXp: number) => void
  saveCompetition: (competition: Competition) => void
  deleteCompetition: (competitionId: string) => void
  announceCompetition: (competitionId: string) => void
  saveCompetitionTask: (task: CompetitionTask) => void
  deleteCompetitionTask: (taskId: string) => void
  saveGroup: (group: Group) => void
  deleteGroup: (groupId: string) => void
  saveTeam: (team: Team) => void
  deleteTeam: (teamId: string) => void
  resetDemo: () => void
}

/** Nothing granted. What a signed-out viewer has, and the safe default on any failure. */
const EMPTY_STANDING: Standing = { mentorStatus: 'none', chargesEnabled: false, payoutsEnabled: false, isAdmin: false, entitlements: [] }

const AppCtx = createContext<Ctx | null>(null)
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
export const useToast = () => useContext(ToastCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const [standing, setStanding] = useState<Standing>(EMPTY_STANDING)
  const [toasts, setToasts] = useState<Toast[]>([])
  const { locale } = useLocale()

  /**
   * Re-reads what the server permits.
   *
   * Failure resets to EMPTY_STANDING rather than keeping the last good answer: if we cannot
   * confirm someone is approved, the honest state is "not approved". Erring the other way
   * would let a network blip leave authoring tools on screen.
   */
  const refreshStanding = useCallback(async () => {
    if (!backendConfigured) return setStanding(EMPTY_STANDING)
    try {
      const [mentor, catalogue] = await Promise.all([api.getMentorStanding(), api.listCatalogue().catch(() => ({ entitlements: [] as string[] }))])
      setStanding({
        mentorStatus: mentor.status,
        chargesEnabled: mentor.chargesEnabled,
        payoutsEnabled: mentor.payoutsEnabled,
        // Admin is whatever the admin route is willing to answer; it is never inferred here.
        isAdmin: await api
          .listApplications('pending')
          .then(() => true)
          .catch(() => false),
        entitlements: catalogue.entitlements ?? [],
      })

      /**
       * Approval has to take effect without signing out.
       *
       * An admin approves someone while they are sitting on the page. Without this, the
       * mentor keeps student navigation until they happen to sign out and back in, which
       * reads as "the approval did nothing". The server has already changed profiles.role;
       * this only catches the local mirror up.
       *
       * It promotes and demotes: a revoked approval must take the tools away just as
       * readily as granting one hands them over.
       */
      const shouldBeMentor = mentor.status === 'approved'
      setState((current) => {
        const me = current.users.find((u) => u.id === current.sessionUserId)
        if (!me) return current
        const role: User['role'] = shouldBeMentor ? 'mentor' : 'student'
        if (me.role === role) return current
        return { ...current, users: current.users.map((u) => (u.id === me.id ? { ...u, role, title: shouldBeMentor ? 'mentor' : undefined } : u)) }
      })
    } catch {
      setStanding(EMPTY_STANDING)
    }
  }, [])

  // Курс мазмұны кодтан оқылады, сондықтан тіл ауысқанда оны қайта аудару жеткілікті.
  // Content is never persisted, so switching language simply re-derives it. Each pass starts
  // from the English canonical rather than from the current state — English has no pack, so
  // re-translating an already-translated copy would leave the previous language in place.
  useEffect(() => {
    setState((s) => ({
      ...s,
      courses: COURSES.map(localizeCourse),
      modules: MODULES.map(localizeModule),
      lessons: LESSONS.map(localizeLesson),
      achievements: ACHIEVEMENTS.map(localizeAchievement),
    }))
  }, [locale])

  useEffect(() => {
    try {
      const { users, profiles, projects, xp, groups, teams, competitions, competitionTasks, notifications, customLessons, lessonSubmissions, sessionUserId } = state
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ users, profiles, projects, xp, groups, teams, competitions, competitionTasks, notifications, customLessons, lessonSubmissions, sessionUserId }))
    } catch {
      /* storage full or blocked — the app keeps working in memory */
    }
  }, [state])

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const toast = { ...t, id: logic.uid('t') }
    setToasts((all) => [...all, toast])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== toast.id)), 4200)
  }, [])

  const user = useMemo(() => state.users.find((u) => u.id === state.sessionUserId) ?? null, [state.users, state.sessionUserId])

  // Standing belongs to whoever is signed in, so it is re-read when that changes and
  // cleared when nobody is.
  useEffect(() => {
    if (!state.sessionUserId) return setStanding(EMPTY_STANDING)
    void refreshStanding()
  }, [state.sessionUserId, refreshStanding])
  const profile = useMemo(() => (user ? profileOf(state, user.id) : undefined), [state, user])

  const value = useMemo<Ctx>(() => {
    return {
      state,
      user,
      profile,
      /**
       * Signs in against Supabase Auth.
       *
       * Without a configured backend this falls back to matching a local user by email —
       * a prototype run with no server, the same shape the AI mentor degrades to. That path
       * checks no password because there is no longer one stored to check: credentials live
       * in Auth now, so an unconfigured checkout is a local demo, not a security boundary.
       */
      async login(email, password) {
        const address = email.trim().toLowerCase()

        if (!backendConfigured) {
          const found = state.users.find((u) => u.email.toLowerCase() === address)
          if (!found) return { ok: false, error: translate('no_account_found_with_that_email') }
          setState((s) => logic.touchStreak({ ...s, sessionUserId: found.id }, found.id))
          return { ok: true, user: found }
        }

        const { data, error } = await supabase().auth.signInWithPassword({ email: address, password })
        if (error || !data.user) return { ok: false, error: translate('incorrect_password_try_again') }

        /**
         * The role comes from the profiles row, not from user_metadata.
         *
         * user_metadata is written once at signup and never again, so an approved mentor
         * would sign in and still land in the student view — the approval would look like
         * it had done nothing. profiles.role is what the admin route actually updates, so
         * it is the only copy worth reading.
         */
        const { data: profileRow } = await supabase().from('profiles').select('name, role, avatar, bio, city, title').eq('id', data.user.id).maybeSingle()
        const role: User['role'] = profileRow?.role === 'mentor' ? 'mentor' : 'student'
        const name = profileRow?.name ?? address.split('@')[0]

        // Mirror the account locally so the rest of the app — progress, XP, streaks — keeps
        // working against state it already understands. The server's role wins over whatever
        // the local copy last remembered.
        const known = state.users.find((u) => u.id === data.user.id || u.email.toLowerCase() === address)
        if (known) {
          const refreshed = { ...known, id: data.user.id, role, name }
          setState((s) =>
            logic.touchStreak(
              { ...s, users: s.users.map((u) => (u.id === known.id ? refreshed : u)), sessionUserId: data.user.id },
              data.user.id,
            ),
          )
          return { ok: true, user: refreshed }
        }

        const created = logic.registerUser(state, { name, email: address, role })
        if (!created.user) return { ok: false, error: created.error }
        const mirrored = { ...created.user, id: data.user.id, role }
        setState({ ...created.state, users: created.state.users.map((u) => (u.id === created.user!.id ? mirrored : u)), sessionUserId: data.user.id })
        return { ok: true, user: mirrored }
      },

      async register(input) {
        if (!backendConfigured) {
          const result = logic.registerUser(state, input)
          if (result.error || !result.user) return { ok: false, error: result.error }
          setState({ ...result.state, sessionUserId: result.user.id })
          return { ok: true, user: result.user }
        }

        const { data, error } = await supabase().auth.signUp({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          options: { data: { name: input.name.trim(), role: 'student' } },
        })
        if (error || !data.user) return { ok: false, error: error?.message ?? translate('something_went_wrong_try_again') }

        // Everyone starts as a student regardless of what was asked for; teaching is applied
        // for and reviewed. The role in input is not honoured here on purpose.
        const result = logic.registerUser(state, { ...input, role: 'student' })
        if (!result.user) return { ok: false, error: result.error }
        const mirrored = { ...result.user, id: data.user.id }
        setState({ ...result.state, users: result.state.users.map((u) => (u.id === result.user!.id ? mirrored : u)), sessionUserId: data.user.id })
        return { ok: true, user: mirrored }
      },

      logout: () => {
        if (backendConfigured) void supabase().auth.signOut()
        setStanding(EMPTY_STANDING)
        setState((s) => ({ ...s, sessionUserId: null }))
      },
      standing,
      refreshStanding,
      completeLesson: (lessonId) => user && setState((s) => logic.completeLesson(s, user.id, lessonId)),
      completeChallenge: (lessonId) => user && setState((s) => logic.completeChallenge(s, user.id, lessonId)),
      saveProject(draft, status) {
        if (!user) throw new Error('not signed in')
        const result = logic.upsertProject(state, user.id, draft, status)
        setState(result.state)
        return result.project
      },
      startReview: (projectId) => user && setState((s) => logic.startReview(s, user.id, projectId)),
      reviewProject: (projectId, decision, message, rubric) => user && setState((s) => logic.reviewProject(s, user, projectId, decision, message, rubric)),
      toggleLike: (projectId) => setState((s) => logic.toggleLike(s, projectId)),
      enroll: (courseId) => user && setState((s) => logic.enroll(s, user.id, courseId)),
      updateProfile: (patch) => user && setState((s) => logic.updateUser(s, user.id, patch)),
      setCurrentCourse: (courseId) => user && setState((s) => logic.setCurrentCourse(s, user.id, courseId)),
      codeCheckPassed: (lessonId) => user && setState((s) => logic.markCodeCheckPassed(s, user.id, lessonId)),
      joinTeam: (teamId) => user && setState((s) => logic.joinTeam(s, user.id, teamId)),
      setTaskStatus: (taskId, status, teamId) => setState((s) => logic.setTaskStatus(s, taskId, status, teamId)),
      readNotifications: (id) => user && setState((s) => logic.readNotifications(s, user.id, id)),
      saveCustomLesson: (lesson) => setState((s) => logic.saveCustomLesson(s, lesson)),
      deleteCustomLesson: (lessonId) => setState((s) => logic.deleteCustomLesson(s, lessonId)),
      setLessonPublished: (lessonId, published) => setState((s) => logic.setLessonPublished(s, lessonId, published)),
      submitLessonAnswers: (lessonId, answers) => user && setState((s) => logic.submitLessonAnswers(s, user.id, lessonId, answers)),
      reviewLessonSubmission: (submissionId, feedback, awardedXp) =>
        user && setState((s) => logic.reviewLessonSubmission(s, submissionId, user.id, feedback, awardedXp)),
      saveCompetition: (competition) => setState((s) => logic.saveCompetition(s, competition)),
      deleteCompetition: (competitionId) => setState((s) => logic.deleteCompetition(s, competitionId)),
      announceCompetition: (competitionId) => setState((s) => logic.announceCompetition(s, competitionId)),
      saveCompetitionTask: (task) => setState((s) => logic.saveCompetitionTask(s, task)),
      deleteCompetitionTask: (taskId) => setState((s) => logic.deleteCompetitionTask(s, taskId)),
      saveGroup: (group) => setState((s) => logic.saveGroup(s, group)),
      deleteGroup: (groupId) => setState((s) => logic.deleteGroup(s, groupId)),
      saveTeam: (team) => setState((s) => logic.saveTeam(s, team)),
      deleteTeam: (teamId) => setState((s) => logic.deleteTeam(s, teamId)),
      resetDemo() {
        localStorage.removeItem(STORAGE_KEY)
        setState(createInitialState())
      },
    }
  }, [state, user, profile, standing, refreshStanding])

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
        <div key={t.id} className={`animate-toast chrome specular pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[20px] p-4 ring-1 ${tone[t.tone]}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[t.tone]}`} />
          <div className="relative min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{t.title}</p>
            {t.body && <p className="mt-0.5 text-sm text-ink-600">{t.body}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-white/80 hover:text-ink-700" aria-label={translate('dismiss_notification')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
