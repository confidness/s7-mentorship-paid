/**
 * Projects and their reviews.
 *
 * GET    what this person may see — their own work, the approved gallery, and for a mentor
 *        the queue as well.
 * POST   create or update your own project, and hand it in.
 * PATCH  claim or decide. Mentors only.
 *
 * The split between POST and PATCH is not cosmetic. A student owns the body of the work and
 * a mentor owns the decision about it, and row level security cannot express that on its own
 * — Postgres policies apply to a row, not to a column, so a mentor with update rights could
 * rewrite the submission they are reviewing. This route is where that line is drawn: PATCH
 * writes `status`, `reviewer_id` and `reviewed_at` and nothing else, ever.
 */

import { HttpError, fail, json, readJson, requireMethod, requireUser, type Caller } from './_lib/server'

/** What a student may put a project into. Deciding is somebody else's verb. */
const AUTHOR_STATES = new Set(['draft', 'submitted'])

interface SaveBody {
  id?: string
  title?: string
  description?: string
  code?: string
  notes?: string
  courseId?: string
  lessonId?: string
  attachments?: unknown
  tags?: unknown
  status?: string
}

interface ReviewBody {
  id?: string
  action?: 'claim' | 'decide'
  decision?: 'approved' | 'needs_changes'
  message?: string
  rubric?: { completeness: number; clarity: number; craft: number }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST', 'PATCH')
    const caller = await requireUser(req)
    if (req.method === 'GET') return await list(caller)
    if (req.method === 'POST') return await save(req, caller)
    return await review(req, caller)
  } catch (error) {
    return fail(error)
  }
}

const SELECT = 'id, author_id, title, description, code, notes, course_id, lesson_id, attachments, tags, status, created_at, submitted_at, reviewed_at, reviewer_id, likes, views'

/**
 * Everything visible to this caller, with the reviews attached.
 *
 * Row level security already decides what comes back — a student sees their own work and the
 * approved gallery, a mentor sees all of it — so there is no filter here to get wrong. The
 * query says what to fetch; the policy says who may.
 */
async function list(caller: Caller): Promise<Response> {
  const [projects, feedback] = await Promise.all([
    caller.db.from('projects').select(SELECT).order('created_at', { ascending: false }).limit(500),
    caller.db.from('project_feedback').select('id, project_id, mentor_id, decision, message, rubric, created_at').order('created_at', { ascending: true }).limit(2000),
  ])
  if (projects.error) throw new HttpError(500, 'read_failed', projects.error.message)

  const byProject = new Map<string, unknown[]>()
  for (const row of feedback.data ?? []) {
    const list = byProject.get(row.project_id as string) ?? []
    list.push({
      id: row.id,
      projectId: row.project_id,
      mentorId: row.mentor_id,
      decision: row.decision,
      message: row.message,
      rubric: row.rubric ?? undefined,
      createdAt: row.created_at,
    })
    byProject.set(row.project_id as string, list)
  }

  return json({
    projects: (projects.data ?? []).map((p) => ({
      id: p.id,
      authorId: p.author_id,
      title: p.title,
      description: p.description,
      code: p.code,
      notes: p.notes,
      courseId: p.course_id,
      lessonId: p.lesson_id,
      attachments: p.attachments ?? [],
      tags: p.tags ?? [],
      status: p.status,
      createdAt: p.created_at,
      submittedAt: p.submitted_at ?? undefined,
      reviewedAt: p.reviewed_at ?? undefined,
      reviewerId: p.reviewer_id ?? undefined,
      likes: p.likes,
      views: p.views,
      feedback: byProject.get(p.id as string) ?? [],
    })),
  })
}

/** Create or update your own work. The author's columns, and only those. */
async function save(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<SaveBody>(req)
  const title = (body.title ?? '').trim()
  if (!title) throw new HttpError(400, 'invalid_input', 'A project needs a title.')

  const status = body.status && AUTHOR_STATES.has(body.status) ? body.status : 'draft'
  const row = {
    author_id: caller.id,
    title,
    description: body.description ?? '',
    code: body.code ?? '',
    notes: body.notes ?? '',
    course_id: body.courseId ?? '',
    lesson_id: body.lessonId ?? '',
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    tags: Array.isArray(body.tags) ? body.tags : [],
    status,
    submitted_at: status === 'submitted' ? new Date().toISOString() : null,
  }

  if (body.id) {
    // The policy refuses this when the row is not theirs or has moved past their reach, so a
    // student cannot edit a project a mentor has already decided on.
    const { data, error } = await caller.db.from('projects').update(row).eq('id', body.id).eq('author_id', caller.id).select('id').maybeSingle()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    if (!data) throw new HttpError(409, 'not_editable', 'That project can no longer be edited.')
    return json({ ok: true, id: data.id })
  }

  const { data, error } = await caller.db.from('projects').insert(row).select('id').single()
  if (error) throw new HttpError(500, 'write_failed', error.message)
  return json({ ok: true, id: data.id })
}

/**
 * Claim a project, or decide on it.
 *
 * Claiming is what stops two mentors writing the same review, and it is conditional on the
 * project still being unclaimed — the second mentor to press it gets a 409 rather than
 * silently taking it over.
 */
async function review(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<ReviewBody>(req)
  if (!body.id) throw new HttpError(400, 'invalid_input', 'Which project?')

  if (body.action === 'claim') {
    const { data, error } = await caller.db
      .from('projects')
      .update({ status: 'under_review', reviewer_id: caller.id })
      .eq('id', body.id)
      .eq('status', 'submitted')
      .select('id')
      .maybeSingle()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    if (!data) throw new HttpError(409, 'already_claimed', 'Somebody is already reviewing this.')
    return json({ ok: true, id: data.id })
  }

  const decision = body.decision
  if (decision !== 'approved' && decision !== 'needs_changes') throw new HttpError(400, 'invalid_input', 'A review has to decide something.')
  const message = (body.message ?? '').trim()
  if (!message) throw new HttpError(400, 'invalid_input', 'Feedback is required for both decisions.')

  // The record of what was said goes in first. If the status update then fails, the student
  // has the feedback and the project stays in the queue — the opposite order would close the
  // project with nothing written on it.
  const { error: wrote } = await caller.db.from('project_feedback').insert({
    project_id: body.id,
    mentor_id: caller.id,
    decision,
    message,
    rubric: body.rubric ?? null,
  })
  if (wrote) throw new HttpError(500, 'write_failed', wrote.message)

  // Exactly three columns. The body of the work is not this route's to touch.
  const { error } = await caller.db
    .from('projects')
    .update({ status: decision, reviewer_id: caller.id, reviewed_at: new Date().toISOString() })
    .eq('id', body.id)
  if (error) throw new HttpError(500, 'write_failed', error.message)

  return json({ ok: true, id: body.id, decision })
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }
