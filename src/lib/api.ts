/**
 * Typed wrappers over the server routes.
 *
 * Every call carries the caller's access token, and every one of them is re-authorised on
 * the server. Nothing here is a permission check — this file only asks questions and
 * relays answers. If a function in here appears to decide something, the decision is
 * really the server's and this is the cached copy.
 */

import type { CustomLesson, CustomTask, MentorApplication, MentorStatus } from './types'
import { accessToken, backendConfigured } from './supabase'

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
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}

  if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'error'), String(body.message ?? body.error ?? res.statusText))
  return body as T
}

/* ---------------------------------------------------------------- mentors */

export interface StandingResponse {
  application: MentorApplication | null
  status: MentorStatus
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

export const getMentorStanding = () => call<StandingResponse>('/api/mentor-application')

export const applyToTeach = (input: { legalName: string; bio: string; credentialDocPath: string | null; idDocPath: string | null }) =>
  call<{ ok: true; application: MentorApplication }>('/api/mentor-application', { method: 'POST', body: JSON.stringify(input) })

export interface PendingApplication {
  id: string
  user_id: string
  status: MentorStatus
  legal_name: string
  bio: string
  submitted_at: string
  rejection_reason?: string
  profiles?: { name?: string; city?: string } | null
  credentialUrl: string | null
  idUrl: string | null
}

export const listApplications = (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
  call<{ applications: PendingApplication[] }>(`/api/admin/mentor-applications?status=${status}`)

export const decideApplication = (id: string, decision: 'approved' | 'rejected', reason?: string) =>
  call<{ ok: true }>('/api/admin/mentor-applications', { method: 'POST', body: JSON.stringify({ id, decision, reason }) })

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
