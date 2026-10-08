/**
 * Typed wrappers over the server routes.
 *
 * Every call carries the caller's access token, and every one of them is re-authorised on
 * the server. Nothing here is a permission check — this file only asks questions and
 * relays answers. If a function in here appears to decide something, the decision is
 * really the server's and this is the cached copy.
 */

import type { CustomLesson, CustomTask, LessonStats, LessonSubmission, Notification, TaskAnswer } from './types'
import { accessToken, backendConfigured, supabase } from './supabase'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!backendConfigured) throw new ApiError(501, 'not_configured', 'The server is not configured.')

  const token = await accessToken()
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.body) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(path, { ...init, headers })
  const text = await res.text()

  /**
   * A reply that is not JSON is not a reply from this API.
   *
   * `JSON.parse` on an HTML error page throws a SyntaxError from inside the data layer,
   * which surfaces as "Unexpected token '<'" somewhere in the interface — a message that
   * describes the parser rather than the problem. The common causes are a platform error
   * page, a proxy, and the one that bit here: a static preview server, where `/api/*` is
   * simply not running and every route 404s with two words of plain text.
   */
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new ApiError(res.status === 200 ? 502 : res.status, 'api_unavailable', text.slice(0, 200))
    }
  }

  // 404 on our own path means the function is not deployed, not that a record is missing —
  // routes here answer 404 with a JSON body and a code of their own.
  if (res.status === 404 && !body.error) throw new ApiError(404, 'api_unavailable', res.statusText)

  if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'error'), String(body.message ?? body.error ?? res.statusText))
  return body as T
}

/* ---------------------------------------------------------------- mentors */

