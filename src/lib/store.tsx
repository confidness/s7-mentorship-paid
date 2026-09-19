import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppState, Feedback, Project, User, XPTransaction } from './types'
import { createInitialState } from './seed'
import { COURSES, LESSONS, MODULES } from './curriculum'
import { ACHIEVEMENTS } from './gamification'
import * as logic from './logic'
import { applyOps, opsFor, snapshotOps, type ProgressOp } from './progress'
import * as outbox from './outbox'
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

/**
 * Rewrites XP rows banked before assignments had a kind of their own.
 *
 * awardXp refuses a second payment for the same (kind, refId). Renaming the kind without
 * touching history would make every already-paid assignment look unpaid and pay it again on
 * the next submission — the exact double-award the guard exists to prevent. A row is an
 * assignment if its ref is not one of the curriculum lesson ids, which are fixed in code.
 */
function retagAssignments(rows: XPTransaction[], fresh: AppState): XPTransaction[] {
  const curriculum = new Set(fresh.lessons.map((l) => l.id))
  let touched = false
  const out = rows.map((row) => {
    if (row.kind !== 'lesson' || !row.refId || curriculum.has(row.refId)) return row
    touched = true
    return { ...row, kind: 'assignment' as const }
  })
  return touched ? out : rows
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
      xp: retagAssignments(saved.xp ?? fresh.xp, fresh),
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
  /**
   * Projects round-trip through the server, so these can fail and have to be awaited.
   *
   * They used to be written to localStorage, which meant a mentor could only ever see work
   * submitted from the browser they were reviewing in. Claiming a review can also lose a
   * race — another mentor may have taken it a second earlier — and the caller has to be able
   * to say so rather than open an editor over somebody else's review.
   */
  saveProject: (draft: ProjectDraft, status: 'draft' | 'submitted') => Promise<Project>
  startReview: (projectId: string) => Promise<void>
  reviewProject: (projectId: string, decision: 'approved' | 'needs_changes', message: string, rubric?: Feedback['rubric']) => Promise<void>
  toggleLike: (projectId: string) => void
  enroll: (courseId: string) => void
  updateProfile: (patch: { name?: string; bio?: string; city?: string; goal?: string }) => void
  setCurrentCourse: (courseId: string) => void
  codeCheckPassed: (lessonId?: string) => void
  joinTeam: (teamId: string) => void
  setTaskStatus: (taskId: string, status: AppState['competitionTasks'][number]['status'], teamId?: string) => void
  readNotifications: (id?: string) => void
  /**
   * Mentor-authored lessons live in Postgres, not in this browser.
   *
   * They used to be written locally while `api/lesson-content.ts` and the paywall read the
   * database — so a mentor's lesson existed on their laptop and nowhere a student could buy
   * it. These three now write through and return a promise, because a server can refuse:
   * publishing a priced lesson needs an approved application and a payout account, and the
   * caller has to be able to show that refusal instead of a success toast.
   */
  saveCustomLesson: (lesson: CustomLesson) => Promise<void>
  deleteCustomLesson: (lessonId: string) => Promise<void>
  setLessonPublished: (lessonId: string, published: boolean) => Promise<void>
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

/**
 * Turns the server's snapshot back into operations, so the merge goes through the same pure
 * `applyOps` the queue does rather than a second, subtly different copy of the merge rules.
 */
function fromSnapshot(remote: api.ProgressSnapshot): ProgressOp[] {
  const ops: ProgressOp[] = []
  for (const row of remote.lessons) {
    if (row.completedAt) ops.push({ id: `r-l-${row.lessonId}`, t: 'lesson', lessonId: row.lessonId, courseId: row.courseId, at: row.completedAt })
    if (row.challengeCompletedAt) ops.push({ id: `r-c-${row.lessonId}`, t: 'challenge', lessonId: row.lessonId, courseId: row.courseId, at: row.challengeCompletedAt })
    if (row.checkPassedAt) ops.push({ id: `r-k-${row.lessonId}`, t: 'check', lessonId: row.lessonId, courseId: row.courseId, at: row.checkPassedAt })
  }
  for (const row of remote.xp) {
    ops.push({ id: row.id, t: 'xp', amount: row.amount, reason: row.reason, vars: row.vars, kind: row.kind as XPTransaction['kind'], refId: row.refId, at: row.createdAt })
  }
  if (remote.profile) {
    const { xp: _total, ...patch } = remote.profile
    ops.push({ id: 'r-profile', t: 'profile', patch, at: remote.profile.lastActiveDate })
  }
  return ops
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const [standing, setStanding] = useState<Standing>(EMPTY_STANDING)
  const [toasts, setToasts] = useState<Toast[]>([])

  /**
   * Applies a reducer and records what it changed, in one place.
   *
   * Instrumenting each of the twenty-odd mutators separately would be twenty-odd chances to
   * forget one, and the one forgotten is progress that silently never syncs. Diffing the
   * state before and after cannot be forgotten.
   */
  const commit = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      const next = fn(prev)
      // Nothing to queue for when there is no server: a purely local deployment would
      // otherwise fill the outbox with operations that can never be flushed.
      if (backendConfigured && prev.sessionUserId) outbox.push(opsFor(prev, next, prev.sessionUserId))
      return next
    })
  }, [])
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
      const [mentor, catalogue] = await Promise.all([api.getMentorStanding(), api.listCatalogue().catch(() => ({ lessons: [] as api.LessonTeaser[], entitlements: [] as string[] }))])

      /**
       * Bring the catalogue into state, so a lesson written on one device is visible on the
       * next. These are teasers — title, price, whether you own it — and carry no tasks and
       * no material link; those come from `api/lesson-content.ts`, which checks entitlement
       * per request. Merging rather than replacing keeps anything written while offline.
       */
      const teasers = [...(catalogue.lessons ?? []), ...(mentor.status === 'approved' ? await api.listMyLessons().then((r) => r.lessons).catch(() => []) : [])]
      if (teasers.length) {
        setState((prev) => {
          const byId = new Map(prev.customLessons.map((l) => [l.id, l]))
          for (const teaser of teasers) {
            const local = byId.get(teaser.id)
            byId.set(teaser.id, {
              id: teaser.id,
              authorId: teaser.authorId ?? local?.authorId ?? '',
              authorName: teaser.authorName ?? local?.authorName,
              title: teaser.title,
              summary: teaser.summary,
              material: teaser.materialName ? { name: teaser.materialName, mime: local?.material?.mime ?? '', size: local?.material?.size ?? 0 } : local?.material,
              tasks: local?.tasks ?? [],
              published: teaser.published,
              priceCents: teaser.priceCents,
              currency: teaser.currency,
              owned: teaser.owned,
              createdAt: teaser.createdAt,
              updatedAt: teaser.updatedAt,
            })
          }
          return { ...prev, customLessons: [...byId.values()] }
        })
      }
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

  /**
   * Keeps progress with the account rather than with the browser.
   *
   * Three things in order, and the order is the point. Everything banked before any of this
   * existed is queued as ordinary operations — not an import path, just a diff against an
   * empty profile, which is why running it twice or on two divergent devices converges
   * instead of duplicating. Then the queue drains. Only then is the server's copy pulled and
   * merged, so an operation still in flight is not erased by a read that predates it.
   *
   * The flag is keyed by user id, so two accounts on one browser each import once. It is an
   * optimisation and not a correctness requirement: every operation is idempotent, so a
   * second import would converge anyway.
   */
  useEffect(() => {
    const uid = state.sessionUserId
    if (!backendConfigured || !uid) return
    outbox.install(() => uid)
    let alive = true
    void (async () => {
      const flag = `s7.imported.${uid}`
      try {
        if (!localStorage.getItem(flag)) {
          setState((s) => {
            outbox.push(snapshotOps(s, uid))
            return s
          })
          localStorage.setItem(flag, '1')
        }
      } catch {
        /* storage blocked — the queue still works for this session */
      }
      await outbox.flush()

      /**
       * Pull the projects this person may see — their own, the approved gallery, and for a
       * mentor the whole queue. Row level security decides which, so there is no filter here
       * to get wrong.
       *
       * Server wins for anything it knows about. A project exists on the server only because
       * it was accepted there, whereas a local copy may be a draft that never made it, so
       * local-only rows are kept rather than dropped.
       */
      const remoteProjects = await api.listProjects().then((r) => r.projects).catch(() => null)
      if (alive && remoteProjects) {
        setState((s) => {
          const byId = new Map(s.projects.map((p) => [p.id, p]))
          for (const p of remoteProjects) byId.set(p.id, { ...(byId.get(p.id) ?? {}), ...p, feedback: p.feedback } as Project)
          return { ...s, projects: [...byId.values()] }
        })
      }

      const remote = await api.getProgress().catch(() => null)
      if (!alive || !remote) return
      setState((s) => applyOps(s, uid, fromSnapshot(remote)))
    })()
    return () => {
      alive = false
    }
  }, [state.sessionUserId])

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
      completeLesson: (lessonId) => user && commit((s) => logic.completeLesson(s, user.id, lessonId)),
      completeChallenge: (lessonId) => user && commit((s) => logic.completeChallenge(s, user.id, lessonId)),
      // Server first, then state — the same order the lesson mutators use, and for the same
      // reason: a refusal must not arrive underneath a success message.
      async saveProject(draft, status) {
        if (!user) throw new Error('not signed in')
        let id = draft.id
        if (backendConfigured) {
          const saved = await api.saveProject({
            // A locally minted id is not a uuid, so an unsaved project asks for one.
            id: id && !id.startsWith('p-') ? id : undefined,
            title: draft.title,
            description: draft.description,
            code: draft.code,
            notes: draft.notes,
            courseId: draft.courseId,
            lessonId: draft.lessonId,
            attachments: draft.attachments,
            status,
          })
          id = saved.id
        }
        const result = logic.upsertProject(state, user.id, { ...draft, id }, status)
        setState(result.state)
        return result.project
      },
      startReview: async (projectId) => {
        if (!user) return
        if (backendConfigured) await api.claimProject(projectId)
        setState((s) => logic.startReview(s, user.id, projectId))
      },
      reviewProject: async (projectId, decision, message, rubric) => {
        if (!user) return
        if (backendConfigured) await api.decideProject(projectId, decision, message, rubric)
        commit((s) => logic.reviewProject(s, user, projectId, decision, message, rubric))
      },
      toggleLike: (projectId) => setState((s) => logic.toggleLike(s, projectId)),
      enroll: (courseId) => user && commit((s) => logic.enroll(s, user.id, courseId)),
      updateProfile: (patch) => user && setState((s) => logic.updateUser(s, user.id, patch)),
      setCurrentCourse: (courseId) => user && commit((s) => logic.setCurrentCourse(s, user.id, courseId)),
      codeCheckPassed: (lessonId) => user && commit((s) => logic.markCodeCheckPassed(s, user.id, lessonId)),
      joinTeam: (teamId) => user && setState((s) => logic.joinTeam(s, user.id, teamId)),
      setTaskStatus: (taskId, status, teamId) => setState((s) => logic.setTaskStatus(s, taskId, status, teamId)),
      readNotifications: (id) => user && setState((s) => logic.readNotifications(s, user.id, id)),
      // Server first, then state. The other order would leave the interface claiming a lesson
      // was published after the server refused, which is the failure a mentor would act on.
      saveCustomLesson: async (lesson) => {
        if (!backendConfigured) return void setState((s) => logic.saveCustomLesson(s, lesson))
        const { id } = await api.saveLesson({
          // A local id is not a uuid, so an unsaved lesson asks the server to mint one.
          id: lesson.id.startsWith('cl-') ? undefined : lesson.id,
          title: lesson.title,
          summary: lesson.summary,
          priceCents: lesson.priceCents,
          currency: lesson.currency,
          materialPath: lesson.material?.path ?? null,
          materialName: lesson.material?.name ?? null,
          materialMime: lesson.material?.mime ?? null,
          materialSize: lesson.material?.size ?? null,
          tasks: lesson.tasks,
        })
        setState((s) => logic.saveCustomLesson(s, { ...lesson, id }))
      },
      deleteCustomLesson: async (lessonId) => {
        if (backendConfigured) await api.deleteLesson(lessonId)
        setState((s) => logic.deleteCustomLesson(s, lessonId))
      },
      setLessonPublished: async (lessonId, published) => {
        if (backendConfigured) await api.publishLesson(lessonId, published)
        setState((s) => logic.setLessonPublished(s, lessonId, published))
      },
      submitLessonAnswers: (lessonId, answers) => user && commit((s) => logic.submitLessonAnswers(s, user.id, lessonId, answers)),
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