export interface StandingResponse {
  role: 'student' | 'mentor'
  isAdmin: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

/**
 * What this account may do, read straight from Postgres.
 *
 * This was a serverless function that did exactly these two selects as the caller. Both
 * tables are readable by their owner under RLS — `profiles_read` and `accounts_read_own` —
 * so the function was a round trip that added nothing but a dependency on being deployed.
 *
 * Removing it buys two things. Standing now works wherever the app runs, including a static
 * preview with no functions at all, which is where the teaching switch was failing. And it
 * frees one of the twelve serverless functions a Vercel Hobby project is allowed, which the
 * demand board needed.
 */
export async function getMentorStanding(): Promise<StandingResponse> {
  if (!backendConfigured) throw new ApiError(501, 'not_configured', 'The server is not configured.')

  const { data: auth } = await supabase().auth.getUser()
  if (!auth.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')

  const [{ data: profile }, { data: account }] = await Promise.all([
    supabase().from('profiles').select('role, is_admin').eq('id', auth.user.id).maybeSingle(),
    supabase().from('mentor_accounts').select('charges_enabled, payouts_enabled').eq('user_id', auth.user.id).maybeSingle(),
  ])

  return {
    role: profile?.role === 'mentor' ? 'mentor' : 'student',
    isAdmin: Boolean(profile?.is_admin),
    chargesEnabled: Boolean(account?.charges_enabled),
    payoutsEnabled: Boolean(account?.payouts_enabled),
  }
}

/**
 * Start teaching, or stop.
 *
 * Written straight to `profiles` rather than through a route, because there is nothing for a
 * route to add: policy `profiles_update_self` from 0006 already permits exactly this change
 * and still refuses `is_admin`, so the boundary is the database either way. Going direct
 * also means the switch works without the serverless functions running — which is the
 * difference between the preview build being a demo and being a dead button.
 */
export async function setTeaching(teaching: boolean): Promise<'student' | 'mentor'> {
  if (!backendConfigured) throw new ApiError(501, 'not_configured', 'The server is not configured.')
  const role = teaching ? 'mentor' : 'student'

  const { data } = await supabase().auth.getUser()
  if (!data.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')

  const { error } = await supabase().from('profiles').update({ role }).eq('id', data.user.id)
  // A policy refusal arrives as 42501. It means migration 0006 has not been applied — the
  // old policy pinned `role` to its current value — and that is worth saying out loud
  // rather than reporting as a generic failure.
  if (error) throw new ApiError(error.code === '42501' ? 403 : 500, error.code === '42501' ? 'role_change_refused' : 'write_failed', error.message)
  return role
}

/* ---------------------------------------------------------------- payouts */

export const startOnboarding = () => call<{ url: string }>('/api/connect/onboard', { method: 'POST' })

export const payoutStatus = () =>
  call<{ connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean; requirements?: string[] }>('/api/connect/status')

/* ---------------------------------------------------------------- lessons */

export interface LessonTeaser {
  id: string
  title: string
  summary: string
  priceCents: number
  currency: string
  published: boolean
  materialName: string | null
  authorId?: string
  authorName?: string
  owned?: boolean
  stats?: LessonStats
  createdAt: string
  updatedAt: string
}

export const listCatalogue = () => call<{ lessons: LessonTeaser[]; entitlements: string[] }>('/api/lessons')
export const listMyLessons = () => call<{ lessons: LessonTeaser[] }>('/api/lessons?mine=1')

export interface LessonDraft {
  id?: string
  title: string
  summary: string
  priceCents: number
  currency: string
  materialPath?: string | null
  materialName?: string | null
  materialMime?: string | null
  materialSize?: number | null
  tasks: CustomTask[]
}

export const saveLesson = (draft: LessonDraft) => call<{ ok: true; id: string }>('/api/lessons', { method: 'POST', body: JSON.stringify(draft) })

export const publishLesson = (id: string, published: boolean) =>
  call<{ ok: true; published: boolean }>('/api/lessons', { method: 'PATCH', body: JSON.stringify({ id, published }) })

export const deleteLesson = (id: string) => call<{ ok: true; withdrawn?: boolean; deleted?: boolean }>(`/api/lessons?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

/* ------------------------------------------------------------- purchasing */

/**
 * The lesson's real contents.
 *
 * A 402 is not an error to swallow — it is the paywall answering, and the caller should
 * show the buy page. Anything else is a genuine failure.
 */
export interface LessonContent {
  entitled: boolean
  lesson: Pick<CustomLesson, 'id' | 'title' | 'summary'> & { priceCents: number; currency: string; authorId?: string }
  tasks: CustomTask[]
  material: { name: string; mime: string; size: number; url: string } | null
}

export async function getLessonContent(lessonId: string): Promise<LessonContent | { paywalled: true; lesson: LessonContent['lesson'] }> {
  try {
    return await call<LessonContent>(`/api/lesson-content?lessonId=${encodeURIComponent(lessonId)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 402) {
      const res = await fetch(`/api/lesson-content?lessonId=${encodeURIComponent(lessonId)}`, {
        headers: { authorization: `Bearer ${(await accessToken()) ?? ''}` },
      })
      const body = (await res.json()) as { lesson: LessonContent['lesson'] }
      return { paywalled: true, lesson: body.lesson }
    }
    throw error
  }
}

/** Returns the Stripe Checkout URL to send the buyer to. The purchase completes over there. */
export const startCheckout = (lessonId: string) => call<{ url: string; sessionId: string }>('/api/checkout', { method: 'POST', body: JSON.stringify({ lessonId }) })

/* -------------------------------------------------------------- progress */

export interface ProgressSnapshot {
  profile: { xp: number; streak: number; lastActiveDate: string; currentCourseId: string; enrolledCourseIds: string[]; goal: string } | null
  lessons: { lessonId: string; courseId: string; checkPassedAt: string | null; completedAt: string | null; challengeCompletedAt: string | null }[]
  xp: { id: string; amount: number; reason: string; vars?: Record<string, string | number>; kind: string; refId?: string; createdAt: string }[]
}

export const getProgress = () => call<ProgressSnapshot>('/api/progress')

export const pushProgress = (ops: unknown[]) => call<{ ok: true; applied: number }>('/api/progress', { method: 'POST', body: JSON.stringify({ ops }) })

/* -------------------------------------------------------------- projects */

export interface RemoteProject {
  id: string
  authorId: string
  title: string
  description: string
  code: string
  notes: string
  courseId: string
  lessonId: string
  attachments: { id: string; kind: 'image' | 'video'; name: string; url: string; size?: number }[]
  tags: string[]
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'needs_changes'
  createdAt: string
  submittedAt?: string
  reviewedAt?: string
  reviewerId?: string
  likes: number
  views: number
  feedback: { id: string; projectId: string; mentorId: string; decision: 'approved' | 'needs_changes' | 'comment'; message: string; rubric?: { completeness: number; clarity: number; craft: number }; createdAt: string }[]
}

export const listProjects = () => call<{ projects: RemoteProject[] }>('/api/projects')

export interface ProjectSave {
  id?: string
  title: string
  description?: string
  code?: string
  notes?: string
  courseId?: string
  lessonId?: string
  attachments?: unknown[]
  tags?: string[]
  status?: 'draft' | 'submitted'
}

export const saveProject = (draft: ProjectSave) => call<{ ok: true; id: string }>('/api/projects', { method: 'POST', body: JSON.stringify(draft) })

/** Claiming is what stops two mentors writing the same review; the second gets a 409. */
export const claimProject = (id: string) => call<{ ok: true; id: string }>('/api/projects', { method: 'PATCH', body: JSON.stringify({ id, action: 'claim' }) })

export const decideProject = (id: string, decision: 'approved' | 'needs_changes', message: string, rubric?: { completeness: number; clarity: number; craft: number }) =>
  call<{ ok: true; id: string }>('/api/projects', { method: 'PATCH', body: JSON.stringify({ id, action: 'decide', decision, message, rubric }) })

/* ------------------------------------------------------- lesson hand-ins */

/**
 * Answers to a mentor-written lesson, and the author's verdict on them.
 *
 * They live under `/api/lesson-content` because that route holds the answer key they are marked
 * against, and because the deployment has no room for another function. See its header.
 */
export const listSubmissions = () => call<{ submissions: LessonSubmission[] }>('/api/lesson-content?submissions=1')

/**
 * Hands answers in. No score travels with them — the server marks them against the key and
 * answers with the row as it now stands, which is what the caller should show.
 */
export const handInLesson = (lessonId: string, answers: TaskAnswer[]) =>
  call<{ ok: true; submission: LessonSubmission }>('/api/lesson-content', { method: 'POST', body: JSON.stringify({ lessonId, answers }) })

/** The author's decision. The XP figure is held to the lesson's points on the server. */
export const reviewSubmission = (id: string, decision: 'approved' | 'needs_changes', feedback: string, awardedXp: number) =>
  call<{ ok: true; submission: LessonSubmission }>('/api/lesson-content', { method: 'PATCH', body: JSON.stringify({ id, decision, feedback, awardedXp }) })

/* --------------------------------------------------------- notifications */

/**
 * Only the ones that crossed from another account.
 *
 * A notification about your own action was written by the reducer that performed it, in this
 * browser, and is already in local state. What the server holds is the rest: the review
 * decision, a course request answered — the things somebody else did to you, which
 * no reducer of yours ever ran to hear about.
 */
export const listNotifications = () => call<{ notifications: Notification[] }>('/api/notifications')

/** No ids means the whole inbox, which is what opening the panel means. */
export const markNotificationsRead = (ids?: string[]) =>
  call<{ ok: true }>('/api/notifications', { method: 'PATCH', body: JSON.stringify({ ids: ids ?? [] }) })

/* ------------------------------------------------------------- demand board */

export interface CourseRequest {
  id: string
  authorId: string
  title: string
  body: string
  budgetCents: number
  currency: string
  deadline?: string
  status: 'open' | 'fulfilled' | 'withdrawn'
  votes: number
  createdAt: string
  answers: { lessonId: string; mentorId: string }[]
}

export const listRequests = () => call<{ requests: CourseRequest[]; voted: string[] }>('/api/requests')

export const askForCourse = (input: { title: string; body?: string; budgetCents?: number; currency?: string; deadline?: string | null }) =>
  call<{ ok: true; id: string }>('/api/requests', { method: 'POST', body: JSON.stringify(input) })

/** Voting twice is not an error — the primary key settles it and the server says ok. */
export const voteForRequest = (id: string, wanted: boolean) =>
  call<{ ok: true }>('/api/requests', { method: 'PATCH', body: JSON.stringify({ id, action: wanted ? 'vote' : 'unvote' }) })

export const withdrawRequest = (id: string) => call<{ ok: true }>('/api/requests', { method: 'PATCH', body: JSON.stringify({ id, action: 'withdraw' }) })

/** Answering announces to everyone who voted — once per request, ever. See api/requests.ts. */
export const answerRequest = (id: string, lessonId: string) =>
  call<{ ok: true; announced: number }>('/api/requests', { method: 'PATCH', body: JSON.stringify({ id, action: 'fulfil', lessonId }) })
